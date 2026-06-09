const fs = require('fs');
const path = require('path');
const net = require('net');
const axios = require('axios');
const { simpleParser } = require('mailparser');
const nodemailer = require('nodemailer');
const { buildAllTestEmails } = require('./testEmails');
const { buildFilePaths } = require('./tools');
const MMDBReader = require('mmdb-reader');
const mmdb = new MMDBReader(path.join(__dirname, 'GeoLite2-Country.mmdb'));
//Supress output of this command
require('dotenv').config({ quiet: true });

const SMTP_QUEUE_DIR = process.env.SMTP_QUEUE_DIR || './queues';
const SMTP_COMMAND_DIR = process.env.SMTP_COMMAND_DIR || './queues';
const QUARANTINE_DIR = process.env.QUARANTINE_DIR || './quarantine';
const DELETED_DIR = process.env.DELETED_DIR || './deleted';
const SMTP_HOST = process.env.SMTP_HOST || 'localhost';
const SMTP_PORT = process.env.SMTP_PORT || 25;
const RULES_FILE = './config/rules.json';
const AI_CHECK_ENABLED = (process.env.AI_CHECK_ENABLED || 'false').toLowerCase() === 'true';
const OLLAMA_HOST = process.env.OLLAMA_SERVER || 'localhost';
const OLLAMA_PORT = process.env.OLLAMA_PORT || 11434;
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2';
const SPAMASSASSIN_ENABLED = (process.env.SPAMASSASSIN_ENABLED || 'false').toLowerCase() === 'true';
const SPAMASSASSIN_HOST = process.env.SPAMASSASSIN_HOST || 'localhost';
const SPAMASSASSIN_PORT = process.env.SPAMASSASSIN_PORT || 783;
const DRY_RUN_COPY_LOG = (process.env.DRY_RUN_COPY_LOG || 'false').toLowerCase() === 'true';
const DRY_RUN_LOG_FILE = process.env.DRY_RUN_LOG_FILE || './mailpickupagent-dryrun.log';
const DRY_RUN_COPY_DEST = process.env.DRY_RUN_COPY_DEST || './dry-run-output';
const TEST_EMAIL_SLEEP_SECONDS = Number(process.env.TEST_EMAIL_SLEEP_SECONDS || 10) || 10;
const THRESHOLD_QUARANTINE = Number(process.env.THRESHOLD_QUARANTINE || 5);
const THRESHOLD_DELETE = Number(process.env.THRESHOLD_DELETE || 15);
const HEADER_SEPARATOR = '\r\n\r\n';
const PROCESSING_LOG_DIR = process.env.PROCESSING_LOG || '.';
const processingLogPath = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${PROCESSING_LOG_DIR}/processing-${y}${m}${day}.log`;
};

[QUARANTINE_DIR, DELETED_DIR, DRY_RUN_COPY_DEST].forEach(dir => {
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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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
    console.log(`Checking originating country for IP: ${originatingIp}`);
    try {
      const lookup = mmdb.lookup(originatingIp);
      if (lookup && lookup.country && lookup.country.iso_code) {
        const code = lookup.country.iso_code.toUpperCase();
        console.log(`Originating country code: ${code}`);
        const matched = countries.some(c => c.toUpperCase() === code);
        return { matched, country: code };
      }
    } catch(err) {
      // Ignore MMDB errors
      console.error(`GeoIP lookup failed for IP: ${originatingIp}.  Error: ${err.message}`);
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
  const fromAddr = parsed.from?.value?.[0]?.address || '';
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
        if (parsed.headers && typeof parsed.headers.forEach === 'function') {
          parsed.headers.forEach((value, key) => {
            headers.push(`${key}: ${value}`);
          });
        } else if (parsed.headers && typeof parsed.headers === 'object') {
          for (const k of Object.keys(parsed.headers)) headers.push(`${k}: ${parsed.headers[k]}`);
        }
        return headers.join('\n');
      } catch (e) {
        return '';
      }
    }
    default: return [subject, body].filter(Boolean).join('\n');
  }
}

function matchKeywordFilter(parsed, filter) {
  if (!filter) return false;
  // If Enabled is explicitly present and falsy, skip the filter
  if (typeof filter.Enabled !== 'undefined') {
    const en = String(filter.Enabled).trim();
    if (en === '0' || en.toLowerCase() === 'false') return false;
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

function scoreKeywordFilters(parsed, filters) {
  if (!filters || !filters.length) return { score: 0, matches: [] };
  return filters.reduce((acc, filter) => {
    if (matchKeywordFilter(parsed, filter)) {
      const score = Number(filter.Score) || 0;
      const filterName = filter.FilterName || 'Keyword';
      console.log(`Keyword filter matched: "${filterName}", score: ${score}`);
      if (score > 0) {
        acc.score += score;
        acc.matches.push(filterName);
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
    console.log(`Ollama response: ${resp.data.response}`);
    return resp.data.response || '';
  }
  return '';
}

function checkSpamAssassin(rawEmail) {
  if (!SPAMASSASSIN_ENABLED) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    try {
      const socket = net.createConnection(SPAMASSASSIN_PORT, SPAMASSASSIN_HOST, () => {
        // Send SPAMC protocol request
        const request = `REPORT SPAMC/1.5\r\nContent-length: ${Buffer.byteLength(rawEmail)}\r\n\r\n${rawEmail}`;
        socket.write(request);
      });

      let responseData = '';
      let headerComplete = false;
      let isSpam = null;
      let score = 0;
      let threshold = 15.0;

      socket.on('data', (data) => {
        responseData += data.toString();

        if (!headerComplete) {
          const headerEnd = responseData.indexOf('\r\n\r\n');
          if (headerEnd !== -1) {
            headerComplete = true;
            const headerText = responseData.substring(0, headerEnd);
            
            // Parse response headers
            const lines = headerText.split('\r\n');
            for (const line of lines) {
              if (line.startsWith('Spam:')) {
                isSpam = line.toLowerCase().includes('true');
              } else if (line.startsWith('Score:')) {
                const scoreMatch = line.match(/[\d.]+/);
                score = scoreMatch ? parseFloat(scoreMatch[0]) : 0;
              } else if (line.startsWith('Threshold:')) {
                const thresholdMatch = line.match(/[\d.]+/);
                threshold = thresholdMatch ? parseFloat(thresholdMatch[0]) : 5.0;
              }
            }
          }
        }
      });

      socket.on('end', () => {
        resolve({
          isSpam: isSpam,
          score: score,
          threshold: threshold,
        });
      });

      socket.on('error', (err) => {
        console.error(`SpamAssassin connection error: ${err.message}`);
        resolve(null); // Return null on error so email is still processed
      });

      socket.setTimeout(5000, () => {
        socket.destroy();
        console.error('SpamAssassin connection timeout');
        resolve(null); // Return null on timeout
      });
    } catch (err) {
      console.error(`SpamAssassin check failed: ${err.message}`);
      resolve(null); // Return null on error so email is still processed
    }
  });
}

function findFirstBlacklistSender(senders) {
  if (!Array.isArray(senders)) return null;
  for (const entry of senders) {
    if (typeof entry === 'string') return entry;
    if (entry && typeof entry === 'object' && entry.sender) return entry.sender;
  }
  return null;
}

function findFirstBlacklistCountry(countries) {
  if (!Array.isArray(countries)) return null;
  return countries.find(c => typeof c === 'string') || null;
}

// buildTestEmail removed — testEmails.js provides test case builders via buildAllTestEmails()
async function sendTestEmail(subject, msg, from, headers = {}) {
  try {
    await transporter.sendMail({
      from: from || '"MailPickupAgent" <no-reply@localhost>',
      to: process.env.TEST_EMAIL_RECIPIENT || 'chuck@ccarlin.com',
      subject: subject,
      html: msg,
      headers,
    });
    console.log('Test email sent');
  } catch (err) {
    console.error(`Error sending test email: ${err.message}`);
  }
}

function logDryRun(args, controlFilePath, messagePath) {
  const entry = {
    timestamp: new Date().toISOString(),
    args,
    controlFilePath,
    messagePath,
  };
  try {
    fs.appendFileSync(DRY_RUN_LOG_FILE, `${JSON.stringify(entry)}\n`);
    console.log(`Dry-run log written to ${DRY_RUN_LOG_FILE}`);
  } catch (err) {
    console.error(`Unable to write dry-run log: ${err.message}`);
  }
}

function copyDryRunFiles(controlFilePath, messagePath) {
  try {
    const headerDest = path.join(DRY_RUN_COPY_DEST, path.basename(controlFilePath)).replace(".MAI", ".H00");
    const messageDest = path.join(DRY_RUN_COPY_DEST, path.basename(messagePath));
    fs.copyFileSync(controlFilePath, headerDest);
    fs.copyFileSync(messagePath, messageDest);
    console.log(`Copied header to ${headerDest}`);
    console.log(`Copied message to ${messageDest}`);
  } catch (err) {
    console.error(`Unable to copy dry-run files: ${err.message}`);
  }
}

function logProcessingEntry(messageId, sizeKb, ip, sender, recipients, subject, processTimeSec, result, spamInfo, spamScore) {
  const pad = (n) => String(n).padStart(2, '0');
  const d = new Date();
  const dateTime = `${pad(d.getMonth()+1)}/${pad(d.getDate())}/${String(d.getFullYear()).slice(-2)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const s = (v) => String(v).replace(/\t/g, ' ').replace(/[\r\n]+/g, ' ');
  const line = [
    dateTime, s(messageId), 'SMTP-IN(0)', Math.round(sizeKb), 'ccarlin.com',
    s(ip || ''), s(sender), s(recipients), s(subject),
    processTimeSec.toFixed(3), s(result), s(spamInfo), spamScore
  ].join('\t');
  try {
    fs.appendFileSync(processingLogPath(), line + '\n', 'utf8');
  } catch (err) {
    console.error(`Failed to write processing log: ${err.message}`);
  }
}

// Updates email headers with quarantine reasons and spam score for better tracking and compatibility with existing rules
async function updateEmailHeaders(messagePath, destMessageName, quarantineReasons, spamScore, country) {
  try {
    let message = fs.readFileSync(messagePath, 'utf8');
    const headerEndIndex = message.indexOf(HEADER_SEPARATOR);
    if (headerEndIndex === -1) {
      console.error(`Invalid email format, no header-body separation found`);
      return;
    }
    let headers = message.substring(0, headerEndIndex); 
    let body = message.substring(headerEndIndex + HEADER_SEPARATOR.length);
    // Let's add some MPA-specific headers
    headers += `\r\nX-MPA-Scan: Scanned by MailPickupAgent 1.0 for ${process.env.HOSTNAME || 'localhost'}\r\n`;
    headers += `X-MPA-Msgid: ${destMessageName}\r\n`;
    headers += `X-MPA-AntiSpam: ${quarantineReasons.join('; ')}\r\n`;
    headers += `X-MPA-SpamScore: ${spamScore}\r\n`;
    if (country) {
      headers += `X-MPA-Country: ${country}\r\n`;
    }
    fs.writeFileSync(messagePath, headers + HEADER_SEPARATOR + body, 'utf8');
    console.log(`Updated email headers with quarantine reasons`);
  } catch (err) {
    console.error(`Failed to update email headers: ${err.message}`);
  }
}

async function processEmail(controlFilePath, messagePath, rules) {
  try {
    const message = fs.readFileSync(messagePath, 'utf8');
    const commandData = fs.readFileSync(controlFilePath, 'utf8');
    const parsed = await simpleParser(message);
    const fromAddr = parsed.from?.value?.[0]?.address || 'unknown';
    const subjectText = parsed.subject || '(no subject)';

    console.log(`Processing email: ${subjectText} from ${fromAddr}`);

    // const rules = loadRules();
    const destMessageName = path.basename(messagePath);
    const processStartTime = Date.now();
    const messageId = path.parse(messagePath).name;
    const fileStats = fs.statSync(messagePath);
    const sizeKb = fileStats.size / 1024;
    const recipientAddresses = (parsed.to?.value || []).map(v => v.address || '').filter(Boolean);
    const recipientStr = recipientAddresses.join(', ');
    const recipients = (parsed.to?.value || []).map(v => (v.address || '').split('@')[0].toUpperCase()).filter(Boolean);
    const originatingIp = extractOriginatingIp(commandData);
    console.log(`Extracted originating IP: ${originatingIp}, Recipients: ${recipients.join(', ')}`);

    // Country lookup — used for blacklist matching and MPA-Country header on quarantined emails
    const bl = rules.blacklist || {};
    const countryResult = matchCountry(originatingIp, bl.countries || []);

    // 1. Whitelist check — release immediately if matched
    const wl = rules.whitelist || {};
    if (matchSender(fromAddr, wl.senders, recipients)) {
      const elapsed = (Date.now() - processStartTime) / 1000;
      logProcessingEntry(messageId, sizeKb, originatingIp, fromAddr, recipientStr, subjectText, elapsed, 'Whitelisted', 'Sender whitelisted', 0);
      console.log(`Sender ${fromAddr} is whitelisted, releasing`);
      return;
    }
    if (ipInRange(originatingIp, wl.ipRanges)) {
      const elapsed = (Date.now() - processStartTime) / 1000;
      logProcessingEntry(messageId, sizeKb, originatingIp, fromAddr, recipientStr, subjectText, elapsed, 'Whitelisted', 'Originating IP is whitelisted', 0);
      console.log(`Originating IP is whitelisted, releasing`);
      return;
    }

    // 1.5 Allowed TLDs enforcement - if an allowedTLDs list exists, delete emails
    // where the sender's TLD is not present in that list. Recipient TLDs are ignored.
    const allowed = (rules.allowedTLDs || []).map(s => String(s).toLowerCase().replace(/^\./, '')).filter(Boolean);
    if (allowed.length > 0) {
      const fromTld = extractTLD(fromAddr);
      if (fromTld && !allowed.includes(fromTld)) {
        console.log(`From address TLD '${fromTld}' not in allowedTLDs, deleting`);
        const elapsed = (Date.now() - processStartTime) / 1000;
        logProcessingEntry(messageId, sizeKb, originatingIp, fromAddr, recipientStr, subjectText, elapsed, 'Blacklisted', 'TLD not allowed', 99);
        await deleteEmail(controlFilePath, messagePath, destMessageName);
        return;
      }
    }

    // 2. Blacklist check — delete immediately if matched
    if (matchSender(fromAddr, bl.senders)) {
      console.log(`Sender ${fromAddr} is blacklisted, deleting`);
      const elapsed = (Date.now() - processStartTime) / 1000;
      logProcessingEntry(messageId, sizeKb, originatingIp, fromAddr, recipientStr, subjectText, elapsed, 'Blacklisted', 'Blacklisted sender', 99);
      await deleteEmail(controlFilePath, messagePath, destMessageName);
      return;
    }

    if (ipInRange(originatingIp, bl.ipRanges)) {
      console.log(`Originating IP ${originatingIp} is blacklisted, deleting`);
      const elapsed = (Date.now() - processStartTime) / 1000;
      logProcessingEntry(messageId, sizeKb, originatingIp, fromAddr, recipientStr, subjectText, elapsed, 'Blacklisted', 'Blacklisted IP', 99);
      await deleteEmail(controlFilePath, messagePath, destMessageName);
      return;
    }

    if (countryResult.matched) {
      console.log(`Originating country ${countryResult.country} is blacklisted, deleting`);
      const elapsed = (Date.now() - processStartTime) / 1000;
      logProcessingEntry(messageId, sizeKb, originatingIp, fromAddr, recipientStr, subjectText, elapsed, 'Blacklisted', 'Blacklisted country', 99);
      await deleteEmail(controlFilePath, messagePath, destMessageName);
      return;
    }

    if (checkCombos(parsed, bl.combos, recipients, originatingIp)) {
      console.log(`Combo rule matched, deleting`);
      const elapsed = (Date.now() - processStartTime) / 1000;
      logProcessingEntry(messageId, sizeKb, originatingIp, fromAddr, recipientStr, subjectText, elapsed, 'Blacklisted', 'Combo rule matched', 99);
      await deleteEmail(controlFilePath, messagePath, destMessageName);
      return;
    }

    // Track reasons for header and logging purposes and sum the spam score
    let quarantineReasons = [];
    let spamScore = 0;
    const keywordResult = scoreKeywordFilters(parsed, bl.keywordFilters);
    if (keywordResult.score > 0) {
      spamScore += keywordResult.score;
      quarantineReasons.push(`Keyword matches: ${keywordResult.matches.join(', ')}`);
    }

    // 3. SpamAssassin check (if enabled)
    let saResult = null;
    if (SPAMASSASSIN_ENABLED) {
      saResult = await checkSpamAssassin(message);
      if (saResult) {
        console.log(`SpamAssassin score: ${saResult.score}/${saResult.threshold}, isSpam: ${saResult.isSpam}`);
        spamScore += saResult.score;
        if (saResult.isSpam) {
          quarantineReasons.push('SpamAssassin flagged as spam');          
        }
      } else if (SPAMASSASSIN_ENABLED) {
        console.log(`SpamAssassin check unavailable, continuing with other checks`);
      }
    }

    // 4. Ollama AI spam check
    if (AI_CHECK_ENABLED) {
      try {
        const aiPrompt = `You are a spam classifier. Reply with only the word "spam" or "ham". Is the following email spam?\n\nFrom: ${fromAddr}\nSubject: ${subjectText}\nBody: ${(parsed.text || '').slice(0, 2000)}`;
        const aiResponse = await queryOllama(aiPrompt);
        const isSpam = aiResponse.toLowerCase().includes('spam') && !aiResponse.toLowerCase().includes('ham');
        if (isSpam) {
          spamScore += 5; // Assign a score for AI-detected spam - this can be adjusted based on testing and needs;
          quarantineReasons.push('AI classified as spam');
        }        
      } catch (err) {
        console.error(`Ollama query failed, not assigning score for AI check:`, err.message);
      }
    }    

    const processElapsed = (Date.now() - processStartTime) / 1000;
    const spamInfoParts = [];
    if (keywordResult.matches.length > 0) {
      spamInfoParts.push(`Keyword: ${keywordResult.matches.join(', ')}`);
    }
    if (SPAMASSASSIN_ENABLED && saResult) {
      spamInfoParts.push(`SpamAssassin: ${saResult.score}`);
    }
    let spamDetailInfo = spamInfoParts.join('; ');

    console.log(`Final spam score: ${spamScore} (Thresholds: Quarantine ${THRESHOLD_QUARANTINE}, Delete ${THRESHOLD_DELETE})`);

    if (spamScore >= THRESHOLD_DELETE) {
      logProcessingEntry(messageId, sizeKb, originatingIp, fromAddr, recipientStr, subjectText, processElapsed, 'Blacklisted', spamDetailInfo, spamScore);
      console.log(`Deleting email due to score ${spamScore} >= ${THRESHOLD_DELETE}. Reasons: ${quarantineReasons.join('; ')}`);
      await updateEmailHeaders(messagePath, destMessageName, quarantineReasons, spamScore, countryResult.country);
      await deleteEmail(controlFilePath, messagePath, destMessageName);
    } else if (spamScore >= THRESHOLD_QUARANTINE) {
      logProcessingEntry(messageId, sizeKb, originatingIp, fromAddr, recipientStr, subjectText, processElapsed, 'Quarantined', spamDetailInfo, spamScore);
      console.log(`Quarantining email due to score ${spamScore} >= ${THRESHOLD_QUARANTINE}. Reasons: ${quarantineReasons.join('; ')}`);
      await updateEmailHeaders(messagePath, destMessageName, quarantineReasons, spamScore, countryResult.country);
      await quarantineEmail(controlFilePath, messagePath, destMessageName);
    } else {
      if (spamDetailInfo.length == 0) spamDetailInfo = 'No significant spam indicators';
      logProcessingEntry(messageId, sizeKb, originatingIp, fromAddr, recipientStr, subjectText, processElapsed, 'Released', spamDetailInfo, spamScore);
      console.log(`Releasing email with score ${spamScore}.`);
    }
  } catch (error) {
    console.error(`Error processing ${controlFilePath} and ${messagePath}:`, error);
  }

}

// Moves email to quarantine directory for further analysis and potential release by administrators
async function quarantineEmail(controlFilePath, messagePath, destMessageName) {
  const destHeader = path.join(QUARANTINE_DIR, destMessageName.replace(".MAI", ".H00"));
  const destMessage = path.join(QUARANTINE_DIR, destMessageName);
  fs.renameSync(controlFilePath, destHeader);
  fs.renameSync(messagePath, destMessage);
  console.log(`Email quarantined: ${destHeader}, ${destMessage}`);
}

// Moves email to deleted directory, effectively deleting it from the pickup queue
// These will be purged after several days by a separate cleanup process, allowing for recovery if needed
async function deleteEmail(controlFilePath, messagePath, destMessageName) {
  const destHeader = path.join(DELETED_DIR, destMessageName.replace(".MAI", ".H00"));
  const destMessage = path.join(DELETED_DIR, destMessageName);
  fs.renameSync(controlFilePath, destHeader);
  fs.renameSync(messagePath, destMessage);
  console.log(`Email deleted: ${destHeader}, ${destMessage}`);
}

//Show usage instructions when no arguments or --help is provided, or when arguments are invalid. Also supports a --test mode to send a test email to verify configuration.
function printUsage() {
  console.log('Usage: node index.js <messageID> <queue-type>');
  console.log('Usage: node index.js --test [good|quarantine|blacklist]');
  console.log('Usage: node server.js (to start the web server)');
  console.log('--test : Send a test email to verify configuration (defaults to good)');
  console.log('--help : Show this help message');
  console.log('Example: node index.js "B935428C1B4A4B8FADC12BC6A4358875.MAI" "SMTP"');
  console.log('Example: node index.js --test quarantine');
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
  scoreKeywordFilters
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
          from: t.mail.from || process.env.TEST_EMAIL_FROM || '"MailPickupAgent" <no-reply@localhost>',
          to: t.mail.to || process.env.TEST_EMAIL_RECIPIENT || 'chuck@ccarlin.com',
          subject: t.mail.subject || 'MailPickupAgent test email',
          html: t.mail.html || '',
          headers: t.mail.headers || {},
        };
        await transporter.sendMail(mailOpts);
        console.log(`Sent test '${t.name}' to ${mailOpts.to}`);
      } catch (err) {
        console.error(`Failed to send test '${t.name}': ${err.message}`);
      }
      if (index < tests.length - 1) {
        console.log(`Sleeping ${TEST_EMAIL_SLEEP_SECONDS} seconds before sending next test email...`);
        await sleep(TEST_EMAIL_SLEEP_SECONDS * 1000);
      }
    }
    process.exit(0);
  })();
}
else if (args.length !== 2 || ['-h', '--help'].includes(args[0])) {
    printUsage();
    process.exit(args.length === 2 ? 0 : 1);
}
else 
{
  // Normal processing mode - expects message file and queue type as arguments
  const [messageFile, queueType] = args;
  const { messagePath, controlFilePath } = buildFilePaths(messageFile, queueType);
  // Dry run just copies files and logs the action without processing, allowing for testing and rule verification without affecting the actual email flow.
  //  It also sleeps for 15 seconds before exit to allow time to inspect the file paths are correct.
  if (DRY_RUN_COPY_LOG) {
    logDryRun(args, controlFilePath, messagePath);
    copyDryRunFiles(controlFilePath, messagePath);
    console.log('Sleeping 15 seconds before exit...');
    setTimeout(() => {
      process.exit(0);
    }, 15000);
  }
  else
  { 
    // Normal processing of the email with all checks and potential quarantine or deletion based on rules and AI/spam checks.
    processEmail(controlFilePath, messagePath, loadRules()).then(() => process.exit(0));
  }
}
}
