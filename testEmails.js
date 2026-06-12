const fs = require('fs');
const path = require('path');
const config = require('./config');
const tools = require('./tools');
const TEST_RECIPIENT = config.TEST_EMAIL_RECIPIENT || 'test@localhost';
const HOSTNAME = config.HOSTNAME || 'localhost';
const FALL_BACK_SPAM_FILLER = '\n\ncamp lejeune';

function loadRules() {
  try {
    const data = fs.readFileSync(path.join(__dirname, 'config', 'rules.json'), 'utf8');
    return JSON.parse(data);
  } catch (e) {
    console.error(`Error loading rules: ${e}`);
    const defaultRules = { whitelist: {}, blacklist: {} };
    try {
      fs.writeFileSync(path.join(__dirname, 'config', 'rules.json'), JSON.stringify(defaultRules, null, 2), 'utf8');
    } 
    catch(err) {
      tools.logError(`Error creating default rules.json: ${err}`);
    }
    return defaultRules;
  }
}

function sampleFromRegex(expr) {
  if (!expr) return 'test';
  // Heuristic: remove common regex tokens and pick readable alternatives
  let s = expr.replace(/\\b/g, '');
  s = s.replace(/\(\?:([^)]*)\)/g, (_, inner) => inner.split('|')[0]);
  s = s.replace(/\[\^\\\s\w\.\]/g, '');
  s = s.replace(/\{\d+,?\d*\}/g, '');
  s = s.replace(/[\^$+*?()[\]{}|\\]/g, '');
  s = s.replace(/\./g, ' ');
  s = s.replace(/\s\+/g, ' ');
  s = s.replace(/\s*\|\s*/g, ' ');
  s = s.trim();
  if (!s) return 'test';
  // shorten long strings
  return s.split(/\s+/).slice(0, 6).join(' ');
}

function extractTldFromAllowed(allowed) {
  const sampleTlds = ['ru', 'cn', 'xyz', 'tk', 'biz', 'info'];
  if (!Array.isArray(allowed) || allowed.length === 0) return 'xyz';
  const normalized = allowed.map(s => String(s).toLowerCase().replace(/^\./, ''));
  for (const t of sampleTlds) if (!normalized.includes(t)) return t;
  return 'xyz';
}

function buildBlacklistTest(rules) {
  const bl = rules.blacklist || {};
  let badSender = (Array.isArray(bl.senders) && bl.senders.find(s => typeof s === 'string')) || 'bad@spam.test';
  // If sender is a partial email or just a domain let's make it a full email for testing
  if (!badSender.includes('@')) {
    badSender = `spammer@${badSender}`;
  }
  const mail = {
    from: badSender,
    to: TEST_RECIPIENT,
    subject: 'Test blacklist sender',
    html: 'This email should be deleted due to blacklist sender match.'
  };
  injectSpamFiller(mail, rules);
  return { name: 'blacklist-sender', mail };
}

function buildWhitelistTest(rules) {
  const wl = rules.whitelist || {};
  const goodSender = (Array.isArray(wl.senders) && wl.senders.find(s => typeof s === 'string')) || 'good@example.com';
  return {
    name: 'whitelist-sender',
    mail: {
      from: goodSender,
      to: TEST_RECIPIENT,
      subject: 'Test whitelist sender',
      html: 'This email should be released due to whitelist sender match.'
    }
  };
}

function buildTldTest(rules) {
  const allowed = (rules.allowedTLDs || []).map(s => String(s).toLowerCase().replace(/^\./, ''));
  const badTld = extractTldFromAllowed(allowed);
  const mail = {
    from: `tester@domain.${badTld}`,
    to: TEST_RECIPIENT,
    subject: `Test TLD ${badTld}`,
    html: `This email has sender TLD ${badTld} which should be rejected if not in allowedTLDs.`
  };
  injectSpamFiller(mail, rules);
  return { name: 'tld-disallowed', mail };
}

function buildComboTest(rules) {
  const combos = (rules.blacklist && rules.blacklist.combos) || [];
  const combo = combos.find(c => c.sender || c.subject || c.ipAddress) || null;
  let from = 'combo@example.com';
  let subject = 'Combo rule test';
  if (combo) {
    if (combo.sender) from = combo.sender;
    if (combo.subject) subject = combo.subject;
  }
  const mail = {
    from,
    to: (combo && combo.recipient) ? `${combo.recipient.toLowerCase()}@${HOSTNAME}` : TEST_RECIPIENT,
    subject,
    html: 'This email should trigger a combo rule.'
  };
  injectSpamFiller(mail, rules);
  return { name: 'combo-rule', mail };
}

// Dynamically picks a text-mode keyword filter with score >= 10 that checks body (scope 1 or 3).
function pickSpamFiller(rules) {
  const filters = (rules.blacklist && rules.blacklist.keywordFilters) || [];
  for (const f of filters) {
    const score = Number(f.Score) || 0;
    const type = String(f.FilterExpressionType || '').trim();
    const scope = String(f.SearchScope || '').trim();
    if (score >= 10 && type === '0' && (scope === '1' || scope === '3')) {
      const expr = String(f.FilterExpression || '').trim();
      if (expr) return '\n\n' + expr;
    }
  }
  return FALL_BACK_SPAM_FILLER;
}

function injectSpamFiller(mail, rules) {
  mail.html = (mail.html || '') + pickSpamFiller(rules);
  return mail;
}

function buildKeywordTests(rules) {
  const filters = (rules.blacklist && rules.blacklist.keywordFilters) || [];
  const tests = [];
  // pick one regex and one text filter, and one per search scope if available
  let regexFilter = filters.find(f => String(f.FilterExpressionType || '').trim() === '1');
  let textFilter = filters.find(f => String(f.FilterExpressionType || '').trim() === '0');

  if (regexFilter) {
    const sample = sampleFromRegex(String(regexFilter.FilterExpression || ''));
    const scope = String(regexFilter.SearchScope || '3').trim();
    const mail = { from: 'kw-regex@example.com', to: TEST_RECIPIENT, subject: 'Regex keyword test', html: '' , headers: {}};
    if (scope === '2') mail.subject = sample;
    else if (scope === '1') mail.html = sample;
    else if (scope === '3') { mail.subject = sample; mail.html = sample; }
    else if (scope === '4') { mail.headers = { 'X-Test-Header': sample }; }
    injectSpamFiller(mail, rules);
    tests.push({ name: `keyword-regex-${regexFilter.FilterName || 'regex'}`, mail });
  }

  if (textFilter) {
    const sample = String(textFilter.FilterExpression || 'test');
    const scope = String(textFilter.SearchScope || '3').trim();
    const mail = { from: 'kw-text@example.com', to: TEST_RECIPIENT, subject: 'Text keyword test', html: '' , headers: {}};
    if (scope === '2') mail.subject = sample;
    else if (scope === '1') mail.html = sample;
    else if (scope === '3') { mail.subject = sample; mail.html = sample; }
    else if (scope === '4') { mail.headers = { 'X-Test-Header': sample }; }
    injectSpamFiller(mail, rules);
    tests.push({ name: `keyword-text-${textFilter.FilterName || 'text'}`, mail });
  }

  // Ensure coverage for all search scopes 1-4
  // Each email gets injectSpamFiller which adds ~10 from HACKER_CRAP2
  for (const s of ['1','2','3','4']) {
    if (!tests.some(t => (s === '1' && t.mail.html) || (s === '2' && t.mail.subject && !t.mail.html) || (s === '3' && t.mail.subject && t.mail.html) || (s === '4' && t.mail.headers && Object.keys(t.mail.headers).length))) {
      const mail = { from: `scope${s}@example.com`, to: TEST_RECIPIENT, subject: 'Scope test', html: '', headers: {} };
      if (s === '1') mail.html = 'Body scope test content.';
      if (s === '2') mail.subject = 'Subject scope test content.';
      if (s === '3') { mail.subject = 'Scope 3 test'; mail.html = 'Body content for combined scope.'; }
      if (s === '4') { mail.headers = { 'X-Test': 'header-value' }; mail.html = 'Header scope body content.'; }
      injectSpamFiller(mail, rules);
      tests.push({ name: `keyword-scope-${s}`, mail });
    }
  }

  return tests;
}

function buildAllTestEmails() {
  const rules = loadRules();
  const out = [];
  out.push(buildBlacklistTest(rules));
  out.push(buildWhitelistTest(rules));
  out.push(buildTldTest(rules));
  out.push(buildComboTest(rules));
  const kws = buildKeywordTests(rules);
  return out.concat(kws);
}

module.exports = { buildAllTestEmails };
