const Database = require('better-sqlite3');

module.exports = function sessionStoreFactory(session) {
  const { Store } = session;

  class SqliteStore extends Store {
    constructor(options = {}) {
      super(options);
      this.db = options.db || 'sessions.db';
      this.client = new Database(this.db);
      this.client.prepare(
        `CREATE TABLE IF NOT EXISTS sessions (
          sid TEXT NOT NULL PRIMARY KEY,
          sess TEXT NOT NULL,
          expire INTEGER NOT NULL
        )`
      ).run();

      if (options.clearExpired !== false) {
        this._interval = setInterval(
          () => this.clearExpired(),
          options.intervalMs || 900000
        );
      }
    }

    clearExpired() {
      this.client.prepare(
        `DELETE FROM sessions WHERE expire < ?`
      ).run(Date.now());
    }

    get(sid, cb) {
      let row;
      try {
        row = this.client.prepare(
          `SELECT sess FROM sessions WHERE sid = ? AND expire > ?`
        ).get(sid, Date.now());
      } catch (err) {
        return cb(err);
      }
      if (!row) return cb(null, null);
      try {
        cb(null, JSON.parse(row.sess));
      } catch (err) {
        cb(err);
      }
    }

    set(sid, sess, cb) {
      let maxAge = (sess.cookie && sess.cookie.maxAge) || 86400000;
      let expire = Date.now() + maxAge;
      try {
        this.client.prepare(
          `INSERT OR REPLACE INTO sessions (sid, sess, expire) VALUES (?, ?, ?)`
        ).run(sid, JSON.stringify(sess), expire);
      } catch (err) {
        return cb(err);
      }
      cb(null);
    }

    destroy(sid, cb) {
      try {
        this.client.prepare(
          `DELETE FROM sessions WHERE sid = ?`
        ).run(sid);
      } catch (err) {
        return cb(err);
      }
      cb(null);
    }

    touch(sid, sess, cb) {
      let maxAge = (sess && sess.cookie && sess.cookie.maxAge) || 86400000;
      let expire = Date.now() + maxAge;
      try {
        let info = this.client.prepare(
          `UPDATE sessions SET expire = ? WHERE sid = ? AND expire > ?`
        ).run(expire, sid, Date.now());
      } catch (err) {
        return cb(err);
      }
      cb(null);
    }

    all(cb) {
      let rows;
      try {
        rows = this.client.prepare(
          `SELECT * FROM sessions WHERE expire > ?`
        ).all(Date.now());
      } catch (err) {
        return cb(err);
      }
      cb(null, rows);
    }

    close() {
      if (this._interval) clearInterval(this._interval);
      this.client.close();
    }
  }

  return SqliteStore;
};
