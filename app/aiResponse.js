'use strict';

function normalizeResponse(aiResponse) {
  return String(aiResponse || '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
    .replace(/[\r\n]+/g, ' ');
}

function isStringTerminator(text, quoteIndex, container, valueComplete) {
  let next = quoteIndex + 1;
  while (next < text.length && /\s/.test(text[next])) next++;
  const ch = text[next];
  if (ch === undefined || ch === '"' || ch === '}' || ch === ']') return true;
  if (ch === ',') {
    let after = next + 1;
    while (after < text.length && /\s/.test(text[after])) after++;
    const following = text[after];
    return following === undefined || following === '"' || following === '}' || following === ']';
  }
  if (ch === ':') return container === '{' && !valueComplete;
  return false;
}

function repairJson(text) {
  const out = [];
  const stack = [];
  let inString = false;
  let escaped = false;
  let valueComplete = false;

  const top = () => stack[stack.length - 1];

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (!escaped && ch === '"' && !isStringTerminator(text, i, top(), valueComplete)) {
        out.push('\\"');
        continue;
      }
      out.push(ch);
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
        if (top() === '{') {
          let j = i + 1;
          while (j < text.length && /\s/.test(text[j])) j++;
          valueComplete = text[j] !== ':';
        } else {
          valueComplete = true;
        }
      }
      continue;
    }

    if (/\s/.test(ch)) {
      out.push(ch);
      continue;
    }

    if (ch === '"') {
      if (valueComplete && (top() === '[' || top() === '{')) out.push(',');
      inString = true;
      valueComplete = false;
      out.push(ch);
      continue;
    }

    if (ch === '{' || ch === '[') {
      if (valueComplete && top() === '[') out.push(',');
      stack.push(ch);
      valueComplete = false;
      out.push(ch);
      continue;
    }

    if (ch === '}' || ch === ']') {
      if (top() === (ch === '}' ? '{' : '[')) stack.pop();
      valueComplete = true;
      out.push(ch);
      continue;
    }

    if (ch === ':') {
      valueComplete = false;
      out.push(ch);
      continue;
    }

    if (ch === ',') {
      valueComplete = false;
      out.push(ch);
      continue;
    }

    if (valueComplete && top() === '[') out.push(',');

    let j = i;
    while (j < text.length && !/[\s,\]}[{":]/.test(text[j])) j++;
    if (j === i) {
      out.push(ch);
      continue;
    }
    out.push(text.slice(i, j));
    valueComplete = true;
    i = j - 1;
  }

  while (stack.length) {
    out.push(stack.pop() === '{' ? '}' : ']');
  }

  return out.join('');
}

function parseAiResponse(aiResponse) {
  const normalized = normalizeResponse(aiResponse);
  try {
    return JSON.parse(normalized);
  } catch {
    try {
      return JSON.parse(repairJson(normalized));
    } catch {
      throw new SyntaxError(`Unable to parse AI response as JSON: ${normalized.substring(0, 100)}`);
    }
  }
}

const FREEMAIL_DOMAINS = [
  'gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'ymail.com',
  'aol.com', 'icloud.com', 'live.com', 'msn.com', 'me.com',
  'protonmail.com', 'proton.me', 'gmx.com', 'zoho.com', 'mail.com',
];

function senderDomains(fromAddr, parsed) {
  const domains = new Set();
  const add = value => {
    const match = String(value || '').match(/@([a-z0-9.-]+)/i);
    if (match) domains.add(match[1].toLowerCase());
  };
  add(fromAddr);
  for (const header of (parsed && parsed.headers) || []) {
    if (String(header.key || '').toLowerCase() === 'return-path') add(header.value);
  }
  return domains;
}

function isUnsubstantiatedFreemailClaim(reason, domains) {
  const text = String(reason || '');
  const lower = text.toLowerCase();
  const senderIsFreemail = FREEMAIL_DOMAINS.some(domain => domains.has(domain));
  const genericClaim = /\bfreemail\b|\bfree webmail\b|\bfree email (?:domain|provider|service|address)\b/i.test(text);
  if (genericClaim && !senderIsFreemail) return true;
  const citedDomains = lower.match(/[a-z0-9-]+(?:\.[a-z0-9-]+)+/g) || [];
  return citedDomains.some(domain => FREEMAIL_DOMAINS.includes(domain) && !domains.has(domain));
}

function filterAiReasons(reasons, fromAddr, parsed) {
  if (!Array.isArray(reasons)) return reasons;
  const domains = senderDomains(fromAddr, parsed);
  const filtered = reasons.filter(reason => !isUnsubstantiatedFreemailClaim(reason, domains));
  if (filtered.length === 0 && reasons.length > 0) {
    return ['AI classification could not be substantiated from the email headers.'];
  }
  return filtered;
}

function getFilteredOutReasons(rawReasons, filteredReasons) {
  if (!Array.isArray(rawReasons)) return [];
  const kept = new Set(filteredReasons);
  return rawReasons.filter(reason => !kept.has(reason));
}

module.exports = { parseAiResponse, repairJson, filterAiReasons, getFilteredOutReasons };
