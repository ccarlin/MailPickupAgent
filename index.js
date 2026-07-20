const fs = require('fs');
const path = require('path');
const PostalMime = require('postal-mime');
const nodemailer = require('nodemailer');
const { buildAllTestEmails } = require('./test/testEmails');
const tools = require('./app/tools');
const config = require('./config');
const metrics = require('./app/metrics');
const notifications = require('./app/notifications');
const { checkWhitelist } = require('./app/whitelist');
const { checkBlacklist, matchCountry } = require('./app/blacklist');
const { scoreKeywordFilters } = require('./app/keyword');
const { checkAiSpam } = require('./app/ai');
const { checkSpamAssassin } = require('./app/spamassassin');
const { check: checkAbuseIpdb } = require('./app/abuseipdb');
const { extractOriginatingIp } = require('./app/shared');
const { recordHit } = require('./app/ruleHits');

const QUARANTINE_DIR = config.QUARANTINE_DIR;
const DELETED_DIR = config.DELETED_DIR;
const SMTP_HOST = config.SMTP_HOST;
const SMTP_PORT = config.SMTP_PORT;
const RULES_FILE = './config/rules.json';
const AI_CHECK_ENABLED = config.AI_CHECK_ENABLED;
const SPAMASSASSIN_ENABLED = config.SPAMASSASSIN_ENABLED;
const TEST_EMAIL_SLEEP_SECONDS = Number(config.TEST_EMAIL_SLEEP_SECONDS || 10) || 10;
const THRESHOLD_QUARANTINE = Number(config.THRESHOLD_QUARANTINE || 5);
const THRESHOLD_DELETE = Number(config.THRESHOLD_DELETE || 15);
const HEADER_SEPARATOR = '\r\n\r\n';
const PROCESSING_LOG_DIR = config.PROCESSING_LOG;
const QUARANTINE_LOG_DIR = config.QUARANTINE_LOG;

// Cache of recently released/recovered email MessageIDs to prevent re-processing
const RECENTLY_RELEASED_TTL = 5 * 60 * 1000; // 5 minutes
const recentlyReleased = new Map();

function purgeExpiredCacheEntries() {
  const cutoff = Date.now() - RECENTLY_RELEASED_TTL;
  for (const [id, timestamp] of recentlyReleased) {
    if (timestamp < cutoff) recentlyReleased.delete(id);
  }
}
const processingLogPath = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${PROCESSING_LOG_DIR}/processing-${y}${m}${day}.log`;
};

[QUARANTINE_DIR, DELETED_DIR, PROCESSING_LOG_DIR, QUARANTINE_LOG_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

const transporter = nodemailer.createTransport({
  host: SMTP_HOST, port: SMTP_PORT, secure: false,
  tls: {
    rejectUnauthorized: false
  }
});

function loadRules() {
  try {
    const data = fs.readFileSync(RULES_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    return { whitelist: {}, blacklist: {} };
  }
}

function logProcessingEntry(messageId, sizeKb, ip, sender, recipients, subject, processTimeSec, result, spamInfo, spamScore) {
  const pad = (n) => String(n).padStart(2, '0');
  const d = new Date();
  const dateTime = `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${String(d.getFullYear()).slice(-2)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const s = (v) => String(v).replace(/\t/g, ' ').replace(/[\r\n]+/g, ' ');
  const line = [
    dateTime, s(messageId), 'SMTP-IN(0)', Math.round(sizeKb), 'ccarlin.com',
    s(ip || ''), s(sender), s(recipients), s(subject),
    processTimeSec.toFixed(3), s(result), s(spamInfo), spamScore
  ].join('\t');
  try {
    fs.appendFileSync(processingLogPath(), line + '\n', 'utf8');
  } catch (err) {
    tools.logError(`Failed to write processing log: ${err.message}`);
  }
}

async function updateEmailHeaders(messagePath, destMessageName, quarantineReasons, spamScore, country, spamDetailInfo) {
  try {
    let message = fs.readFileSync(messagePath, 'utf8');
    const headerEndIndex = message.indexOf(HEADER_SEPARATOR);
    if (headerEndIndex === -1) {
      tools.logError(`Invalid email format, no header-body separation found`);
      return;
    }
    let headers = message.substring(0, headerEndIndex);
    let body = message.substring(headerEndIndex + HEADER_SEPARATOR.length);
    headers += `\r\nX-MPA-Scan: Scanned by MailPickupAgent 1.0 for ${config.HOSTNAME || process.env.HOSTNAME || 'localhost'}\r\n`;
    headers += `X-MPA-Msgid: ${destMessageName}\r\n`;
    headers += `X-MPA-SpamReason: ${quarantineReasons.join('; ')}\r\n`;
    headers += `X-MPA-SpamScore: ${spamScore}\r\n`;
    headers += `X-MPA-SpamDetail: ${spamDetailInfo.replace(/:/g, '-')}\r\n`;
    if (country) {
      headers += `X-MPA-Country: ${country}\r\n`;
    }    
    fs.writeFileSync(messagePath, headers + HEADER_SEPARATOR + body, 'utf8');
    tools.logData(`Updated email headers with quarantine reasons`);
  } catch (err) {
    tools.logError(`Failed to update email headers: ${err.message}`);
  }
}

async function processEmail(controlFilePath, messagePath, rules) {
  try {
    const processStartTime = performance.now();
    const message = fs.readFileSync(messagePath, 'utf8');
    const commandData = fs.readFileSync(controlFilePath, 'utf8');
    const userMatch = commandData.match(/^User=(.*)$/m);
    if (userMatch && userMatch[1].trim()) {
        tools.logData(`Skipping outbound email submitted by user: ${userMatch[1].trim()}`, "INFO");
        return;
    }

    const parsed = await PostalMime.parse(message);
    const fromAddr = parsed.from?.address || 'unknown';
    const subjectText = parsed.subject || '(no subject)';

    tools.logData(`Processing email: ${subjectText} from ${fromAddr}`);

    const destMessageName = path.basename(messagePath);
    const messageId = path.parse(messagePath).name;

    purgeExpiredCacheEntries();
    if (recentlyReleased.has(messageId)) {
      recentlyReleased.delete(messageId);
      tools.logData(`Skipping recently released/recovered email ${messageId}`);
      return;
    }
    const fileStats = fs.statSync(messagePath);
    const sizeKb = fileStats.size / 1024;
    const recipientAddresses = (parsed.to || []).map(v => v.address || '').filter(Boolean);
    const recipientStr = recipientAddresses.join(', ');
    const recipients = (parsed.to || []).map(v => (v.address || '').split('@')[0].toUpperCase()).filter(Boolean);
    const originatingIp = extractOriginatingIp(commandData);
    tools.logData(`Extracted originating IP: ${originatingIp}, Recipients: ${recipients.join(', ')}`, "DEBUG");

    // 1.0 Whitelist check
    const wl = rules.whitelist || {};
    const wlResult = checkWhitelist(fromAddr, originatingIp, recipients, wl);
    if (wlResult.whitelisted) {
      recordHit(wlResult.ruleType, wlResult.rule);
      metrics.increment('whitelisted');
      const elapsed = (performance.now() - processStartTime) / 1000;
      logProcessingEntry(messageId, sizeKb, originatingIp, fromAddr, recipientStr, subjectText, elapsed, 'Whitelisted', wlResult.reason, 0);
      tools.logData(`Sender ${fromAddr} is whitelisted, releasing`);
      metrics.addTiming('process', performance.now() - processStartTime);
      return;
    }

    const bl = rules.blacklist || {};
    const countryResult = matchCountry(originatingIp, bl.countries || []);
    const blResult = checkBlacklist(fromAddr, originatingIp, recipients, bl, rules.allowedTLDs);

    // 2.0 Blacklist check - Allowed TLDs enforcement
    if (blResult.matched && blResult.type === 'tld') {
      metrics.increment('blacklisted');
      tools.logData(`From address TLD not in allowedTLDs, deleting`);
      const elapsed = (performance.now() - processStartTime) / 1000;
      logProcessingEntry(messageId, sizeKb, originatingIp, fromAddr, recipientStr, subjectText, elapsed, 'Blacklisted', 'TLD not allowed', 99);
      await updateEmailHeaders(messagePath, destMessageName, [`Blacklisted TLD(99) - ${blResult.detail}`], 99, countryResult.country, 'Blacklisted TLD(99)');
      await deleteEmail(controlFilePath, messagePath, destMessageName, fromAddr);
      metrics.addTiming('process', performance.now() - processStartTime);
      return;
    }

    // 2.1 Blacklist check — Blacklisted sender
    if (blResult.matched && blResult.type === 'sender') {
      recordHit(blResult.ruleType, blResult.rule);
      metrics.increment('blacklisted');
      tools.logData(`Sender ${fromAddr} is blacklisted, deleting`);
      const elapsed = (performance.now() - processStartTime) / 1000;
      logProcessingEntry(messageId, sizeKb, originatingIp, fromAddr, recipientStr, subjectText, elapsed, 'Blacklisted', 'Blacklisted sender', 99);
      await updateEmailHeaders(messagePath, destMessageName, [`Blacklisted Sender(99) - ${blResult.detail}`], 99, countryResult.country, 'Blacklisted Sender(99)');
      await deleteEmail(controlFilePath, messagePath, destMessageName, fromAddr);
      metrics.addTiming('process', performance.now() - processStartTime);
      return;
    }

    // 2.2 Blacklist check - Blacklisted IP
    if (blResult.matched && blResult.type === 'ip') {
      recordHit(blResult.ruleType, blResult.rule);
      metrics.increment('blacklisted');
      tools.logData(`Originating IP ${originatingIp} is blacklisted, deleting`);
      const elapsed = (performance.now() - processStartTime) / 1000;
      logProcessingEntry(messageId, sizeKb, originatingIp, fromAddr, recipientStr, subjectText, elapsed, 'Blacklisted', 'Blacklisted IP', 99);
      await updateEmailHeaders(messagePath, destMessageName, [`Blacklisted IP(99) - ${blResult.detail}`], 99, countryResult.country, 'Blacklisted IP(99)');
      await deleteEmail(controlFilePath, messagePath, destMessageName, fromAddr);
      metrics.addTiming('process', performance.now() - processStartTime);
      return;
    }

    // 2.3 Blacklist check - Blacklisted country
    if (countryResult.matched) {
      const countryRule = (bl.countries || []).find(country => String(country).toUpperCase() === countryResult.country);
      recordHit('blacklist.countries', countryRule);
      metrics.increment('blacklisted');
      tools.logData(`Originating country ${countryResult.country} is blacklisted, deleting`);
      const elapsed = (performance.now() - processStartTime) / 1000;
      logProcessingEntry(messageId, sizeKb, originatingIp, fromAddr, recipientStr, subjectText, elapsed, 'Blacklisted', 'Blacklisted country', 99);
      await updateEmailHeaders(messagePath, destMessageName, [`Blacklisted Country(99) - Country ${countryResult.country}`], 99, countryResult.country, 'Blacklisted Country(99)');
      await deleteEmail(controlFilePath, messagePath, destMessageName, fromAddr);
      metrics.addTiming('process', performance.now() - processStartTime);
      return;
    }

    // 2.4 Blacklist check - Combo rules
    if (bl.combos && bl.combos.length) {
      const { findMatchingCombo } = require('./app/shared');
      const matchedCombo = findMatchingCombo(parsed, bl.combos, recipients, originatingIp);
      if (matchedCombo) {
        recordHit('blacklist.combos', matchedCombo);
        metrics.increment('blacklisted');
        tools.logData(`Combo rule matched, deleting`);
        const elapsed = (performance.now() - processStartTime) / 1000;
        logProcessingEntry(messageId, sizeKb, originatingIp, fromAddr, recipientStr, subjectText, elapsed, 'Blacklisted', 'Combo rule matched', 99);
        await updateEmailHeaders(messagePath, destMessageName, [`Combo Matched(99) - Rule Matched `], 99, countryResult.country, 'Combo Matched(99)');
        await deleteEmail(controlFilePath, messagePath, destMessageName, fromAddr);
        metrics.addTiming('process', performance.now() - processStartTime);
        return;
      }
    }

    // 3.0 Quarantine check - Keyword filter scoring
    let quarantineReasons = [];
    let spamInfoParts = [];
    let spamScore = 0;
    const keywordResult = scoreKeywordFilters(parsed, bl.keywordFilters, recipients);
    keywordResult.matchedFilters.forEach(filter => recordHit('blacklist.keywordFilters', filter));
    if (keywordResult.score > 0) {
      const keyWordInfo = `Keywords(${keywordResult.score})`; 
      spamInfoParts.push(keyWordInfo);
      spamScore += keywordResult.score;
      quarantineReasons.push(`${keyWordInfo} - ${keywordResult.matches.map(m => `${m.name}(${m.score})`).join(', ')}`);
    }

    // 3.1 Quarantine check - SpamAssassin
    if (SPAMASSASSIN_ENABLED) {
      const saStart = performance.now();
      const saResult = await checkSpamAssassin(message);
      metrics.addTiming('sa', performance.now() - saStart);
      if (saResult) {
        tools.logData(`SpamAssassin score: ${saResult.score}/${saResult.threshold}, isSpam: ${saResult.isSpam}`);
        spamScore += saResult.score;
        const saInfo = `SpamAssassin(${saResult.score})`;
        spamInfoParts.push(saInfo);
        if (saResult.fullReport && saResult.score > 0) 
          quarantineReasons.push(`${saInfo} - ${saResult.fullReport}`);        
      } else {
        tools.logError('SpamAssassin check unavailable, continuing with other checks');
      }
    }

    // 3.2 Quarantine check - AI spam check
    if (AI_CHECK_ENABLED) {
      const aiStart = performance.now();
      const { aiSpamResult, aiScore, aiReasons } = await checkAiSpam(fromAddr, subjectText, parsed);
      metrics.addTiming('ai', performance.now() - aiStart);
      spamScore += aiScore;    
      spamInfoParts.push(`AI Check(${aiScore})`);
      if (aiSpamResult) {      
        quarantineReasons.push(aiReasons);
      }
    }

    // 3.3 Quarantine check - AbuseIPDB
    if (config.ABUSEIPDB_KEY) {
      const abuseStart = performance.now();
      const abuseResult = await checkAbuseIpdb(originatingIp);
      metrics.addTiming('abuseipdb', performance.now() - abuseStart);
      if (abuseResult && abuseResult.abuseConfidenceScore > 0) {
        const abuseBase = Number(config.ABUSEIPDB_BASE_SCORE || 5);
        const abuseMax = Number(config.ABUSEIPDB_MAX_SCORE || 15);
        const abuseScore = Math.round((abuseBase + (abuseMax - abuseBase) * (abuseResult.abuseConfidenceScore / 100)) * 10) / 10;
        spamScore += abuseScore;
        const abuseInfo = `AbuseIPDB(${abuseScore})`;
        spamInfoParts.push(abuseInfo);
        quarantineReasons.push(`${abuseInfo} - confidence: ${abuseResult.abuseConfidenceScore}, reports: ${abuseResult.totalReports}, country: ${abuseResult.countryCode}, isp: ${abuseResult.isp}`);
      }
    }

    // 4.0 Process results
    const processElapsed = (performance.now() - processStartTime) / 1000;
    let spamDetailInfo = spamInfoParts.join('; ');
    tools.logData(`Final spam score: ${spamScore} (Thresholds: Quarantine ${THRESHOLD_QUARANTINE}, Delete ${THRESHOLD_DELETE})`);
    if (spamScore >= THRESHOLD_DELETE) {
      metrics.increment('blacklisted');
      logProcessingEntry(messageId, sizeKb, originatingIp, fromAddr, recipientStr, subjectText, processElapsed, 'Blacklisted', spamDetailInfo, spamScore);
      tools.logData(`Deleting email due to score ${spamScore} >= ${THRESHOLD_DELETE}. Reasons: ${quarantineReasons.join('; ')}`);
      await updateEmailHeaders(messagePath, destMessageName, quarantineReasons, spamScore, countryResult.country, spamDetailInfo);
      await deleteEmail(controlFilePath, messagePath, destMessageName, fromAddr);
    } else if (spamScore >= THRESHOLD_QUARANTINE) {
      metrics.increment('quarantined');
      logProcessingEntry(messageId, sizeKb, originatingIp, fromAddr, recipientStr, subjectText, processElapsed, 'Quarantined', spamDetailInfo, spamScore);
      tools.logData(`Quarantining email due to score ${spamScore} >= ${THRESHOLD_QUARANTINE}. Reasons: ${quarantineReasons.join('; ')}`);
      await updateEmailHeaders(messagePath, destMessageName, quarantineReasons, spamScore, countryResult.country, spamDetailInfo);
      await quarantineEmail(controlFilePath, messagePath, destMessageName, fromAddr);

      metrics.emitQuarantine({
        filepath: destMessageName.replace('.MAI', ''),
        from: fromAddr,
        subject: subjectText,
        recipients: recipients.join(', '),
        recipientAddresses: recipientAddresses,
        spamScore: spamScore,
        antiSpam: spamDetailInfo,
        date: new Date().toLocaleString(),
        reason: quarantineReasons.join('; ')
      });

      notifications.notifyQuarantine({
        from: fromAddr,
        subject: subjectText,
        recipientAddresses: recipientAddresses
      }).catch(err => tools.logError(`Push notification failed: ${err.message}`));
    } else {
      metrics.increment('released');
      if (spamDetailInfo.length == 0) spamDetailInfo = 'No significant spam indicators';
      logProcessingEntry(messageId, sizeKb, originatingIp, fromAddr, recipientStr, subjectText, processElapsed, 'Released', spamDetailInfo, spamScore);
      tools.logData(`Releasing email with score ${spamScore}.`);
    }
    metrics.addTiming('process', performance.now() - processStartTime);
  } catch (error) {
    tools.logError(`Error processing ${controlFilePath} and ${messagePath}: ${error}`);
  }
}

async function quarantineEmail(controlFilePath, messagePath, destMessageName, fromAddr) {
  const destHeader = path.join(QUARANTINE_DIR, destMessageName.replace(".MAI", ".H00"));
  const destMessage = path.join(QUARANTINE_DIR, destMessageName);
  if (fromAddr) {
    fs.appendFileSync(controlFilePath, `\r\nFromAddr=${fromAddr}\r\n`, 'utf8');
  }
  fs.renameSync(controlFilePath, destHeader);
  fs.renameSync(messagePath, destMessage);
  tools.logData(`Email quarantined: ${destHeader}, ${destMessage}`);
}

async function deleteEmail(controlFilePath, messagePath, destMessageName, fromAddr) {
  const destHeader = path.join(DELETED_DIR, destMessageName.replace(".MAI", ".H00"));
  const destMessage = path.join(DELETED_DIR, destMessageName);
  if (fromAddr) {
    fs.appendFileSync(controlFilePath, `\r\nFromAddr=${fromAddr}\r\n`, 'utf8');
  }
  fs.renameSync(controlFilePath, destHeader);
  fs.renameSync(messagePath, destMessage);
  tools.logData(`Email deleted: ${destHeader}, ${destMessage}`);
}

function wipeall() {
  let wipedCount = 0;
  const dirs = [
    { dir: QUARANTINE_DIR, label: 'quarantine' },
    { dir: DELETED_DIR, label: 'deleted' },
    { dir: PROCESSING_LOG_DIR, label: 'processing logs' },
    { dir: QUARANTINE_LOG_DIR, label: 'quarantine logs' },
  ];

  dirs.forEach(({ dir, label }) => {
    if (!dir || !fs.existsSync(dir)) {
      tools.logData(`WipeAll: directory not found, skipping ${label}: ${dir}`);
      return;
    }
    let entries;
    try {
      entries = fs.readdirSync(dir);
    } catch (err) {
      tools.logError(`WipeAll: error reading ${label} directory ${dir}: ${err.message}`);
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isFile()) {
          fs.unlinkSync(fullPath);
          wipedCount++;
          tools.logData(`WipeAll: removed ${fullPath}`);
        }
      } catch (err) {
        tools.logError(`WipeAll: error processing ${fullPath}: ${err.message}`);
      }
    }
  });

  const rootLog = path.join(__dirname, 'mailpickup.log');
  if (fs.existsSync(rootLog)) {
    try {
      fs.unlinkSync(rootLog);
      wipedCount++;
      tools.logData(`WipeAll: removed ${rootLog}`);
    } catch (err) {
      tools.logError(`WipeAll: error removing ${rootLog}: ${err.message}`);
    }
  }

  tools.logData(`WipeAll complete: ${wipedCount} file(s) removed`);
  return wipedCount;
}

function purgeOldFiles() {
  const emailRetentionDays = Number(config.PURGE_EMAIL_AFTER_DAYS) || 30;
  const logRetentionDays = Number(config.PURGE_LOG_AFTER_DAYS) || 30;
  const emailCutoff = Date.now() - emailRetentionDays * 24 * 60 * 60 * 1000;
  const logCutoff = Date.now() - logRetentionDays * 24 * 60 * 60 * 1000;
  let purgedCount = 0;

  const emailDirs = [
    { dir: DELETED_DIR, label: 'deleted emails' },
  ];

  const logDirs = [
    { dir: config.PROCESSING_LOG, label: 'processing logs' },
    { dir: config.QUARANTINE_LOG, label: 'quarantine logs' },
  ];

  if (config.PURGE_INCLUDE_SMTP_LOGS) {
    logDirs.push({ dir: config.SMTP_LOG_DIR, label: 'SMTP logs' });
  }

  const purgeDir = (dirConfig, cutoff, label) => {
    const { dir } = dirConfig;
    if (!dir || !fs.existsSync(dir)) {
      tools.logData(`Purge: directory not found, skipping ${label}: ${dir}`);
      return;
    }
    let entries;
    try {
      entries = fs.readdirSync(dir);
    } catch (err) {
      tools.logError(`Purge: error reading ${label} directory ${dir}: ${err.message}`);
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isFile() && stat.mtimeMs < cutoff) {
          fs.unlinkSync(fullPath);
          purgedCount++;
          tools.logData(`Purge: removed ${fullPath}`);
        }
      } catch (err) {
        tools.logError(`Purge: error processing ${fullPath}: ${err.message}`);
      }
    }
  };

  tools.logData(`Purge: email retention ${emailRetentionDays} days, log retention ${logRetentionDays} days, include SMTP logs: ${config.PURGE_INCLUDE_SMTP_LOGS}`);

  emailDirs.forEach(d => purgeDir(d, emailCutoff, d.label));
  logDirs.forEach(d => purgeDir(d, logCutoff, d.label));

  tools.logData(`Purge complete: ${purgedCount} file(s) removed`);

  purgeOldBackups();
}

function purgeOldBackups() {
  const maxCount = Number(config.BACKUP_MAX_COUNT) || 5;
  const maxDays = Number(config.BACKUP_MAX_DAYS) || 90;
  const cutoff = Date.now() - maxDays * 24 * 60 * 60 * 1000;
  const configDir = path.join(__dirname, 'config');
  let purgedCount = 0;

  if (!fs.existsSync(configDir)) return;

  let entries;
  try {
    entries = fs.readdirSync(configDir);
  } catch (err) {
    tools.logError(`Purge: error reading config directory ${configDir}: ${err.message}`);
    return;
  }

  const bakFiles = entries
    .filter(e => e.endsWith('.bak'))
    .map(e => {
      const fullPath = path.join(configDir, e);
      try {
        return { name: e, fullPath, mtime: fs.statSync(fullPath).mtimeMs };
      } catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => a.mtime - b.mtime);

  const remaining = [];
  for (const file of bakFiles) {
    if (file.mtime < cutoff) {
      try {
        fs.unlinkSync(file.fullPath);
        purgedCount++;
        tools.logData(`Purge: removed expired backup ${file.fullPath}`);
      } catch (err) {
        tools.logError(`Purge: error removing ${file.fullPath}: ${err.message}`);
      }
    } else {
      remaining.push(file);
    }
  }

  if (remaining.length > maxCount) {
    const toRemove = remaining.length - maxCount;
    for (let i = 0; i < toRemove; i++) {
      try {
        fs.unlinkSync(remaining[i].fullPath);
        purgedCount++;
        tools.logData(`Purge: removed excess backup ${remaining[i].fullPath}`);
      } catch (err) {
        tools.logError(`Purge: error removing ${remaining[i].fullPath}: ${err.message}`);
      }
    }
  }

  if (purgedCount > 0) {
    tools.logData(`Purge backups complete: ${purgedCount} backup(s) removed (max ${maxCount}, max ${maxDays} days)`);
  }
}

function printUsage() {
  tools.logData('Usage: node index.js <messageID> <queue-type>');
  tools.logData('Usage: node index.js --test [good|quarantine|blacklist]');
  tools.logData('Usage: node index.js --purge');
  tools.logData('Usage: node server.js (to start the web server)');
  tools.logData('--test : Send a test email to verify configuration (defaults to good)');
  tools.logData('--purge : Purge deleted emails and log files older than PURGE_AFTER_DAYS');
  tools.logData('--wipeall : Delete all log files and all emails in the queue and deleted folders');
  tools.logData('--help : Show this help message');
  tools.logData('Example: node index.js "B935428C1B4A4B8FADC12BC6A4358875.MAI" "SMTP"');
  tools.logData('Example: node index.js --test quarantine');
}

module.exports = {
  processEmail,
  loadRules,
  buildAllTestEmails,
  updateEmailHeaders,
  extractOriginatingIp,
  deleteEmail,
  quarantineEmail,
  scoreKeywordFilters,
  purgeOldFiles,
  purgeOldBackups,
  wipeall,
  recentlyReleased
};

if (require.main === module) {
  const args = process.argv.slice(2);
  const testArgIndex = args.findIndex(arg => arg === '--test' || arg.startsWith('--test='));
  let testType = null;

  if (testArgIndex !== -1) {
    const testArg = args[testArgIndex];
    if (testArg === '--test') {
      const nextArg = args[testArgIndex + 1];
      if (nextArg && !nextArg.startsWith('-')) {
        testType = nextArg.toLowerCase();
      } else {
        testType = 'good';
      }
    } else {
      testType = testArg.split('=')[1]?.toLowerCase() || 'good';
    }
  }

  if (testType) {
    const tests = buildAllTestEmails();
    (async () => {
      for (let index = 0; index < tests.length; index += 1) {
        const t = tests[index];
        try {
          const mailOpts = {
            from: t.mail.from || config.TEST_EMAIL_FROM || '"MailPickupAgent" <no-reply@localhost>',
            to: t.mail.to || config.TEST_EMAIL_RECIPIENT || 'test@localhost',
            subject: t.mail.subject || 'MailPickupAgent test email',
            html: t.mail.html || '',
            headers: t.mail.headers || {},
          };
          await transporter.sendMail(mailOpts);
          tools.logData(`Sent test '${t.name}' to ${mailOpts.to}`);
        } catch (err) {
          tools.logError(`Failed to send test '${t.name}': ${err.message}`);
        }
        if (index < tests.length - 1) {
          tools.logData(`Sleeping ${TEST_EMAIL_SLEEP_SECONDS} seconds before sending next test email...`);
          await tools.sleep(TEST_EMAIL_SLEEP_SECONDS * 1000);
        }
      }
      process.exit(0);
    })();
  }
  else if (args.includes('--wipeall')) {
    wipeall();
    process.exit(0);
  }
  else if (args.includes('--purge')) {
    purgeOldFiles();
    process.exit(0);
  }
  else if (args.length !== 2 || ['-h', '--help'].includes(args[0])) {
    printUsage();
    process.exit(args.length === 2 ? 0 : 1);
  }
  else {
    const [messageFile, queueType] = args;
    const { messagePath, controlFilePath } = tools.buildFilePaths(messageFile, queueType);
    processEmail(controlFilePath, messagePath, loadRules()).then(() => process.exit(0));
  }
}
