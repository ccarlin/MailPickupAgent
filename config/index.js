const fs = require('fs');
const path = require('path');
const { verifyPassword } = require('../middleware/hash');

function getEnv() {
  return process.env.NODE_ENV || 'production';
}

function loadConfig() {
  const defaultConfig = JSON.parse(fs.readFileSync(path.join(__dirname, 'default.json'), 'utf8'));

  const envConfigPath = path.join(__dirname, `${getEnv()}.json`);
  let envConfig = {};
  if (fs.existsSync(envConfigPath)) {
    envConfig = JSON.parse(fs.readFileSync(envConfigPath, 'utf8'));
  }

  return { ...defaultConfig, ...envConfig };
}

const config = loadConfig();

function validateConfig() {
  const errors = [];
  const warnings = [];

  // --- Port validation (must be integers 1–65535) ---
  const aiEnabled = !!(config.AI_CHECK_ENABLED && config.AI_CHECK_ENABLED !== 'false');
  const saEnabled = !!(config.SPAMASSASSIN_ENABLED && config.SPAMASSASSIN_ENABLED !== 'false');
  const aiSystem = String(config.AI_SYSTEM || 'OLLAMA').toUpperCase();

  const ports = [
    { name: 'PORT',              val: config.PORT,              required: true },
    { name: 'SMTP_PORT',         val: config.SMTP_PORT,         required: false },
    { name: 'OLLAMA_PORT',       val: config.OLLAMA_PORT,       required: aiEnabled && aiSystem === 'OLLAMA' },
    { name: 'LLAMACPP_PORT',     val: config.LLAMACPP_PORT,     required: aiEnabled && aiSystem === 'LLAMACPP' },
    { name: 'SPAMASSASSIN_PORT', val: config.SPAMASSASSIN_PORT, required: saEnabled },
  ];
  for (const { name, val, required } of ports) {
    if (!val && val !== 0 && !required) continue;
    if (val === undefined || val === null || val === '') {
      if (required) {
        errors.push(`${name} is required but not set`);
      }
      continue;
    }
    const num = Number(val);
    if (!Number.isInteger(num) || num < 1 || num > 65535) {
      errors.push(`${name} must be an integer between 1 and 65535 (got: ${JSON.stringify(val)})`);
    }
  }

  // --- Numeric threshold / setting validation ---
  const numericKeys = [
    'THRESHOLD_QUARANTINE', 'THRESHOLD_DELETE',
    'PURGE_EMAIL_AFTER_DAYS', 'PURGE_LOG_AFTER_DAYS',
    'BACKUP_MAX_COUNT', 'BACKUP_MAX_DAYS',
    'TEST_EMAIL_SLEEP_SECONDS', 'OLLAMA_TIMEOUT',
    'ABUSEIPDB_TIMEOUT', 'AI_SPAM_POINTS', 'AI_HAM_POINTS',
    'ABUSEIPDB_BASE_SCORE', 'ABUSEIPDB_MAX_SCORE',
  ];
  for (const name of numericKeys) {
    const val = config[name];
    if (val === undefined || val === null || val === '') {
      warnings.push(`${name} is not set — default value will be used`);
      continue;
    }
    const num = Number(val);
    if (isNaN(num)) {
      errors.push(`${name} must be a numeric value (got: ${JSON.stringify(val)})`);
    }
  }

  // --- AI_SYSTEM validation ---
  if (aiSystem !== 'OLLAMA' && aiSystem !== 'LLAMACPP') {
    errors.push(`AI_SYSTEM must be "OLLAMA" or "LLAMACPP" (got: ${JSON.stringify(config.AI_SYSTEM)})`);
  }

  // --- NODE_ENV validation ---
  const nodeEnv = String(config.NODE_ENV || '').toLowerCase();
  if (nodeEnv !== 'development' && nodeEnv !== 'production' && nodeEnv !== 'docker') {
    warnings.push(`NODE_ENV should be "development", "production", or "docker" (got: ${JSON.stringify(config.NODE_ENV)})`);
  }

  // --- Directory existence checks (warnings only — dirs may be created later) ---
  const criticalDirs = ['QUARANTINE_DIR', 'DELETED_DIR', 'ARCHIVE_DIR', 'PROCESSING_LOG', 'QUARANTINE_LOG'];
  const mailEnableDirs = ['SMTP_QUEUE_DIR', 'SMTP_COMMAND_DIR', 'SMTP_LOG_DIR'];
  for (const name of [...criticalDirs, ...mailEnableDirs]) {
    const dir = config[name];
    if (!dir) {
      if (mailEnableDirs.includes(name)) {
        warnings.push(`${name} is not set — MailEnable integration will not work`);
      } else {
        errors.push(`${name} is not set`);
      }
      continue;
    }
    if (!fs.existsSync(dir)) {
      if (mailEnableDirs.includes(name)) {
        warnings.push(`${name} "${dir}" does not exist — MailEnable integration may fail`);
      } else {
        warnings.push(`${name} "${dir}" does not exist — it will be created on startup`);
      }
    }
  }

  // --- Auth secret check ---
  if (!config.AUTH_SECRET || config.AUTH_SECRET === 'change-this-to-a-random-secret-in-production') {
    warnings.push('AUTH_SECRET is still set to the default value — generate a random secret if enabling remote authentication');
  }

  // --- Cert + default password check ---
  if (config.CERT_PATH) {
    const pwHash = config.AUTH_PASSWORD_HASH;
    if (!pwHash || verifyPassword('admin', pwHash)) {
      errors.push('Certificate is configured but AUTH_PASSWORD_HASH is still the default');
    }
  }

  // --- Report results ---
  for (const w of warnings) {
    console.warn(`[config] WARNING: ${w}`);
  }
  for (const e of errors) {
    console.error(`[config] ERROR: ${e}`);
  }

  if (errors.length > 0) {
    console.error(`\n[config] ${errors.length} critical configuration error(s) found. Fix them before restarting.`);
    process.exit(1);
  }

  if (warnings.length > 0) {
    console.warn(`[config] ${warnings.length} non-critical configuration warning(s) — see above.\n`);
  }
}

validateConfig();

function reload() {
  const updated = loadConfig();
  Object.assign(config, updated);
}

config.reload = reload;

module.exports = config;
