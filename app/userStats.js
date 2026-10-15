const defaultDb = require('./db');

const METRICS = ['processed', 'whitelisted', 'blacklisted', 'quarantined', 'released', 'deleted'];

function normalizeUser(value) {
  if (value === undefined || value === null) return null;
  let user = String(value).trim().toLowerCase();
  if (!user) return null;
  const at = user.indexOf('@');
  if (at !== -1) user = user.slice(0, at);
  user = user.trim();
  return user || null;
}

function toUserList(users) {
  const list = Array.isArray(users)
    ? users
    : String(users === undefined || users === null ? '' : users).split(',');
  const normalized = [];
  for (const entry of list) {
    const user = normalizeUser(entry);
    if (user) normalized.push(user);
  }
  return normalized;
}

function createUserStats(database) {
  database.prepare(`
    CREATE TABLE IF NOT EXISTS user_stats (
      user TEXT NOT NULL,
      metric TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user, metric)
    )
  `).run();

  const incrementStmt = database.prepare(`
    INSERT INTO user_stats (user, metric, count, updated_at)
    VALUES (?, ?, 1, CURRENT_TIMESTAMP)
    ON CONFLICT(user, metric) DO UPDATE SET
      count = count + 1,
      updated_at = CURRENT_TIMESTAMP
  `);
  const selectStmt = database.prepare('SELECT user, metric, count, updated_at FROM user_stats');
  const deleteUserStmt = database.prepare('DELETE FROM user_stats WHERE user = ?');
  const clearStmt = database.prepare('DELETE FROM user_stats');

  function recordOutcome(user, metric) {
    const name = normalizeUser(user);
    if (!name || !METRICS.includes(metric) || metric === 'processed') return false;
    incrementStmt.run(name, metric);
    incrementStmt.run(name, 'processed');
    return true;
  }

  function recordOutcomes(users, metric) {
    const list = toUserList(users);
    for (const user of list) recordOutcome(user, metric);
    return list.length;
  }

  function getStatsArray() {
    const byUser = new Map();
    for (const row of selectStmt.all()) {
      let entry = byUser.get(row.user);
      if (!entry) {
        entry = { user: row.user, updated_at: row.updated_at };
        for (const metric of METRICS) entry[metric] = 0;
        byUser.set(row.user, entry);
      }
      entry[row.metric] = row.count;
      if (row.updated_at > entry.updated_at) entry.updated_at = row.updated_at;
    }
    return Array.from(byUser.values()).sort(function (a, b) {
      if (b.processed !== a.processed) return b.processed - a.processed;
      return a.user.localeCompare(b.user);
    });
  }

  function deleteUser(user) {
    const name = normalizeUser(user);
    if (!name) return 0;
    return deleteUserStmt.run(name).changes;
  }

  function clearAllStats() {
    return clearStmt.run().changes;
  }

  return { recordOutcome, recordOutcomes, getStatsArray, deleteUser, clearAllStats, METRICS };
}

const defaultUserStats = createUserStats(defaultDb);

module.exports = Object.assign({ createUserStats }, defaultUserStats);
