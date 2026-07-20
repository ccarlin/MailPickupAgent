const express = require('express');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const config = require('../config');
const { hashPassword, verifyPassword } = require('../middleware/hash');
const { purgeOldBackups } = require('../index');

const router = express.Router();

const SENSITIVE_KEYS = ['SMTP_PASS', 'AUTH_PASSWORD_HASH', 'AUTH_SECRET', 'AUTH_PASSWORD_NEW', 'ABUSEIPDB_KEY'];

function getAiServerUrl(server, port) {
  const configuredServer = String(server || '').trim();
  if (!configuredServer) throw new Error('Server is required');

  const url = new URL(/^https?:\/\//i.test(configuredServer) ? configuredServer : `http://${configuredServer}`);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Server must use HTTP or HTTPS');
  if (!url.port && port) url.port = String(port);
  return url.toString().replace(/\/$/, '');
}

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

// GET - retrieve models available from the configured AI server
router.get('/api/config/ai-models', async (req, res) => {
  try {
    const system = String(req.query.system || '').toUpperCase();
    const server = req.query.server;
    const port = req.query.port;
    const baseUrl = getAiServerUrl(server, port);

    let models;
    if (system === 'OLLAMA') {
      const response = await axios.get(`${baseUrl}/api/tags`, { timeout: 5000 });
      models = (response.data.models || []).map(model => model.name).filter(Boolean);
    } else if (system === 'LLAMACPP') {
      const response = await axios.get(`${baseUrl}/v1/models`, { timeout: 5000 });
      models = (response.data.data || []).map(model => model.id).filter(Boolean);
    } else {
      return res.status(400).json({ message: 'Unsupported AI system' });
    }

    res.json({ models: [...new Set(models)].sort() });
  } catch (error) {
    res.status(502).json({ message: `Could not retrieve models: ${error.message}` });
  }
});

// POST - save config and reload
router.post('/api/config/save', (req, res) => {
  try {
    const { values } = req.body;
    if (!values || typeof values !== 'object') {
      return res.status(400).json({ message: 'Invalid config data' });
    }

    // Require non-default password when enabling certificate
    if (values.CERT_PATH && values.CERT_PATH.trim() !== '') {
      const newPassword = values.AUTH_PASSWORD_NEW;
      const currentHash = config.AUTH_PASSWORD_HASH;

      let isDefault = false;
      if (newPassword) {
        if (newPassword === 'admin') {
          isDefault = true;
        }
      } else {
        if (!currentHash || verifyPassword('admin', currentHash)) {
          isDefault = true;
        }
      }

      if (isDefault) {
        return res.status(400).json({ message: 'You must change the admin password from the default before enabling a certificate.' });
      }
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

    // Enforce backup retention limits
    purgeOldBackups();

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

// GET - return contents of AI spam check prompt file
router.get('/api/config/ai-prompt', (req, res) => {
  try {
    const promptPath = config.AI_SPAM_CHECK_PROMPT_PATH
      ? path.resolve(__dirname, '..', config.AI_SPAM_CHECK_PROMPT_PATH)
      : path.resolve(__dirname, '..', 'config', 'aiSpamCheckPrompt.md');
    if (!fs.existsSync(promptPath)) {
      return res.status(404).json({ message: 'Prompt file not found' });
    }
    const content = fs.readFileSync(promptPath, 'utf8');
    res.json({ content });
  } catch (error) {
    console.error('Error reading AI prompt file:', error);
    res.status(500).json({ message: 'Failed to read prompt file' });
  }
});

module.exports = router;
