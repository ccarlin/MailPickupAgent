'use strict';

const config = require('../config');
const sentry = require('../app/sentry');

const TEST_TAGS = { component: 'sentry-test', source: 'mailpickupagent' };
const TEST_ATTRIBUTES = { source: 'mailpickupagent', test: 'sentry' };

function resolveDsn(override) {
  return String(override || process.env.SENTRY_DSN || config.SENTRY_DSN || '').trim();
}

async function sendSentryTest(dsnOverride) {
  const output = [];
  const options = { ...config, SENTRY_DSN: resolveDsn(dsnOverride) };

  if (!sentry.init(options)) {
    output.push(options.SENTRY_DSN
      ? 'Sentry failed to initialize. Check the SENTRY_DSN and server logs.'
      : 'Sentry is not enabled: configure SENTRY_DSN or pass a DSN as an argument.');
    return { success: false, output };
  }

  const Sentry = require('@sentry/node');
  const results = [];
  const run = (label, fn) => {
    try {
      fn();
      results.push(true);
      output.push(`PASS: ${label}`);
    } catch (err) {
      results.push(false);
      output.push(`FAIL: ${label} (${err.message})`);
    }
  };

  run('error event', () => {
    sentry.captureException(new Error('MailPickupAgent Sentry test error'), {
      tags: { ...TEST_TAGS, signal: 'error' },
      extra: { test: true, timestamp: new Date().toISOString() },
    });
  });

  run('message event', () => {
    Sentry.captureMessage('MailPickupAgent Sentry test message', 'info');
  });

  run('log event', () => {
    Sentry.logger.info('MailPickupAgent Sentry test log', { ...TEST_ATTRIBUTES, signal: 'log' });
  });

  run('count metric', () => {
    Sentry.metrics.count('mailpickupagent.test.count', 1, {
      attributes: { ...TEST_ATTRIBUTES, signal: 'count' },
    });
  });

  run('gauge metric', () => {
    Sentry.metrics.gauge('mailpickupagent.test.gauge', 42, {
      unit: 'millisecond',
      attributes: { ...TEST_ATTRIBUTES, signal: 'gauge' },
    });
  });

  run('distribution metric', () => {
    Sentry.metrics.distribution('mailpickupagent.test.distribution', 123, {
      unit: 'millisecond',
      attributes: { ...TEST_ATTRIBUTES, signal: 'distribution' },
    });
  });

  const flushed = await sentry.flush(5000);
  results.push(flushed);
  output.push(flushed ? 'PASS: flush' : 'FAIL: flush timed out');

  return { success: results.every(Boolean), output };
}

if (require.main === module) {
  sendSentryTest(process.argv[2])
    .then(({ success, output }) => {
      console.log(output.join('\n'));
      if (!success) process.exitCode = 1;
    })
    .catch(err => {
      console.error(`Sentry test failed: ${err.message}`);
      process.exitCode = 1;
    });
}

module.exports = { sendSentryTest, resolveDsn };
