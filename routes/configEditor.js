const express = require('express');
const fs = require('fs');
const path = require('path');
const net = require('net');
const axios = require('axios');
const config = require('../config');
const tools = require('../app/tools');
const { hashPassword, verifyPassword } = require('../middleware/hash');
const { purgeOldBackups } = require('../index');

const router = express.Router();

const SENSITIVE_KEYS = ['SMTP_PASS', 'AUTH_PASSWORD_HASH', 'AUTH_SECRET', 'AUTH_PASSWORD_NEW', 'ABUSEIPDB_KEY'];

function isDangerousTarget(host) {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === '0.0.0.0' || h === '::' || h === 'any') return true;
  if (h === '169.254.169.254' || h === '100.100.100.200') return true;
  if (h.startsWith('169.254.')) return true;
  if (h === 'metadata.google.internal' || h === 'metadata') return true;
  return false;
}

function getAiServerUrl(server, port) {
  let raw = String(server || '').trim();
  if (!raw) throw new Error('Server is required');

  raw = raw.replace(/^https?:\/\//i, '');

  if (/[/@?#\\]|\.\./.test(raw)) {
    throw new Error('Server must be a hostname or IP address (with optional port), not a full URL');
  }

  let hostPart;
  let portPart = String(port || '').trim();

  // Parse IPv6 [host]:port
  if (raw.startsWith('[')) {
    const closeBracket = raw.indexOf(']');
    if (closeBracket === -1) throw new Error('Invalid IPv6 address: missing closing bracket');
    hostPart = raw.slice(1, closeBracket);
    if (net.isIPv6(hostPart) !== true) throw new Error('Invalid IPv6 address');
    const after = raw.slice(closeBracket + 1);
    if (after.startsWith(':')) portPart = after.slice(1);
    else if (after !== '') throw new Error('Invalid server address');
  } else {
    // IPv6 bare (no brackets) — contains more than one colon
    if ((raw.match(/:/g) || []).length > 1) {
      if (net.isIPv6(raw) !== true) throw new Error('Invalid IPv6 address');
      hostPart = raw;
    } else {
      // IPv4 or hostname, optional :port
      const colonIdx = raw.lastIndexOf(':');
      if (colonIdx >= 0) {
        const candidate = raw.slice(colonIdx + 1);
        if (candidate && /^\d+$/.test(candidate)) {
          portPart = candidate;
          hostPart = raw.slice(0, colonIdx);
        } else {
          hostPart = raw;
        }
      } else {
        hostPart = raw;
      }
    }
  }

  if (!hostPart) throw new Error('Server is required');

  // Validate: must be IP or valid hostname
  if (net.isIPv6(hostPart) !== true && net.isIP(hostPart) === 0) {
    if (!/^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(hostPart)) {
      throw new Error('Invalid server address: ' + JSON.stringify(raw));
    }
  }

  if (isDangerousTarget(hostPart)) {
    throw new Error('Requests to ' + hostPart + ' are not allowed');
  }

  const displayHost = net.isIPv6(hostPart) ? '[' + hostPart + ']' : hostPart;
  return 'http://' + displayHost + (portPart ? ':' + portPart : '');
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
    const tmpPath = configPath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(merged, null, 2), 'utf8');
    fs.renameSync(tmpPath, configPath);

    // Hot-reload config in memory
    config.reload();

    res.status(200).json({ message: 'Configuration saved and reloaded successfully' });
  } catch (error) {
    tools.logError('Error saving config: ' + error.message);
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
    tools.logError('Error reading AI prompt file: ' + error.message);
    res.status(500).json({ message: 'Failed to read prompt file' });
  }
});

module.exports = router;
