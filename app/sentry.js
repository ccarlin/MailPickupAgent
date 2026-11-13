'use strict';

let sentry = null;
let enabled = false;
let initialized = false;
let expressEnabled = true;
let activeOptions = null;

// Long-lived Server-Sent Events streams stay open for the client's lifetime,
// so they must not be recorded as performance spans.
const IGNORED_SPAN_PATTERNS = [
  { name: /\/status\/events/ },
  { name: /\/mailq\/events/ },
];

const HTTP_METHOD_PREFIX = /^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS|TRACE|CONNECT)\s+/i;

function stripHttpMethodFromSpanDescription(span) {
  if (span && typeof span.description === 'string') {
    span.description = span.description.replace(HTTP_METHOD_PREFIX, '');
  }
  return span;
}

function buildBeforeSendSpan(traceLifecycle) {
  const callback = span => stripHttpMethodFromSpanDescription(span);
  if (traceLifecycle !== 'static') return callback;
  try {
    return require('@sentry/node').withStaticSpan(callback);
  } catch {
    return callback;
  }
}

function toBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return String(value).trim().toLowerCase() === 'true';
}

function isExpressEnabled(values = {}) {
  return toBoolean(values.SENTRY_EXPRESS_ENABLED, true);
}

function dsnChanged(previous, next) {
  return String(previous || '').trim() !== String(next || '').trim();
}

function resolveTraceLifecycle(value) {
  return String(value || '').trim().toLowerCase() === 'stream' ? 'stream' : 'static';
}

function requiresRestart(previous = {}, next = {}) {
  if (Object.prototype.hasOwnProperty.call(next, 'SENTRY_DSN')
    && dsnChanged(previous.SENTRY_DSN, next.SENTRY_DSN)) return true;
  if (Object.prototype.hasOwnProperty.call(next, 'SENTRY_EXPRESS_ENABLED')
    && isExpressEnabled(previous) !== isExpressEnabled(next)) return true;
  if (Object.prototype.hasOwnProperty.call(next, 'SENTRY_TRACE_LIFECYCLE')
    && resolveTraceLifecycle(previous.SENTRY_TRACE_LIFECYCLE) !== resolveTraceLifecycle(next.SENTRY_TRACE_LIFECYCLE)) return true;
  return false;
}

function resolveOptions(values = {}) {
  const dsn = String(values.SENTRY_DSN || '').trim();
  if (!dsn) return null;

  const environment = String(values.SENTRY_ENVIRONMENT || '').trim()
    || String(values.NODE_ENV || process.env.NODE_ENV || 'production').trim();

  let release = String(values.SENTRY_RELEASE || '').trim();
  if (!release) {
    try {
      release = require('../package.json').version;
    } catch {
      release = undefined;
    }
  }

  let tracesSampleRate = Number(values.SENTRY_TRACES_SAMPLE_RATE);
  if (!Number.isFinite(tracesSampleRate) || tracesSampleRate < 0 || tracesSampleRate > 1) {
    tracesSampleRate = 0;
  }

  const traceLifecycle = resolveTraceLifecycle(values.SENTRY_TRACE_LIFECYCLE);

  return {
    dsn,
    environment,
    release,
    tracesSampleRate,
    sendDefaultPii: toBoolean(values.SENTRY_SEND_DEFAULT_PII),
    traceLifecycle,
    beforeSendSpan: buildBeforeSendSpan(traceLifecycle),
    ignoreSpans: IGNORED_SPAN_PATTERNS,
  };
}

function init(values = {}) {
  if (initialized) return enabled;
  initialized = true;

  const options = resolveOptions(values);
  if (!options) return false;

  try {
    sentry = require('@sentry/node');
    activeOptions = options;
    expressEnabled = isExpressEnabled(values);
    if (!expressEnabled && typeof sentry.getDefaultIntegrations === 'function') {
      options.defaultIntegrations = sentry.getDefaultIntegrations()
        .filter(integration => integration.name !== 'Express');
    }
    sentry.init(options);
    enabled = true;
  } catch (err) {
    enabled = false;
    console.error(`[sentry] Failed to initialize: ${err.message}`);
  }

  return enabled;
}

function isEnabled() {
  return enabled;
}

function getDetails() {
  if (!enabled || !activeOptions) return null;

  return {
    environment: activeOptions.environment,
    release: activeOptions.release,
    tracesSampleRate: activeOptions.tracesSampleRate,
    traceLifecycle: activeOptions.traceLifecycle,
  };
}

function captureException(error, context) {
  if (!enabled || !sentry) return;

  const captured = error instanceof Error ? error : new Error(String(error));

  try {
    if (context && typeof context === 'object') {
      sentry.withScope(scope => {
        for (const [key, value] of Object.entries(context)) {
          if (key === 'user') {
            scope.setUser(value);
          } else if (key === 'tags') {
            scope.setTags(value);
          } else {
            scope.setExtra(key, value);
          }
        }
        sentry.captureException(captured);
      });
    } else {
      sentry.captureException(captured);
    }
  } catch {
    return;
  }
}

function setupExpressErrorHandler(app) {
  if (!enabled || !expressEnabled || !sentry || typeof sentry.setupExpressErrorHandler !== 'function') return;

  try {
    sentry.setupExpressErrorHandler(app);
  } catch (err) {
    console.error(`[sentry] Failed to attach Express error handler: ${err.message}`);
  }
}

async function flush(timeout = 2000) {
  if (!enabled || !sentry || typeof sentry.flush !== 'function') return true;

  try {
    return await sentry.flush(timeout);
  } catch {
    return false;
  }
}

module.exports = {
  resolveOptions,
  dsnChanged,
  isExpressEnabled,
  requiresRestart,
  init,
  isEnabled,
  getDetails,
  captureException,
  setupExpressErrorHandler,
  flush,
};
