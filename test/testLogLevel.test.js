'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveLogLevel, shouldLogLevel } = require('../app/shared');

test('missing log level resolves to INFO', () => {
  assert.equal(resolveLogLevel(undefined), 'INFO');
});

test('unknown log level resolves to INFO', () => {
  assert.equal(resolveLogLevel('notice'), 'INFO');
});

test('WARN is a canonical level', () => {
  assert.equal(resolveLogLevel('warn'), 'WARN');
});

test('WARNING is not aliased to WARN', () => {
  assert.equal(resolveLogLevel('WARNING'), 'INFO');
});

test('default level suppresses DEBUG and TRACE but keeps INFO', () => {
  assert.equal(shouldLogLevel('DEBUG', undefined), false);
  assert.equal(shouldLogLevel('TRACE', undefined), false);
  assert.equal(shouldLogLevel('INFO', undefined), true);
});

test('INFO threshold suppresses DEBUG and TRACE', () => {
  assert.equal(shouldLogLevel('INFO', 'INFO'), true);
  assert.equal(shouldLogLevel('DEBUG', 'INFO'), false);
  assert.equal(shouldLogLevel('TRACE', 'INFO'), false);
});

test('DEBUG threshold allows DEBUG but suppresses TRACE', () => {
  assert.equal(shouldLogLevel('DEBUG', 'DEBUG'), true);
  assert.equal(shouldLogLevel('TRACE', 'DEBUG'), false);
});

test('TRACE threshold allows every level', () => {
  for (const level of ['ERROR', 'WARN', 'INFO', 'DEBUG', 'TRACE']) {
    assert.equal(shouldLogLevel(level, 'TRACE'), true, `${level} should be written at TRACE threshold`);
  }
});

test('ERROR threshold suppresses WARN and INFO', () => {
  assert.equal(shouldLogLevel('ERROR', 'ERROR'), true);
  assert.equal(shouldLogLevel('WARN', 'ERROR'), false);
  assert.equal(shouldLogLevel('INFO', 'ERROR'), false);
});

test('WARN threshold includes WARN and ERROR but not INFO', () => {
  assert.equal(shouldLogLevel('WARN', 'WARN'), true);
  assert.equal(shouldLogLevel('ERROR', 'WARN'), true);
  assert.equal(shouldLogLevel('INFO', 'WARN'), false);
});
