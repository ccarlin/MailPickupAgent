const assert = require('assert');
const { computeFlow } = require('../public/scripts/messageFlow.js');

let failures = 0;

function run(name, fn) {
  try {
    fn();
    console.log('PASS  ' + name);
  } catch (err) {
    failures++;
    console.error('FAIL  ' + name + ': ' + err.message);
  }
}

run('all zeros produce zeros', function () {
  const r = computeFlow({ totalProcessed: 0, whitelisted: 0, blacklisted: 0, quarantined: 0, released: 0, deleted: 0 });
  assert.strictEqual(r.inbound, 0);
  assert.strictEqual(r.blacklistReached, 0);
  assert.strictEqual(r.scoringReached, 0);
  assert.strictEqual(r.thresholdReached, 0);
});

run('typical values derive pass-through stages', function () {
  const r = computeFlow({ totalProcessed: 1204, whitelisted: 310, blacklisted: 190, quarantined: 132, released: 514, deleted: 0 });
  assert.strictEqual(r.inbound, 1204);
  assert.strictEqual(r.whitelistReached, 1204);
  assert.strictEqual(r.blacklistReached, 894);
  assert.strictEqual(r.scoringReached, 704);
  assert.strictEqual(r.thresholdReached, 704);
  assert.strictEqual(r.whitelisted, 310);
  assert.strictEqual(r.released, 514);
  assert.strictEqual(r.quarantined, 132);
});

run('never returns negative pass-through values', function () {
  const r = computeFlow({ totalProcessed: 10, whitelisted: 20, blacklisted: 5 });
  assert.strictEqual(r.blacklistReached, 0);
  assert.strictEqual(r.scoringReached, 0);
});

run('missing or non-numeric fields default to zero', function () {
  const r = computeFlow({ totalProcessed: '12', whitelisted: undefined });
  assert.strictEqual(r.inbound, 12);
  assert.strictEqual(r.whitelisted, 0);
  assert.strictEqual(r.blacklisted, 0);
});

run('deleted passes through unchanged', function () {
  const r = computeFlow({ totalProcessed: 100, whitelisted: 40, blacklisted: 20, quarantined: 10, released: 25, deleted: 7 });
  assert.strictEqual(r.deleted, 7);
});

run('no-argument call returns all zeros', function () {
  const r = computeFlow();
  assert.strictEqual(r.inbound, 0);
  assert.strictEqual(r.whitelistReached, 0);
  assert.strictEqual(r.blacklistReached, 0);
  assert.strictEqual(r.scoringReached, 0);
  assert.strictEqual(r.thresholdReached, 0);
  assert.strictEqual(r.whitelisted, 0);
  assert.strictEqual(r.blacklisted, 0);
  assert.strictEqual(r.quarantined, 0);
  assert.strictEqual(r.released, 0);
  assert.strictEqual(r.deleted, 0);
});

if (failures > 0) {
  console.error('\n' + failures + ' test(s) failed');
  process.exit(1);
} else {
  console.log('\nAll Message Flow mapping tests passed');
}
