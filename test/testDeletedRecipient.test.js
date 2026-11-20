'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { getLocalRecipient } = require('../app/deletedRecipient');

test('uses the H00 recipient as the single local part, ignoring the MAI To list', () => {
  const h00 = 'TimeAcquired=123\r\nRecipients=[SMTP:Emily@CCarlin.com]\r\n';

  assert.equal(getLocalRecipient(h00, ['other@example.com', 'another@example.com']), 'emily');
});

test('falls back to the first MAI To address when the H00 has no recipient', () => {
  const h00 = 'TimeAcquired=123\r\nStatus=Delivering\r\n';

  assert.equal(getLocalRecipient(h00, ['Bob@Example.com', 'carol@example.com']), 'bob');
});

test('falls back to MAI when the H00 recipient has no address', () => {
  const h00 = 'Recipients=[]\r\n';

  assert.equal(getLocalRecipient(h00, ['dave@example.com']), 'dave');
});

test('returns an empty string when neither source has a recipient', () => {
  assert.equal(getLocalRecipient('TimeAcquired=123\r\n', []), '');
});
