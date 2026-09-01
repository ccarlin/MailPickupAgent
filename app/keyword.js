const tools = require('./tools');

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
    case '5': return parsed.from?.address || '';
    default: return [subject, body].filter(Boolean).join('\n');
  }
}

function matchKeywordFilter(parsed, filter, recipients) {
  if (!filter) return false;
  if (typeof filter.Enabled !== 'undefined') {
    const en = String(filter.Enabled).trim();
    if (en === '0' || en.toLowerCase() === 'false') return false;
  }

  if (filter.Recipient && recipients) {
    const filterRecipient = String(filter.Recipient).trim().toLowerCase();
    if (!recipients.some(r => r.toLowerCase() === filterRecipient)) return false;
  }

  const text = getKeywordText(parsed, filter);
  if (!text) return false;
  const expression = String(filter.FilterExpression || '').trim();
  if (!expression) return false;

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

    const matchType = String(filter.FilterMatchType || '').trim();
    if (matchType === '1') {
      const pattern = `\\b${escapeRegex(expr)}`;
      try { 
        return new RegExp(pattern, flags).test(text); 
      } 
      catch { 
        tools.logWarn(`Invalid regex pattern for match type Starts With: ${pattern}`);
        return false; 
      }
    }
    if (matchType === '2') {
      const pattern = `${escapeRegex(expr)}\\b`;
      try { 
        return new RegExp(pattern, flags).test(text); 
      } 
      catch { 
        tools.logWarn(`Invalid regex pattern for match type Ends With: ${pattern}`);
        return false; 
      }
    }
    if (matchType === '3') {
      const pattern = `\\b${escapeRegex(expr)}\\b`;
      try { 
        return new RegExp(pattern, flags).test(text); 
      } 
      catch { 
        tools.logWarn(`Invalid regex pattern for match type Contains: ${pattern}`);
        return false; 
      }
    }
    if (caseSensitive) return text.includes(expr);
    return text.toLowerCase().includes(expr.toLowerCase());
  };

  if (requireAll) {
    return expressions.every(e => testExpression(e));
  }
  return expressions.some(e => testExpression(e));
}

const SCOPE_LABELS = { '1': 'Body', '2': 'Subject', '3': 'Full', '4': 'Headers', '5': 'Sender' };

function scopeLabel(scope) {
  return SCOPE_LABELS[String(scope || '').trim()] || String(scope || '').trim() || 'Full';
}

function truncate(str, max) {
  return String(str).length > max ? String(str).slice(0, max) + '…' : String(str);
}

function extractContext(text, index) {
  const start = Math.max(0, index - 30);
  const end = Math.min(text.length, index + 40);
  const ctx = text.slice(start, end).replace(/\r?\n/g, ' ');
  return truncate((start > 0 ? '…' : '') + ctx + (end < text.length ? '…' : ''), 120);
}

// Detailed diagnostic test of a single keyword filter against a parsed email.
// Returns an object describing exactly why the rule did or did not match.
function testKeywordFilter(parsed, filter, recipients) {
  const result = {
    filterId: filter.FilterName || 'Keyword',
    score: Number(filter.Score) || 0,
    matched: false,
    reasons: [],
    disabled: false,
    recipientFiltered: false,
    scopeTextEmpty: false,
    emptyExpression: false,
    matchedCount: 0,
    requireAll: false,
  };

  if (typeof filter.Enabled !== 'undefined') {
    const en = String(filter.Enabled).trim();
    if (en === '0' || en.toLowerCase() === 'false') {
      result.disabled = true;
      return result;
    }
  }

  if (filter.Recipient && recipients) {
    const filterRecipient = String(filter.Recipient).trim().toLowerCase();
    const localRecipients = (recipients || []).map(r => r.toLowerCase());
    if (!localRecipients.includes(filterRecipient)) {
      result.recipientFiltered = true;
      result.recipientFilter = filterRecipient;
      result.recipients = recipients;
      return result;
    }
  }

  const scope = String(filter.SearchScope || '').trim();
  const text = getKeywordText(parsed, filter);
  if (!text) {
    result.scopeTextEmpty = true;
    result.scope = scopeLabel(scope);
    return result;
  }

  const expression = String(filter.FilterExpression || '').trim();
  if (!expression) {
    result.emptyExpression = true;
    result.scope = scopeLabel(scope);
    return result;
  }

  result.scope = scopeLabel(scope);

  const caseSensitive = (String(filter.FilterCaseSensitive || filter.FilterCaseSensative || '').trim() === '1');
  const regexMode = String(filter.FilterExpressionType || '').trim() === '1';
  const expressions = expression.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const requireAll = String(filter.FilterMultipleExpressionAndOR || '').trim() === '1';
  const flags = caseSensitive ? 'g' : 'gi';

  const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const typeLabels = { '0': 'Any (contains)', '1': 'Starts with', '2': 'Ends with', '3': 'Whole word' };

  const testExpression = (expr) => {
    const detail = { expression: expr, matched: false, error: null, detail: '' };
    if (regexMode) {
      try {
        const rx = new RegExp(expr, flags);
        const m = rx.exec(text);
        detail.matched = !!m;
        if (detail.matched) {
          detail.detail = 'Regex matched starting at position ' + m.index + (m[0] ? ' → found "' + truncate(m[0], 30) + '"' : '');
          detail.matchText = extractContext(text, m.index);
        } else {
          detail.detail = 'Regex pattern did not match anywhere in the ' + scopeLabel(scope).toLowerCase() + ' text.';
        }
        return detail;
      } catch (e) {
        detail.error = e.message;
        detail.detail = 'Invalid regex: ' + e.message;
        return detail;
      }
    }

    const matchType = String(filter.FilterMatchType || '').trim();
    const typeLabel = typeLabels[matchType] || typeLabels['0'];
    if (matchType === '0' || matchType === '') {
      const idx = caseSensitive ? text.indexOf(expr) : text.toLowerCase().indexOf(expr.toLowerCase());
      detail.matched = idx !== -1;
      if (detail.matched) {
        detail.detail = 'Found "' + truncate(expr, 40) + '" (' + typeLabel + ') at position ' + idx + (caseSensitive ? ' (case-sensitive)' : ' (case-insensitive)');
        detail.matchText = extractContext(text, idx);
      } else {
        detail.detail = 'Could not find "' + truncate(expr, 40) + '" (' + typeLabel + ') in the ' + scopeLabel(scope).toLowerCase() + (caseSensitive ? '' : ' (checked case-insensitively)') + '.';
      }
      return detail;
    }

    let pattern;
    if (matchType === '1') pattern = `\\b${escapeRegex(expr)}`;
    else if (matchType === '2') pattern = `${escapeRegex(expr)}\\b`;
    else if (matchType === '3') pattern = `\\b${escapeRegex(expr)}\\b`;
    else pattern = escapeRegex(expr);

    try {
      const rx = new RegExp(pattern, flags);
      const m = rx.exec(text);
      detail.matched = !!m;
      if (detail.matched) {
        detail.detail = 'Matched "' + typeLabel + '" for "' + truncate(expr, 40) + '" at position ' + m.index + (caseSensitive ? ' (case-sensitive)' : ' (case-insensitive)');
        detail.matchText = extractContext(text, m.index);
      } else {
        detail.detail = '"' + typeLabel + '" did not match "' + truncate(expr, 40) + '" in the ' + scopeLabel(scope).toLowerCase() + '.';
      }
      return detail;
    } catch (e) {
      detail.error = e.message;
      detail.detail = 'Invalid pattern: ' + e.message;
      return detail;
    }
  };

  expressions.forEach(e => result.reasons.push(testExpression(e)));

  const anyMatched = result.reasons.filter(r => r.matched).length;
  result.requireAll = requireAll;
  result.matchedCount = anyMatched;
  result.matched = requireAll
    ? result.reasons.length > 0 && result.reasons.every(r => r.matched)
    : anyMatched > 0;

  return result;
}

function scoreKeywordFilters(parsed, filters, recipients) {
  if (!filters || !filters.length) return { score: 0, matches: [], matchedFilters: [] };
  return filters.reduce((acc, filter) => {
    if (matchKeywordFilter(parsed, filter, recipients)) {
      const score = Number(filter.Score) || 0;
      const filterName = filter.FilterName || 'Keyword';
      tools.logData(`Keyword filter matched: "${filterName}", score: ${score}`);
      acc.matchedFilters.push(filter);
      if (score > 0) {
        acc.score += score;
        acc.matches.push({ name: filterName, score: score });
      }
    }
    return acc;
  }, { score: 0, matches: [], matchedFilters: [] });
}

module.exports = { getKeywordText, matchKeywordFilter, scoreKeywordFilters, testKeywordFilter, scopeLabel };
