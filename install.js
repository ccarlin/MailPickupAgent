const fs = require('fs');
const path = require('path');

function checkDir(label, dir) {
  if (!fs.existsSync(dir)) {
    console.warn(`Warning: ${label} (${dir}) does not exist. Create it or update the path in your config.`);
    return;
  }
  try {
    fs.accessSync(dir, fs.constants.R_OK | fs.constants.W_OK);
  } catch {
    console.warn(`Warning: ${label} (${dir}) is not readable/writable. Check permissions or update the path in your config.`);
  }
}

function loadConfig() {
  const defaultConfig = JSON.parse(fs.readFileSync(path.join(__dirname, 'config', 'default.json'), 'utf8'));
  const env = process.env.NODE_ENV || 'production';
  const envConfigPath = path.join(__dirname, 'config', `${env}.json`);
  let envConfig = {};
  if (fs.existsSync(envConfigPath)) {
    envConfig = JSON.parse(fs.readFileSync(envConfigPath, 'utf8'));
  }
  return { ...defaultConfig, ...envConfig };
}

const config = loadConfig();

checkDir('SMTP_QUEUE_DIR', config.SMTP_QUEUE_DIR);
checkDir('SMTP_COMMAND_DIR', config.SMTP_COMMAND_DIR);

// Create config/rules.json from sample if it doesn't exist
const rulesFile = path.join(__dirname, 'config', 'rules.json');
const rulesSample = path.join(__dirname, 'config', 'rules.json.sample');
if (!fs.existsSync(rulesFile) && fs.existsSync(rulesSample)) {
  fs.copyFileSync(rulesSample, rulesFile);
  console.log('Created config/rules.json from sample. Edit it or use the rules editor to configure your rules.');
}
