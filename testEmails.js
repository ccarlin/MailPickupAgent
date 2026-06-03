const fs = require('fs');
const path = require('path');

function loadRules() {
  try {
    const data = fs.readFileSync(path.join(__dirname, 'config', 'rules.json'), 'utf8');
    return JSON.parse(data);
  } catch (e) {
    return { whitelist: {}, blacklist: {} };
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
  const badSender = (Array.isArray(bl.senders) && bl.senders.find(s => typeof s === 'string')) || 'bad@spam.test';
  return {
    name: 'blacklist-sender',
    mail: {
      from: badSender,
      to: 'chuck@ccarlin.com',
      subject: 'Test blacklist sender',
      html: 'This email should be deleted due to blacklist sender match.'
    }
  };
}

function buildWhitelistTest(rules) {
  const wl = rules.whitelist || {};
  const goodSender = (Array.isArray(wl.senders) && wl.senders.find(s => typeof s === 'string')) || 'good@example.com';
  return {
    name: 'whitelist-sender',
    mail: {
      from: goodSender,
      to: 'chuck@ccarlin.com',
      subject: 'Test whitelist sender',
      html: 'This email should be released due to whitelist sender match.'
    }
  };
}

function buildTldTest(rules) {
  const allowed = (rules.allowedTLDs || []).map(s => String(s).toLowerCase().replace(/^\./, ''));
  const badTld = extractTldFromAllowed(allowed);
  return {
    name: 'tld-disallowed',
    mail: {
      from: `tester@domain.${badTld}`,
      to: 'chuck@ccarlin.com',
      subject: `Test TLD ${badTld}`,
      html: `This email has sender TLD ${badTld} which should be rejected if not in allowedTLDs.`
    }
  };
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
  return {
    name: 'combo-rule',
    mail: {
      from,
      to: (combo && combo.recipient) ? `${combo.recipient.toLowerCase()}@ccarlin.com` : 'chuck@ccarlin.com',
      subject,
      html: 'This email should trigger a combo rule.'
    }
  };
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
    const mail = { from: 'kw-regex@example.com', to: 'chuck@ccarlin.com', subject: 'Regex keyword test', html: '' , headers: {}};
    if (scope === '2') mail.subject = sample;
    else if (scope === '1') mail.html = sample;
    else if (scope === '3') { mail.subject = sample; mail.html = sample; }
    else if (scope === '4') { mail.headers = { 'X-Test-Header': sample }; }
    tests.push({ name: `keyword-regex-${regexFilter.FilterName || 'regex'}`, mail });
  }

  if (textFilter) {
    const sample = String(textFilter.FilterExpression || 'test');
    const scope = String(textFilter.SearchScope || '3').trim();
    const mail = { from: 'kw-text@example.com', to: 'chuck@ccarlin.com', subject: 'Text keyword test', html: '' , headers: {}};
    if (scope === '2') mail.subject = sample;
    else if (scope === '1') mail.html = sample;
    else if (scope === '3') { mail.subject = sample; mail.html = sample; }
    else if (scope === '4') { mail.headers = { 'X-Test-Header': sample }; }
    tests.push({ name: `keyword-text-${textFilter.FilterName || 'text'}`, mail });
  }

  // Ensure coverage for all search scopes 1-4 by adding simple tests if missing
  const scopesCovered = new Set(tests.map(t => String((rules.blacklist && rules.blacklist.keywordFilters && rules.blacklist.keywordFilters.find(f => (t.name.includes(f.FilterName || '') && (String(f.SearchScope||'3').trim())) ) ) )));
  for (const s of ['1','2','3','4']) {
    if (!tests.some(t => (s === '1' && t.mail.html) || (s === '2' && t.mail.subject && !t.mail.html) || (s === '3' && t.mail.subject && t.mail.html) || (s === '4' && t.mail.headers && Object.keys(t.mail.headers).length))) {
      const sample = `SCOPE${s}_TEST`;
      const mail = { from: `scope${s}@example.com`, to: 'chuck@ccarlin.com', subject: 'Scope test', html: '', headers: {} };
      if (s === '1') mail.html = sample;
      if (s === '2') mail.subject = sample;
      if (s === '3') { mail.subject = sample; mail.html = sample; }
      if (s === '4') mail.headers = { 'X-Scope-Test': sample };
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
