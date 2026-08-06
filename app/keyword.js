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

module.exports = { getKeywordText, matchKeywordFilter, scoreKeywordFilters };
