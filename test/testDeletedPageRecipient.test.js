'use strict';

process.env.NODE_ENV = 'development';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const deletedRoute = require('../routes/deletedRoute');

async function withFixtures(h00, mai, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deleted-recipient-'));
  try {
    fs.writeFileSync(path.join(dir, 'ABC123.H00'), h00);
    if (mai !== null) fs.writeFileSync(path.join(dir, 'ABC123.MAI'), mai);
    return await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function readDeletedEmails(dir) {
  return new Promise((resolve, reject) => {
    deletedRoute.getDeletedEmails((err, emails) => {
      if (err) reject(err);
      else resolve(emails);
    }, dir);
  });
}

test('deleted page data uses the single H00 recipient, not the MAI To list', async () => {
  const h00 = 'Recipients=[SMTP:Emily@CCarlin.com]\r\nTimeAcquired=1000\r\n';
  const mai = 'From: sender@example.com\r\nTo: other@example.com, another@example.com\r\nSubject: Test\r\n\r\nbody';

  await withFixtures(h00, mai, async (dir) => {
    const emails = await readDeletedEmails(dir);
    assert.equal(emails.length, 1);
    assert.equal(emails[0].recipients, 'emily');
  });
});

test('deleted page data falls back to the first MAI recipient when H00 has none', async () => {
  const h00 = 'TimeAcquired=1000\r\n';
  const mai = 'From: sender@example.com\r\nTo: Bob@Example.com, carol@example.com\r\nSubject: Test\r\n\r\nbody';

  await withFixtures(h00, mai, async (dir) => {
    const emails = await readDeletedEmails(dir);
    assert.equal(emails[0].recipients, 'bob');
  });
});

test('deleted page data still reads the H00 recipient when the MAI is missing', async () => {
  const h00 = 'Recipients=[SMTP:Emily@CCarlin.com]\r\nTimeAcquired=1000\r\n';

  await withFixtures(h00, null, async (dir) => {
    const emails = await readDeletedEmails(dir);
    assert.equal(emails[0].recipients, 'emily');
  });
});
