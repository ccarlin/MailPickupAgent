const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const net = require('net');
const tools = require('../tools');
const metrics = require('../metrics');
const config = require('../config');
const { purgeOldFiles } = require('../index');

function checkTcpPort(host, port, timeout = 3000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(timeout);
    socket.on('connect', () => { socket.destroy(); resolve(true); });
    socket.on('error', () => { socket.destroy(); resolve(false); });
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
    socket.connect(port, host);
  });
}

router.get('/', function(req, res) {
  res.render('status', { title: 'Server Status' });
});

function countActiveUsers(sessionStore) {
  return new Promise((resolve) => {
    sessionStore.all((err, sessions) => {
      if (err) return resolve(0);
      resolve(sessions.filter(s => {
        try { return JSON.parse(s.sess).authenticated === true; } catch { return false; }
      }).length);
    });
  });
}

router.get('/api', async function(req, res) {
  const data = metrics.getMetrics();
  let pendingCount = 0;
  try {
    const files = fs.readdirSync(config.QUARANTINE_DIR);
    pendingCount = files.filter(f => path.extname(f).toLowerCase() === '.h00').length;
  } catch (err) {
    tools.logError(`Error reading quarantine directory: ${config.QUARANTINE_DIR} - ${err.message}`);
  }

  const aiEnabled = !!(config.AI_CHECK_ENABLED && config.AI_CHECK_ENABLED !== 'false');
  const saEnabled = !!(config.SPAMASSASSIN_ENABLED && config.SPAMASSASSIN_ENABLED !== 'false');

  const [aiRunning, saRunning] = await Promise.all([
    aiEnabled ? checkTcpPort(config.OLLAMA_HOST || 'localhost', Number(config.OLLAMA_PORT) || 11434) : false,
    saEnabled ? checkTcpPort(config.SPAMASSASSIN_HOST || 'localhost', Number(config.SPAMASSASSIN_PORT) || 783) : false,
  ]);

  res.json({
    totalProcessed: data.totalProcessed,
    whitelisted: data.whitelisted,
    blacklisted: data.blacklisted,
    quarantined: data.quarantined,
    released: data.released,
    pending: pendingCount,
    uptime: data.uptime,
    uptimeFormatted: metrics.formatUptime(data.uptime),
    serverStartTime: data.serverStartTime,
    aiEnabled,
    aiRunning,
    saEnabled,
    saRunning,
    loggedInUsers: await countActiveUsers(req.sessionStore)
  });
});

router.post('/api/purge', function(req, res) {
  try {
    purgeOldFiles();
    tools.logData('Auto-purge triggered from status page');
    res.json({ success: true, message: 'Purge completed' });
  } catch (err) {
    tools.logError(`Auto-purge failed: ${err.message}`);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
