const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { SpamAssassinClient } = require('spamassassin-client');
const PostalMime = require('postal-mime');
const nodemailer = require('nodemailer');
const { buildAllTestEmails } = require('./testEmails');
const tools = require('./tools');
const MMDBReader = require('mmdb-reader');
const mmdb = new MMDBReader(path.join(__dirname, 'GeoLite2-Country.mmdb'));
const config = require('./config');
const metrics = require('./metrics');

const QUARANTINE_DIR = config.QUARANTINE_DIR;
const DELETED_DIR = config.DELETED_DIR;
const SMTP_HOST = config.SMTP_HOST;
const SMTP_PORT = config.SMTP_PORT;
const RULES_FILE = './config/rules.json';
const AI_CHECK_ENABLED = config.AI_CHECK_ENABLED;
const OLLAMA_HOST = config.OLLAMA_SERVER;
const OLLAMA_PORT = config.OLLAMA_PORT;
const OLLAMA_MODEL = config.OLLAMA_MODEL;
const SPAMASSASSIN_ENABLED = config.SPAMASSASSIN_ENABLED;
const SPAMASSASSIN_HOST = config.SPAMASSASSIN_HOST;
const SPAMASSASSIN_PORT = Number(config.SPAMASSASSIN_PORT);
const TEST_EMAIL_SLEEP_SECONDS = Number(config.TEST_EMAIL_SLEEP_SECONDS || 10) || 10;
const THRESHOLD_QUARANTINE = Number(config.THRESHOLD_QUARANTINE || 5);
const THRESHOLD_DELETE = Number(config.THRESHOLD_DELETE || 15);
const HEADER_SEPARATOR = '\r\n\r\n';
const PROCESSING_LOG_DIR = config.PROCESSING_LOG;
const QUARANTINE_LOG_DIR = config.QUARANTINE_LOG;
const aiSpamPoints = Number(config.AI_SPAM_POINTS || 5) || 5;
const aiHamPoints = Number((config.AI_HAM_POINTS || 2.5) * -1) || -2.5;

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
    // Do not fail on invalid certificates
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

function matchSender(address, senders, recipients) {
  if (!senders || !senders.length) return false;
  const addrLower = address.toLowerCase();
  for (const entry of senders) {
    if (typeof entry === 'object') {
      if (entry.recipient && recipients) {
        if (!recipients.some(r => r.toLowerCase() === entry.recipient.toLowerCase())) continue;
      }
      if (entry.sender && !matchSender(address, [entry.sender])) continue;
      return true;
    }
    let e = entry.toLowerCase().trim();
    if (e.startsWith('*.')) e = e.slice(1);
    if (e.includes('@') && !e.startsWith('@')) {
      if (addrLower === e) return true;
    } else if (e.startsWith('.')) {
      const atIndex = addrLower.lastIndexOf('@');
      if (atIndex !== -1 && addrLower.slice(atIndex + 1).endsWith(e)) return true;
    } else if (e.startsWith('@')) {
      const atIndex = addrLower.lastIndexOf('@');
      if (atIndex !== -1 && addrLower.slice(atIndex + 1) === e.slice(1)) return true;
    } else {
      const atIndex = addrLower.lastIndexOf('@');
      if (atIndex !== -1 && addrLower.slice(atIndex + 1) === e) return true;
    }
  }
  return false;
}

function matchSubject(subject, patterns) {
  if (!patterns || !patterns.length) return false;
  const subjLower = subject.toLowerCase();
  return patterns.some(p => subjLower.includes(p.toLowerCase()));
}

function ipInRange(ip, ranges) {
  if (!ranges || !ranges.length || !ip) return false;
  const ipNum = ip.split('.').reduce((acc, oct) => (acc << 8) + parseInt(oct, 10), 0);
  return ranges.some(range => {
    const [cidrIp, bits] = range.split('/');
    const mask = ~(2 ** (32 - parseInt(bits)) - 1);
    const cidrNum = cidrIp.split('.').reduce((acc, oct) => (acc << 8) + parseInt(oct, 10), 0);
    return (ipNum & mask) === (cidrNum & mask);
  });
}

// Extract from the tag ClientIP= to get the originating IP
function extractOriginatingIp(commandData) {
  const match = commandData.match(/ClientIP=(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
  if (match) return match[1];
  return null;
}

// Checks if the email's originating country matches any in the list, using GeoIP lookup.
// Returns { matched: boolean, country: string|null } so callers can use either value.
function matchCountry(originatingIp, countries) {
  if (originatingIp) {
    //If this is a private IP address don't bother looking up just return N/A for country and don't match against any blacklists
    if (tools.isPrivateIp(originatingIp)) {
      return { matched: false, country: "N/A" };
    }
    tools.logData(`Checking originating country for IP: ${originatingIp}`);
    try {
      const lookup = mmdb.lookup(originatingIp);
      if (lookup && lookup.country && lookup.country.iso_code) {
        const code = lookup.country.iso_code.toUpperCase();
        tools.logData(`Originating country code: ${code}`);
        const matched = countries.some(c => c.toUpperCase() === code);
        return { matched, country: code };
      }
    } catch (err) {
      // Ignore MMDB errors
      tools.logError(`GeoIP lookup failed for IP: ${originatingIp}.  Error: ${err.message}`);
    }
  }
  return { matched: false, country: null };
}

// Extract the top-level domain (TLD) from an email address (returns lowercase, e.g. 'com')
function extractTLD(address) {
  if (!address || typeof address !== 'string') return null;
  const at = address.lastIndexOf('@');
  if (at === -1) return null;
  const domain = address.slice(at + 1).toLowerCase();
  const parts = domain.split('.').filter(Boolean);
  if (!parts.length) return null;
  return parts[parts.length - 1];
}

function checkCombos(parsed, combos, recipients, originatingIp) {
  if (!combos || !combos.length) return false;
  const fromAddr = parsed.from?.address || '';
  const subjText = parsed.subject || '';
  return combos.some(combo => {
    if (combo.recipient && recipients) {
      if (!recipients.some(r => r.toLowerCase() === combo.recipient.toLowerCase())) return false;
    }
    if (combo.sender && !matchSender(fromAddr, [combo.sender])) return false;
    if (combo.subject && !matchSubject(subjText, [combo.subject])) return false;
    if (combo.ipAddress && !ipInRange(originatingIp, [combo.ipAddress])) return false;
    return true;
  });
}

function getKeywordText(parsed, filter) {
  const subject = parsed.subject || '';
  const body = parsed.text || parsed.html || '';
  const scope = String(filter.SearchScope || '').trim();
  switch (scope) {
    case '1': return body;
    case '2': return subject;
    case '3': return [subject, body].filter(Boolean).join('\n');
    case '4': {
      try {
        const headers = [];
        if (parsed.headers && Array.isArray(parsed.headers)) {
          parsed.headers.forEach(h => {
            headers.push(`${h.key}: ${h.value}`);
          });
        }
        return headers.join('\n');
      } catch (e) {
        tools.logError(`Error occurred while extracting headers: ${e}`);
        return '';
      }
    }
    default: return [subject, body].filter(Boolean).join('\n');
  }
}

function matchKeywordFilter(parsed, filter, recipients) {
  if (!filter) return false;
  // If Enabled is explicitly present and falsy, skip the filter
  if (typeof filter.Enabled !== 'undefined') {
    const en = String(filter.Enabled).trim();
    if (en === '0' || en.toLowerCase() === 'false') return false;
  }

  // If the filter has a specific Recipient, only apply if one matches
  if (filter.Recipient && recipients) {
    const filterRecipient = String(filter.Recipient).trim().toLowerCase();
    if (!recipients.some(r => r.toLowerCase() === filterRecipient)) return false;
  }

  const text = getKeywordText(parsed, filter);
  if (!text) return false;
  const expression = String(filter.FilterExpression || '').trim();
  if (!expression) return false;

  // Support both spellings for case-sensitivity
  const caseSensitive = (String(filter.FilterCaseSensitive || filter.FilterCaseSensative || '').trim() === '1');
  const regexMode = String(filter.FilterExpressionType || '').trim() === '1';
  const expressions = expression.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const requireAll = String(filter.FilterMultipleExpressionAndOR || '').trim() === '1';

  const flags = caseSensitive ? 'g' : 'gi';

  const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const testExpression = (expr) => {
    if (regexMode) {
      try {
        const rx = new RegExp(expr, flags);
        return rx.test(text);
      } catch (e) {
        tools.logError(`Error occurred while testing regex: ${e}`);
        return false;
      }
    }

    // Text mode - apply different match types
    const matchType = String(filter.FilterMatchType || '').trim();
    if (matchType === '1') {
      // Words beginning with
      const pattern = `\\b${escapeRegex(expr)}`;
      try { return new RegExp(pattern, flags).test(text); } catch { return false; }
    }
    if (matchType === '2') {
      // Words ending with
      const pattern = `${escapeRegex(expr)}\\b`;
      try { return new RegExp(pattern, flags).test(text); } catch { return false; }
    }
    if (matchType === '3') {
      // Whole words only
      const pattern = `\\b${escapeRegex(expr)}\\b`;
      try { return new RegExp(pattern, flags).test(text); } catch { return false; }
    }
    // Default (0) Any matching text (contains)
    if (caseSensitive) return text.includes(expr);
    return text.toLowerCase().includes(expr.toLowerCase());
  };

  if (requireAll) {
    return expressions.every(e => testExpression(e));
  }
  return expressions.some(e => testExpression(e));
}

function scoreKeywordFilters(parsed, filters, recipients) {
  if (!filters || !filters.length) return { score: 0, matches: [] };
  return filters.reduce((acc, filter) => {
    if (matchKeywordFilter(parsed, filter, recipients)) {
      const score = Number(filter.Score) || 0;
      const filterName = filter.FilterName || 'Keyword';
      tools.logData(`Keyword filter matched: "${filterName}", score: ${score}`);
      if (score > 0) {
        acc.score += score;
        acc.matches.push({ name: filterName, score: score });
      }
    }
    return acc;
  }, { score: 0, matches: [] });
}

async function queryOllama(prompt) {
  const url = `http://${OLLAMA_HOST}:${OLLAMA_PORT}/api/generate`;
  const payload = {
    model: OLLAMA_MODEL,
    prompt: prompt,
    stream: false,
  };
  const resp = await axios.post(url, payload, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 15000,
  });
  if (resp && resp.data) {
    tools.logData(`Ollama response: ${resp.data.response}`);
    return resp.data.response || '';
  }
  return '';
}

const spamAssassinClient = SPAMASSASSIN_ENABLED ? new SpamAssassinClient({
  host: SPAMASSASSIN_HOST,
  port: SPAMASSASSIN_PORT,
  timeout: 5,
}) : null;

function checkSpamAssassin(rawEmail) {
  if (!spamAssassinClient) {
    return Promise.resolve(null);
  }

  return spamAssassinClient.symbols(rawEmail).then((result) => {
    return {
      isSpam: result.spam,
      score: result.score,
      threshold: 5.0,
      fullReport: (result.symbols || []).join(', '),
    };
  }).catch((err) => {
    tools.logError(`SpamAssassin check failed: ${err.message}`);
    return null;
  });
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

// Updates email headers with quarantine reasons and spam score for better tracking and compatibility with existing rules
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
    // Let's add some MPA-specific headers
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

async function checkAiSpam(fromAddr, subjectText, parsed) {
  let aiSpamResult = false;
  let aiReasons = '';
  let aiScore = 0;
  let aiResponse;
  if (AI_CHECK_ENABLED) {
    try {
      const promptPath = path.join(__dirname, 'config', 'aiSpamCheckPrompt.md');
      let promptTemplate = fs.readFileSync(promptPath, 'utf8');
      const emailContent = `From: ${fromAddr}\nSubject: ${subjectText}\nBody: ${(parsed.text || '').slice(0, 2000)}`;
      const aiPrompt = promptTemplate + emailContent;
      aiResponse = await queryOllama(aiPrompt);
      const parsedJson = JSON.parse(aiResponse);
      const classification = (parsedJson.classification || '').toUpperCase();
      const confidence = parseFloat(parsedJson.confidence_score) || 0;
      const reasons = parsedJson.reasons || [];
      if (classification === 'SPAM') {
        aiScore = Math.round(aiSpamPoints * confidence * 10) / 10;
        aiReasons = `AI Check(${aiScore}) - ${reasons.join('; ')}`;
        aiSpamResult = true;
      } else if (classification === 'HAM') {
        aiScore = Math.round(aiHamPoints * confidence * 10) / 10;
        aiSpamResult = false;
      }
    } catch (err) {
      if (aiResponse)
        tools.logError(`Ollama query failed, response returned: ${aiResponse}, not assigning score for AI check: ${err.message}`);
      else
        tools.logError(`Ollama query failed, not assigning score for AI check: ${err.message}`);
    }
  }

  return { aiSpamResult, aiScore, aiReasons };
}

async function processEmail(controlFilePath, messagePath, rules) {
  try {
    const processStartTime = performance.now();
    const message = fs.readFileSync(messagePath, 'utf8');
    const commandData = fs.readFileSync(controlFilePath, 'utf8');
    const userMatch = commandData.match(/^User=(.*)$/m);
    //Skip emails sent outbound (no user (internal postoffice recipient))
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

    //Skip messages that have already been processed
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

    // 1.0 Whitelist check — Check if sender email is whiltelisted
    const wl = rules.whitelist || {};
    if (matchSender(fromAddr, wl.senders, recipients)) {
      metrics.increment('whitelisted');
      const elapsed = (performance.now() - processStartTime) / 1000;
      logProcessingEntry(messageId, sizeKb, originatingIp, fromAddr, recipientStr, subjectText, elapsed, 'Whitelisted', 'Whitelisted Sender', 0);
      tools.logData(`Sender ${fromAddr} is whitelisted, releasing`);
      return;
    }
    
    // 1.1 Whitelist check - Check if IP Addresses is whitelisted
    if (ipInRange(originatingIp, wl.ipRanges)) {
      metrics.increment('whitelisted');
      const elapsed = (performance.now() - processStartTime) / 1000;
      logProcessingEntry(messageId, sizeKb, originatingIp, fromAddr, recipientStr, subjectText, elapsed, 'Whitelisted', 'Whitelisted Originating IP', 0);
      tools.logData(`Originating IP is whitelisted, releasing`);
      return;
    }

    const bl = rules.blacklist || {};
    const countryResult = matchCountry(originatingIp, bl.countries || []);
    // 2.0 Blacklist check -  Allowed TLDs enforcement - if an allowedTLDs list exists, delete emails where sender domain is not in list    
    const allowed = (rules.allowedTLDs || []).map(s => String(s).toLowerCase().replace(/^\./, '')).filter(Boolean);
    if (allowed.length > 0) {
      const fromTld = extractTLD(fromAddr);
      if (fromTld && !allowed.includes(fromTld)) {
        metrics.increment('blacklisted');
        tools.logData(`From address TLD '${fromTld}' not in allowedTLDs, deleting`);
        const elapsed = (performance.now() - processStartTime) / 1000;
        logProcessingEntry(messageId, sizeKb, originatingIp, fromAddr, recipientStr, subjectText, elapsed, 'Blacklisted', 'TLD not allowed', 99);
        await updateEmailHeaders(messagePath, destMessageName, [`Blacklisted TLD(99) - TLD ${fromTld} not allowed`], 99, countryResult.country, 'Blacklisted TLD(99)');
        await deleteEmail(controlFilePath, messagePath, destMessageName, fromAddr);
        return;
      }
    }

    // 2.1 Blacklist check — Check if sender email is blacklisted
    if (matchSender(fromAddr, bl.senders)) {
      metrics.increment('blacklisted');
      tools.logData(`Sender ${fromAddr} is blacklisted, deleting`);
      const elapsed = (performance.now() - processStartTime) / 1000;
      logProcessingEntry(messageId, sizeKb, originatingIp, fromAddr, recipientStr, subjectText, elapsed, 'Blacklisted', 'Blacklisted sender', 99);
      await updateEmailHeaders(messagePath, destMessageName, [`Blacklisted Sender(99) - Sender ${fromAddr}`], 99, countryResult.country, 'Blacklisted Sender(99)');
      await deleteEmail(controlFilePath, messagePath, destMessageName, fromAddr);
      return;
    }

    // 2.2 Blacklist check - Check if sender IP Address is blacklisted
    if (ipInRange(originatingIp, bl.ipRanges)) {
      metrics.increment('blacklisted');
      tools.logData(`Originating IP ${originatingIp} is blacklisted, deleting`);
      const elapsed = (performance.now() - processStartTime) / 1000;
      logProcessingEntry(messageId, sizeKb, originatingIp, fromAddr, recipientStr, subjectText, elapsed, 'Blacklisted', 'Blacklisted IP', 99);
      await updateEmailHeaders(messagePath, destMessageName, [`Blacklisted IP(99) - IP ${originatingIp}`], 99, countryResult.country, 'Blacklisted IP(99)');
      await deleteEmail(controlFilePath, messagePath, destMessageName, fromAddr);
      return;
    }

    // 2.3 Blacklist check - Check if sender IP maps to blacklisted country code    
    if (countryResult.matched) {
      metrics.increment('blacklisted');
      tools.logData(`Originating country ${countryResult.country} is blacklisted, deleting`);
      const elapsed = (performance.now() - processStartTime) / 1000;
      logProcessingEntry(messageId, sizeKb, originatingIp, fromAddr, recipientStr, subjectText, elapsed, 'Blacklisted', 'Blacklisted country', 99);
      await updateEmailHeaders(messagePath, destMessageName, [`Blacklisted Country(99) - Country ${countryResult.country}`], 99, countryResult.country, 'Blacklisted Country(99)');
      await deleteEmail(controlFilePath, messagePath, destMessageName, fromAddr);
      return;
    }

    // 2.4 Blacklist check - Check if a recipient has an IP blocked or a sender blocked
    if (checkCombos(parsed, bl.combos, recipients, originatingIp)) {
      metrics.increment('blacklisted');
      tools.logData(`Combo rule matched, deleting`);
      const elapsed = (performance.now() - processStartTime) / 1000;
      logProcessingEntry(messageId, sizeKb, originatingIp, fromAddr, recipientStr, subjectText, elapsed, 'Blacklisted', 'Combo rule matched', 99);
      //TODO: Return the rule that was matched to log here
      await updateEmailHeaders(messagePath, destMessageName, [`Combo Matched(99) - Rule Matched `], 99, countryResult.country, 'Combo Matched(99)');
      await deleteEmail(controlFilePath, messagePath, destMessageName, fromAddr);
      return;
    }

    // 3.0 Quarantine check - Calculate score from keyword filters 
    let quarantineReasons = [];
    let spamInfoParts = [];
    let spamScore = 0;
    const keywordResult = scoreKeywordFilters(parsed, bl.keywordFilters, recipients);
    if (keywordResult.score > 0) {
      const keyWordInfo = `Keywords(${keywordResult.score})`; 
      spamInfoParts.push(keyWordInfo);
      spamScore += keywordResult.score;
      quarantineReasons.push(`${keyWordInfo} - ${keywordResult.matches.map(m => `${m.name}(${m.score})`).join(', ')}`);
    }

    // 3.1 Quarantine check - SpamAssassin check (if enabled)
    if (SPAMASSASSIN_ENABLED) {
      const saResult = await checkSpamAssassin(message);
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

    // 3.2 Quaranetine check - Ollama AI spam check
    const { aiSpamResult, aiScore, aiReasons } = await checkAiSpam(fromAddr, subjectText, parsed);
    spamScore += aiScore;    
    spamInfoParts.push(`AI Check(${aiScore})`);
    if (aiSpamResult) {      
      quarantineReasons.push(aiReasons);
    }

    // 4.0 Process results of scoring and quarantine if above threshold
    const processElapsed = (performance.now() - processStartTime) / 1000;
    let spamDetailInfo = spamInfoParts.join('; ');
    tools.logData(`Final spam score: ${spamScore} (Thresholds: Quarantine ${THRESHOLD_QUARANTINE}, Delete ${THRESHOLD_DELETE})`);
    // Check if we are across the delete threshold
    if (spamScore >= THRESHOLD_DELETE) {
      metrics.increment('blacklisted');
      logProcessingEntry(messageId, sizeKb, originatingIp, fromAddr, recipientStr, subjectText, processElapsed, 'Blacklisted', spamDetailInfo, spamScore);
      tools.logData(`Deleting email due to score ${spamScore} >= ${THRESHOLD_DELETE}. Reasons: ${quarantineReasons.join('; ')}`);
      await updateEmailHeaders(messagePath, destMessageName, quarantineReasons, spamScore, countryResult.country, spamDetailInfo);
      await deleteEmail(controlFilePath, messagePath, destMessageName, fromAddr);
    } 
    // Check if we are above the quarantine threshold
    else if (spamScore >= THRESHOLD_QUARANTINE) {
      metrics.increment('quarantined');
      logProcessingEntry(messageId, sizeKb, originatingIp, fromAddr, recipientStr, subjectText, processElapsed, 'Quarantined', spamDetailInfo, spamScore);
      tools.logData(`Quarantining email due to score ${spamScore} >= ${THRESHOLD_QUARANTINE}. Reasons: ${quarantineReasons.join('; ')}`);
      await updateEmailHeaders(messagePath, destMessageName, quarantineReasons, spamScore, countryResult.country, spamDetailInfo);
      await quarantineEmail(controlFilePath, messagePath, destMessageName, fromAddr);
    } 
    // No threshold reached release email
    else {
      metrics.increment('released');
      if (spamDetailInfo.length == 0) spamDetailInfo = 'No significant spam indicators';
      logProcessingEntry(messageId, sizeKb, originatingIp, fromAddr, recipientStr, subjectText, processElapsed, 'Released', spamDetailInfo, spamScore);
      tools.logData(`Releasing email with score ${spamScore}.`);
    }
  } catch (error) {
    tools.logError(`Error processing ${controlFilePath} and ${messagePath}: ${error}`);
  }
}

// Moves email to quarantine directory for further analysis and potential release by administrators
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

// Moves email to deleted directory, effectively deleting it from the pickup queue
// These will be purged after several days by a separate cleanup process, allowing for recovery if needed
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
}

//Show usage instructions when no arguments or --help is provided, or when arguments are invalid. Also supports a --test mode to send a test email to verify configuration.
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

// Export functions for use by server and other modules
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
  wipeall,
  recentlyReleased
};

// Main Processing begins here - only run if this file is executed directly, not when imported as a module
if (require.main === module) {
  // Expects two arguments: the message file name and the queue type. 
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
    // Send the full suite of generated test emails (blacklist, whitelist, TLD, combo, keywords)
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
    // Normal processing mode - expects message file and queue type as arguments
    const [messageFile, queueType] = args;
    const { messagePath, controlFilePath } = tools.buildFilePaths(messageFile, queueType);
    // Normal processing of the email with all checks and potential quarantine or deletion based on rules and AI/spam checks.
    processEmail(controlFilePath, messagePath, loadRules()).then(() => process.exit(0));
  }
}
