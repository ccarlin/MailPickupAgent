const assert = require('assert');
const Database = require('better-sqlite3');
const { createUserStats } = require('../app/userStats');

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

function freshStats() {
  return createUserStats(new Database(':memory:'));
}

run('records one outcome and total processed for a user', function () {
  const s = freshStats();
  s.recordOutcomes(['alice'], 'quarantined');
  const rows = s.getStatsArray();
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].user, 'alice');
  assert.strictEqual(rows[0].quarantined, 1);
  assert.strictEqual(rows[0].processed, 1);
  assert.strictEqual(rows[0].whitelisted, 0);
  assert.strictEqual(rows[0].blacklisted, 0);
  assert.strictEqual(rows[0].released, 0);
  assert.strictEqual(rows[0].deleted, 0);
});

run('counts each recipient of a multi-recipient message', function () {
  const s = freshStats();
  s.recordOutcomes(['alice', 'bob'], 'blacklisted');
  const rows = s.getStatsArray();
  assert.strictEqual(rows.length, 2);
  rows.forEach(function (r) {
    assert.strictEqual(r.blacklisted, 1);
    assert.strictEqual(r.processed, 1);
  });
});

run('accepts a comma-separated recipient string', function () {
  const s = freshStats();
  s.recordOutcomes('alice, bob', 'released');
  const users = s.getStatsArray().map(function (r) { return r.user; }).sort();
  assert.deepStrictEqual(users, ['alice', 'bob']);
});

run('normalizes case, whitespace, and strips the domain', function () {
  const s = freshStats();
  s.recordOutcomes(['  Alice@Example.com '], 'whitelisted');
  const rows = s.getStatsArray();
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].user, 'alice');
  assert.strictEqual(rows[0].whitelisted, 1);
});

run('aggregates counts across multiple calls', function () {
  const s = freshStats();
  s.recordOutcomes(['alice'], 'quarantined');
  s.recordOutcomes(['alice'], 'quarantined');
  s.recordOutcomes(['alice'], 'released');
  const row = s.getStatsArray().find(function (r) { return r.user === 'alice'; });
  assert.strictEqual(row.quarantined, 2);
  assert.strictEqual(row.released, 1);
  assert.strictEqual(row.processed, 3);
});

run('pivots all metrics into one row per user', function () {
  const s = freshStats();
  s.recordOutcomes(['alice'], 'whitelisted');
  s.recordOutcomes(['alice'], 'blacklisted');
  s.recordOutcomes(['bob'], 'deleted');
  const rows = s.getStatsArray();
  assert.strictEqual(rows.length, 2);
  const alice = rows.find(function (r) { return r.user === 'alice'; });
  assert.strictEqual(alice.whitelisted, 1);
  assert.strictEqual(alice.blacklisted, 1);
  assert.strictEqual(alice.quarantined, 0);
  assert.strictEqual(alice.processed, 2);
  const bob = rows.find(function (r) { return r.user === 'bob'; });
  assert.strictEqual(bob.deleted, 1);
  assert.strictEqual(bob.processed, 1);
});

run('ignores empty users and invalid metrics', function () {
  const s = freshStats();
  s.recordOutcomes(['', '   ', null], 'quarantined');
  s.recordOutcomes(['alice'], 'bogus');
  assert.strictEqual(s.getStatsArray().length, 0);
});

run('sorts users by processed count descending', function () {
  const s = freshStats();
  s.recordOutcomes(['bob'], 'released');
  s.recordOutcomes(['alice'], 'released');
  s.recordOutcomes(['alice'], 'released');
  const users = s.getStatsArray().map(function (r) { return r.user; });
  assert.deepStrictEqual(users, ['alice', 'bob']);
});

run('deleteUser removes only that user', function () {
  const s = freshStats();
  s.recordOutcomes(['alice', 'bob'], 'quarantined');
  const removed = s.deleteUser('alice');
  assert.ok(removed > 0, 'deleteUser should report removed rows');
  const users = s.getStatsArray().map(function (r) { return r.user; });
  assert.deepStrictEqual(users, ['bob']);
});

run('clearAllStats empties the table', function () {
  const s = freshStats();
  s.recordOutcomes(['alice', 'bob'], 'quarantined');
  s.clearAllStats();
  assert.strictEqual(s.getStatsArray().length, 0);
});

if (failures > 0) {
  console.error('\n' + failures + ' test(s) failed');
  process.exit(1);
} else {
  console.log('\nAll user stats tests passed');
}
