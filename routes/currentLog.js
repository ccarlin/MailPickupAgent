const express = require('express');
const router = express.Router();
const fs = require('fs');
const config = require('../config');

// The log file location is a configurable setting (CURRENT_LOG_FILE) edited
// under Directory Paths in the config editor. It is a full path, so it is
// used exactly as configured; the fallback only applies when it is unset.
const currentLogFile = () => config.CURRENT_LOG_FILE || 'mailpickup.log';

// A new log entry begins with a bracketed timestamp line written by the
// pickup batch scripts, e.g. "[Thu 06/04/2026  7:53:21.18] Running ...".
// Any following lines that do not match belong to that entry and must be
// kept in sequential order (curl progress, JSON responses, error text).
const ENTRY_START = /^\[[^\]]+\]/;

function parseEntries(text) {
  const entries = [];
  let current = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/\r$/, '');
    if (ENTRY_START.test(line)) {
      current = [line];
      entries.push(current);
    } else if (current) {
      current.push(line);
    } else if (line.trim() !== '') {
      current = [line];
      entries.push(current);
    }
  }
  return entries;
}

router.get('/', (req, res) => {
  try {
    const logFile = currentLogFile();
    if (!fs.existsSync(logFile)) {
      return res.status(404).send(`Log file not found: ${logFile}`);
    }
    const text = fs.readFileSync(logFile, 'utf8');
    const output = parseEntries(text)
      .reverse()
      .map((entry) => entry.join('\n'))
      .join('\n');
    res.type('text/plain').send(output);
  } catch (err) {
    res.status(500).send(`Failed to read log file: ${err.message}`);
  }
});

module.exports = router;
