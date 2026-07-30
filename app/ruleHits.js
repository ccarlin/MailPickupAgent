const db = require('./db');

db.prepare(`
  CREATE TABLE IF NOT EXISTS rule_hits (
    rule_type TEXT NOT NULL,
    rule_value TEXT NOT NULL,
    hit_count INTEGER NOT NULL DEFAULT 0,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (rule_type, rule_value)
  )
`).run();

const incrementHit = db.prepare(`
  INSERT INTO rule_hits (rule_type, rule_value, hit_count, updated_at)
  VALUES (?, ?, 1, CURRENT_TIMESTAMP)
  ON CONFLICT(rule_type, rule_value) DO UPDATE SET
    hit_count = hit_count + 1,
    updated_at = CURRENT_TIMESTAMP
`);
const getHits = db.prepare('SELECT rule_type, rule_value, hit_count FROM rule_hits');
const getHitsDetailed = db.prepare('SELECT rule_type, rule_value, hit_count, updated_at FROM rule_hits ORDER BY hit_count DESC');
const deleteHitStmt = db.prepare('DELETE FROM rule_hits WHERE rule_type = ? AND rule_value = ?');
const clearAllHitsStmt = db.prepare('DELETE FROM rule_hits');

function ruleValue(rule) {
  return typeof rule === 'string' ? rule : JSON.stringify(rule);
}

function recordHit(ruleType, rule) {
  if (!ruleType || rule === undefined || rule === null) return;
  incrementHit.run(ruleType, ruleValue(rule));
}

function getAllHits() {
  return getHits.all().reduce((hits, row) => {
    hits[`${row.rule_type}:${row.rule_value}`] = row.hit_count;
    return hits;
  }, {});
}

function getAllHitsArray() {
  return getHitsDetailed.all();
}

function deleteHit(ruleType, ruleValue) {
  if (!ruleType || ruleValue === undefined || ruleValue === null) return 0;
  return deleteHitStmt.run(ruleType, ruleValue).changes;
}

function clearAllHits() {
  return clearAllHitsStmt.run().changes;
}

module.exports = { recordHit, getAllHits, getAllHitsArray, ruleValue, deleteHit, clearAllHits, db };
