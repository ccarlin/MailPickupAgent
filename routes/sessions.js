const express = require('express');
const router = express.Router();
const tools = require('../tools');

function parseSession(row) {
  try {
    const raw = row.sess ? (typeof row.sess === 'string' ? JSON.parse(row.sess) : row.sess) : row;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

router.get('/', async (req, res) => {
  const store = req.sessionStore;
  const sessions = await new Promise((resolve) => {
    if (typeof store.all !== 'function') return resolve([]);
    store.all((err, rows) => {
      if (err) {
        tools.logError(`Error fetching sessions: ${err.message}`);
        return resolve([]);
      }
      resolve(rows || []);
    });
  });

  const rows = Array.isArray(sessions)
    ? sessions.map(row => {
        const data = parseSession(row);
        if (!data || data.authenticated !== true) return null;
        const meta = data.loginMeta || {};
        return {
          sid: row.sid || 'unknown',
          ip: meta.ip || 'unknown',
          userAgent: meta.userAgent || 'unknown',
          loginTime: meta.loginTime || null,
          currentUser: row.sid === req.sessionID
        };
      }).filter(Boolean)
    : [];

  res.render('sessions', { title: 'Active Sessions', sessions: rows });
});

router.post('/:sid/destroy', async (req, res) => {
  const store = req.sessionStore;
  const targetSid = req.params.sid;

  if (!targetSid) {
    return res.status(400).json({ error: 'Missing session ID' });
  }

  if (targetSid === req.sessionID) {
    return res.status(400).json({ error: 'Cannot destroy your own session. Use the Logout link instead.' });
  }

  await new Promise((resolve) => {
    store.destroy(targetSid, (err) => {
      if (err) {
        tools.logError(`Error destroying session ${targetSid}: ${err.message}`);
        resolve(false);
      } else {
        tools.logData(`Session ${targetSid} destroyed by ${req.sessionID}`);
        resolve(true);
      }
    });
  });

  res.redirect('/sessions');
});

module.exports = router;
