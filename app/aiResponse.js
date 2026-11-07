'use strict';

function normalizeResponse(aiResponse) {
  return String(aiResponse || '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
    .replace(/[\r\n]+/g, ' ');
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

module.exports = { parseAiResponse, repairJson };
