'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseAiResponse } = require('../app/aiResponse');

test('parses valid JSON unchanged', () => {
  const parsed = parseAiResponse('{"classification":"HAM","confidence_score":0.9,"reasons":["a","b"]}');

  assert.equal(parsed.classification, 'HAM');
  assert.equal(parsed.confidence_score, 0.9);
  assert.deepEqual(parsed.reasons, ['a', 'b']);
});

test('repairs missing commas between strings in an array', () => {
  const broken = `{
    "classification": "HAM",
    "confidence_score": 0.90,
    "reasons": [
      "Legitimate company branding and domain (chipotle@email.chipotle.com),"
      "Personalized greeting (Have you claimed your free Chips, Ali?)",
      "Multiple links to Chipotle's official websites, rather than suspicious external links"
    ]
  }`;

  const parsed = parseAiResponse(broken);

  assert.equal(parsed.classification, 'HAM');
  assert.equal(parsed.confidence_score, 0.9);
  assert.equal(parsed.reasons.length, 3);
  assert.equal(parsed.reasons[0], 'Legitimate company branding and domain (chipotle@email.chipotle.com),');
});

test('repairs missing commas between objects in an array', () => {
  const parsed = parseAiResponse('{"items":[{"a":1}{"a":2}]}');

  assert.deepEqual(parsed.items, [{ a: 1 }, { a: 2 }]);
});

test('repairs missing commas between object members', () => {
  const parsed = parseAiResponse('{"a":1"b":2}');

  assert.deepEqual(parsed, { a: 1, b: 2 });
});

test('repairs missing commas between primitives in an array', () => {
  const parsed = parseAiResponse('{"values":[1 2 3]}');

  assert.deepEqual(parsed.values, [1, 2, 3]);
});

test('does not modify commas or brackets inside strings', () => {
  const parsed = parseAiResponse('{"reasons":["a, b","c { d } [ e ]"]}');

  assert.deepEqual(parsed.reasons, ['a, b', 'c { d } [ e ]']);
});

test('balances missing closing brackets and braces', () => {
  const parsed = parseAiResponse('{"reasons":["a" "b"');

  assert.deepEqual(parsed.reasons, ['a', 'b']);
});

test('strips markdown code fences', () => {
  const parsed = parseAiResponse('```json\n{"classification":"HAM"}\n```');

  assert.equal(parsed.classification, 'HAM');
});

test('throws a SyntaxError when the response cannot be repaired', () => {
  assert.throws(() => parseAiResponse('not json at all'), SyntaxError);
});

test('escapes unescaped double quotes inside string values', () => {
  const broken = `{
    "classification": "SPAM",
    "confidence_score": 0.98,
    "reasons": [
      "Freemail sender (outlook.com) impersonating commercial correspondence with promotional links and images.",
      "Visible Body Text contains multiple clickable links to Shopify product pages with discount codes.",
      "Urgent language ("Black Friday Savings Came Early!") and generic offers may create an artificial sense of urgency."
    ]
  }`;

  const parsed = parseAiResponse(broken);

  assert.equal(parsed.classification, 'SPAM');
  assert.equal(parsed.confidence_score, 0.98);
  assert.equal(parsed.reasons.length, 3);
  assert.equal(
    parsed.reasons[2],
    'Urgent language ("Black Friday Savings Came Early!") and generic offers may create an artificial sense of urgency.',
  );
});

test('preserves already-escaped quotes while escaping inner quotes', () => {
  const broken = '{"reasons":["He said \\"hello\\" and ("Sale!") today"]}';

  const parsed = parseAiResponse(broken);

  assert.deepEqual(parsed.reasons, ['He said "hello" and ("Sale!") today']);
});

test('escapes an inner quote followed by a comma inside a string', () => {
  const broken = '{"reasons":["He said "hi", then left","Second reason"]}';

  const parsed = parseAiResponse(broken);

  assert.deepEqual(parsed.reasons, ['He said "hi", then left', 'Second reason']);
});
