const express = require('express');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { hashPassword } = require('../middleware/hash');

const router = express.Router();

const SENSITIVE_KEYS = ['SMTP_PASS', 'AUTH_PASSWORD_HASH', 'AUTH_SECRET', 'AUTH_PASSWORD_NEW'];

// GET - render the editor page
router.get('/', (req, res) => {
  res.render('configEditor', { title: 'Configuration Editor' });
});

// GET - return current config (mask sensitive values)
router.get('/api/config', (req, res) => {
  const displayConfig = { ...config };
  SENSITIVE_KEYS.forEach(k => {
    if (displayConfig[k]) displayConfig[k] = '********';
  });
  res.json(displayConfig);
});

// POST - save config and reload
router.post('/api/config/save', (req, res) => {
  try {
    const { values } = req.body;
    if (!values || typeof values !== 'object') {
      return res.status(400).json({ message: 'Invalid config data' });
    }

    // Hash the new password if provided, then remove plaintext field
    if (values.AUTH_PASSWORD_NEW) {
      values.AUTH_PASSWORD_HASH = hashPassword(values.AUTH_PASSWORD_NEW);
    }
    delete values.AUTH_PASSWORD_NEW;

    // Preserve sensitive fields if masked
    SENSITIVE_KEYS.forEach(k => {
      if (values[k] === '********') {
        delete values[k];
      }
    });

    const env = process.env.NODE_ENV || 'production';
    const configPath = path.resolve(__dirname, '..', 'config', `${env}.json`);

    // Backup current config
    if (fs.existsSync(configPath)) {
      const backupFile = `${configPath}_${Date.now().toString()}.bak`;
      fs.copyFileSync(configPath, backupFile);
    }

    // Read existing env config and merge with new values
    let existing = {};
    if (fs.existsSync(configPath)) {
      existing = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }

    const merged = { ...existing, ...values };
    fs.writeFileSync(configPath, JSON.stringify(merged, null, 2), 'utf8');

    // Hot-reload config in memory
    config.reload();

    res.status(200).json({ message: 'Configuration saved and reloaded successfully' });
  } catch (error) {
    console.error('Error saving config:', error);
    res.status(500).json({ message: 'Failed to save configuration' });
  }
});

module.exports = router;
