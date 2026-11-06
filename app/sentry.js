'use strict';

let sentry = null;
let enabled = false;
let initialized = false;
let expressEnabled = true;

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

function requiresRestart(previous = {}, next = {}) {
  if (Object.prototype.hasOwnProperty.call(next, 'SENTRY_DSN')
    && dsnChanged(previous.SENTRY_DSN, next.SENTRY_DSN)) return true;
  if (Object.prototype.hasOwnProperty.call(next, 'SENTRY_EXPRESS_ENABLED')
    && isExpressEnabled(previous) !== isExpressEnabled(next)) return true;
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

  return { dsn, environment, release, tracesSampleRate, sendDefaultPii: toBoolean(values.SENTRY_SEND_DEFAULT_PII) };
}

function init(values = {}) {
  if (initialized) return enabled;
  initialized = true;

  const options = resolveOptions(values);
  if (!options) return false;

  try {
    sentry = require('@sentry/node');
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
  captureException,
  setupExpressErrorHandler,
  flush,
};
