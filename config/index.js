const fs = require('fs');
const path = require('path');

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

function reload() {
  const updated = loadConfig();
  Object.assign(config, updated);
}

config.reload = reload;

module.exports = config;
