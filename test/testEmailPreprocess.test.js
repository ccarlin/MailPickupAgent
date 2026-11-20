'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAiEmailContent } = require('../app/emailPreprocess');

function header(key, value) {
  return { key, value };
}

test('keeps only the key headers and drops the rest', () => {
  const parsed = {
    headers: [
      header('Received', 'from somewhere by mx'),
      header('From', 'Alice <alice@example.com>'),
      header('Reply-To', 'reply@example.com'),
      header('Return-Path', '<bounce@example.com>'),
      header('To', 'Bob <bob@example.com>'),
      header('Subject', 'Hello there'),
      header('Authentication-Results', 'mx.example.com; spf=pass; dkim=pass; dmarc=pass'),
      header('Message-ID', '<abc@example.com>'),
      header('X-Spam-Flag', 'NO'),
    ],
    text: 'Hello Bob.',
  };

  const out = buildAiEmailContent(parsed);

  assert.match(out, /^From: Alice <alice@example\.com>$/m);
  assert.match(out, /^Reply-To: reply@example\.com$/m);
  assert.match(out, /^Return-Path: <bounce@example\.com>$/m);
  assert.match(out, /^To: Bob <bob@example\.com>$/m);
  assert.match(out, /^Subject: Hello there$/m);
  assert.match(out, /^Authentication-Results: mx\.example\.com; spf=pass; dkim=pass; dmarc=pass$/m);
  assert.doesNotMatch(out, /Received:/);
  assert.doesNotMatch(out, /Message-ID:/);
  assert.doesNotMatch(out, /X-Spam-Flag:/);
});

test('falls back to parsed address fields when headers are absent', () => {
  const parsed = {
    from: { name: 'Alice', address: 'alice@example.com' },
    to: [{ address: 'bob@example.com' }],
    subject: 'Hi',
    text: 'Body',
  };

  const out = buildAiEmailContent(parsed);

  assert.match(out, /^From: Alice <alice@example\.com>$/m);
  assert.match(out, /^To: bob@example\.com$/m);
  assert.match(out, /^Subject: Hi$/m);
});

test('reports zero visible words for image-only html with cid images', () => {
  const parsed = {
    html: '<html><body><img src="cid:img1" alt="557937"></body></html>',
    attachments: [{
      filename: 'ARCHIVE_20261116_1.jpg',
      contentType: 'image/jpeg',
      related: true,
      contentId: 'img1',
      content: Buffer.alloc(2048),
    }],
  };

  const out = buildAiEmailContent(parsed);

  assert.match(out, /Visible Body Text \(0 words\):/);
  assert.match(out, /\(no visible text\)/);
  assert.match(out, /\[Inline Image 1: ARCHIVE_20261116_1\.jpg, alt="557937", type=image\/jpeg, size=2 KB\]/);
});

test('extracts visible text from html when plain text is empty', () => {
  const parsed = {
    text: '',
    html: '<div><p>Hello&nbsp;<b>world</b></p><script>ignore()</script><style>.x{}</style></div>',
  };

  const out = buildAiEmailContent(parsed);

  assert.match(out, /Visible Body Text \(2 words\):/);
  assert.match(out, /Hello world/);
  assert.doesNotMatch(out, /ignore\(\)/);
});

test('prefers plain text over html', () => {
  const parsed = { text: 'Plain body here', html: '<p>Different html</p>' };

  const out = buildAiEmailContent(parsed);

  assert.match(out, /Plain body here/);
  assert.doesNotMatch(out, /Different html/);
});

test('strips data uri base64 and summarizes it as an inline image', () => {
  const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const parsed = { html: `<p>Hi</p><img src="data:image/png;base64,${b64}" alt="banner">` };

  const out = buildAiEmailContent(parsed);

  assert.doesNotMatch(out, /iVBORw0KGgo/);
  assert.match(out, /\[Inline Image 1: /);
  assert.match(out, /alt="banner"/);
});

test('removes long base64 runs from the visible text', () => {
  const blob = 'A'.repeat(400);
  const parsed = { text: `Header line\n${blob}\nFooter line` };

  const out = buildAiEmailContent(parsed);

  assert.doesNotMatch(out, /A{50}/);
  assert.match(out, /Header line/);
  assert.match(out, /Footer line/);
});

test('caps visible text at the configured length', () => {
  const parsed = { text: 'a '.repeat(1500) + 'ZZZTAIL' };

  const out = buildAiEmailContent(parsed, { maxTextChars: 2000 });

  assert.doesNotMatch(out, /ZZZTAIL/);
});
