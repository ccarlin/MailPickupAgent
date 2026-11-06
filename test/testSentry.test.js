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
