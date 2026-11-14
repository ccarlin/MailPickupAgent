'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const sentry = require('../app/sentry');

test('resolveOptions returns null when the DSN is missing', () => {
  assert.equal(sentry.resolveOptions({ NODE_ENV: 'production' }), null);
});

test('resolveOptions defaults environment to NODE_ENV and release to the package version', () => {
  const options = sentry.resolveOptions({
    SENTRY_DSN: 'https://key@example.com/1',
    NODE_ENV: 'development',
  });

  assert.equal(options.environment, 'development');
  assert.equal(options.release, require('../package.json').version);
  assert.equal(options.tracesSampleRate, 0);
});

test('resolveOptions honors explicit environment and release values', () => {
  const options = sentry.resolveOptions({
    SENTRY_DSN: 'https://key@example.com/1',
    SENTRY_ENVIRONMENT: 'staging',
    SENTRY_RELEASE: 'release-42',
  });

  assert.equal(options.environment, 'staging');
  assert.equal(options.release, 'release-42');
});

test('resolveOptions clamps an out-of-range traces sample rate to zero', () => {
  const options = sentry.resolveOptions({
    SENTRY_DSN: 'https://key@example.com/1',
    SENTRY_TRACES_SAMPLE_RATE: '2',
  });

  assert.equal(options.tracesSampleRate, 0);
});

test('resolveOptions parses a valid traces sample rate', () => {
  const options = sentry.resolveOptions({
    SENTRY_DSN: 'https://key@example.com/1',
    SENTRY_TRACES_SAMPLE_RATE: '0.25',
  });

  assert.equal(options.tracesSampleRate, 0.25);
});

test('resolveOptions defaults to transaction mode so GlitchTip can ingest traces', () => {
  const options = sentry.resolveOptions({ SENTRY_DSN: 'https://key@example.com/1' });

  assert.equal(options.traceLifecycle, 'static');
});

test('resolveOptions parses the trace lifecycle case-insensitively', () => {
  const stream = sentry.resolveOptions({
    SENTRY_DSN: 'https://key@example.com/1',
    SENTRY_TRACE_LIFECYCLE: 'STREAM',
  });
  const staticMode = sentry.resolveOptions({
    SENTRY_DSN: 'https://key@example.com/1',
    SENTRY_TRACE_LIFECYCLE: 'Static',
  });

  assert.equal(stream.traceLifecycle, 'stream');
  assert.equal(staticMode.traceLifecycle, 'static');
});

test('resolveOptions falls back to static for an invalid trace lifecycle', () => {
  const options = sentry.resolveOptions({
    SENTRY_DSN: 'https://key@example.com/1',
    SENTRY_TRACE_LIFECYCLE: 'span',
  });

  assert.equal(options.traceLifecycle, 'static');
});

test('resolveOptions defaults sendDefaultPii to false', () => {
  const options = sentry.resolveOptions({ SENTRY_DSN: 'https://key@example.com/1' });

  assert.equal(options.sendDefaultPii, false);
});

test('resolveOptions parses sendDefaultPii from booleans and strings', () => {
  const enabled = sentry.resolveOptions({
    SENTRY_DSN: 'https://key@example.com/1',
    SENTRY_SEND_DEFAULT_PII: 'true',
  });
  const disabled = sentry.resolveOptions({
    SENTRY_DSN: 'https://key@example.com/1',
    SENTRY_SEND_DEFAULT_PII: false,
  });

  assert.equal(enabled.sendDefaultPii, true);
  assert.equal(disabled.sendDefaultPii, false);
});

test('resolveOptions excludes long-lived SSE endpoint spans from performance tracking', () => {
  const options = sentry.resolveOptions({ SENTRY_DSN: 'https://key@example.com/1' });

  const matches = name => options.ignoreSpans.some(pattern => {
    const matcher = typeof pattern === 'string' || pattern instanceof RegExp ? pattern : pattern.name;
    return matcher ? new RegExp(matcher).test(name) : false;
  });

  assert.equal(matches('GET /status/events'), true);
  assert.equal(matches('GET /mailq/events'), true);
  assert.equal(matches('GET /status'), false);
  assert.equal(matches('GET /mailq'), false);
});

test('resolveOptions strips the HTTP method from static span descriptions', () => {
  const options = sentry.resolveOptions({ SENTRY_DSN: 'https://key@example.com/1' });

  for (const method of ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']) {
    const span = { description: `${method} /mailq` };
    assert.equal(options.beforeSendSpan(span).description, '/mailq');
  }
});

test('resolveOptions leaves span descriptions without an HTTP method intact', () => {
  const options = sentry.resolveOptions({ SENTRY_DSN: 'https://key@example.com/1' });
  const span = { description: 'SELECT * FROM users' };

  assert.equal(options.beforeSendSpan(span).description, 'SELECT * FROM users');
});

test('resolveOptions does not tag stream callbacks as static after a static resolve', () => {
  sentry.resolveOptions({
    SENTRY_DSN: 'https://key@example.com/1',
    SENTRY_TRACE_LIFECYCLE: 'static',
  });
  const options = sentry.resolveOptions({
    SENTRY_DSN: 'https://key@example.com/1',
    SENTRY_TRACE_LIFECYCLE: 'stream',
  });

  assert.equal(options.beforeSendSpan._static, undefined);
});

test('dsnChanged detects added and removed DSNs', () => {
  assert.equal(sentry.dsnChanged('', 'https://key@example.com/1'), true);
  assert.equal(sentry.dsnChanged('https://key@example.com/1', ''), true);
});

test('dsnChanged detects a different DSN', () => {
  assert.equal(sentry.dsnChanged('https://old@example.com/1', 'https://new@example.com/1'), true);
});

test('dsnChanged treats equivalent or missing DSNs as unchanged', () => {
  assert.equal(sentry.dsnChanged('', ''), false);
  assert.equal(sentry.dsnChanged(undefined, null), false);
  assert.equal(sentry.dsnChanged(' https://key@example.com/1 ', 'https://key@example.com/1'), false);
});

test('isExpressEnabled defaults to true', () => {
  assert.equal(sentry.isExpressEnabled({}), true);
  assert.equal(sentry.isExpressEnabled({ SENTRY_EXPRESS_ENABLED: '' }), true);
});

test('isExpressEnabled parses booleans and strings', () => {
  assert.equal(sentry.isExpressEnabled({ SENTRY_EXPRESS_ENABLED: false }), false);
  assert.equal(sentry.isExpressEnabled({ SENTRY_EXPRESS_ENABLED: 'false' }), false);
  assert.equal(sentry.isExpressEnabled({ SENTRY_EXPRESS_ENABLED: true }), true);
  assert.equal(sentry.isExpressEnabled({ SENTRY_EXPRESS_ENABLED: 'true' }), true);
});

test('requiresRestart detects DSN and Express flag changes', () => {
  assert.equal(sentry.requiresRestart({}, {}), false);
  assert.equal(sentry.requiresRestart({ SENTRY_DSN: '', SENTRY_EXPRESS_ENABLED: true }, { SENTRY_DSN: '', SENTRY_EXPRESS_ENABLED: true }), false);
  assert.equal(sentry.requiresRestart({ SENTRY_DSN: '' }, { SENTRY_DSN: 'https://key@example.com/1' }), true);
  assert.equal(sentry.requiresRestart({ SENTRY_EXPRESS_ENABLED: true }, { SENTRY_EXPRESS_ENABLED: false }), true);
  assert.equal(sentry.requiresRestart({ SENTRY_EXPRESS_ENABLED: false }, {}), false);
});

test('requiresRestart detects trace lifecycle changes', () => {
  assert.equal(sentry.requiresRestart({ SENTRY_TRACE_LIFECYCLE: 'static' }, { SENTRY_TRACE_LIFECYCLE: 'stream' }), true);
  assert.equal(sentry.requiresRestart({ SENTRY_TRACE_LIFECYCLE: 'static' }, { SENTRY_TRACE_LIFECYCLE: 'STATIC' }), false);
  assert.equal(sentry.requiresRestart({}, {}), false);
});

test('detectProvider recognizes Bugsink from its canonical schema endpoint', async () => {
  const provider = await sentry.detectProvider('https://key@bugsink.example.com/1', {
    request: async url => url === 'https://bugsink.example.com/api/canonical/0/schema/'
      ? { status: 200, data: { openapi: '3.1.0', info: { title: 'Bugsink API' } } }
      : { status: 404, data: {} },
  });

  assert.equal(provider, 'Bugsink');
});

test('detectProvider recognizes GlitchTip from its internal health endpoint', async () => {
  const provider = await sentry.detectProvider('https://key@glitchtip.example.com/1', {
    request: async url => url === 'https://glitchtip.example.com/api/0/internal/health/'
      ? { status: 200, data: { healthy: {}, problems: [] } }
      : { status: 404, data: {} },
  });

  assert.equal(provider, 'GlitchTip');
});

test('detectProvider recognizes Sentry from its API root', async () => {
  const provider = await sentry.detectProvider('https://key@sentry.example.com/1', {
    request: async url => url === 'https://sentry.example.com/api/0/'
      ? { status: 200, data: { version: '0', auth: null, user: null } }
      : { status: 404, data: {} },
  });

  assert.equal(provider, 'Sentry');
});

test('detectProvider falls back to Sentry-compatible when no probe matches', async () => {
  const provider = await sentry.detectProvider('https://key@unknown.example.com/1', {
    request: async () => ({ status: 404, data: {} }),
  });

  assert.equal(provider, 'Sentry-compatible');
});

test('detectProvider preserves a DSN path prefix when probing', async () => {
  const urls = [];
  await sentry.detectProvider('https://key@example.com/sentry/42', {
    request: async url => {
      urls.push(url);
      return { status: 404, data: {} };
    },
  });

  assert.deepEqual(urls.sort(), [
    'https://example.com/sentry/api/0/',
    'https://example.com/sentry/api/0/internal/health/',
    'https://example.com/sentry/api/canonical/0/schema/',
  ].sort());
});

test('captureException is a no-op before initialization', () => {
  assert.doesNotThrow(() => sentry.captureException(new Error('not enabled')));
});

test('flush succeeds without an active Sentry client', async () => {
  assert.equal(await sentry.flush(), true);
});

test('init returns false and stays disabled without a DSN', () => {
  assert.equal(sentry.init({}), false);
  assert.equal(sentry.isEnabled(), false);
});
