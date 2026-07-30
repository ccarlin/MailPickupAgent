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
  if (config.CERT_PATH) {
    const pwHash = config.AUTH_PASSWORD_HASH;
    if (!pwHash || verifyPassword('admin', pwHash)) {
      console.error('SECURITY ERROR: Certificate is configured but the admin password is still the default.');
      console.error('Change it via the Configuration Editor (Security section > Admin Password field).');
      process.exit(1);
    }
  }
}

validateConfig();

function reload() {
  const updated = loadConfig();
  Object.assign(config, updated);
}

config.reload = reload;

module.exports = config;
