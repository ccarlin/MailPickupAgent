'use strict';

const KEY_HEADERS = ['from', 'reply-to', 'return-path', 'to', 'subject', 'authentication-results'];
const HEADER_LABELS = {
  from: 'From',
  'reply-to': 'Reply-To',
  'return-path': 'Return-Path',
  to: 'To',
  subject: 'Subject',
  'authentication-results': 'Authentication-Results',
};

function formatAddress(addr) {
  if (!addr) return '';
  if (typeof addr === 'string') return addr;
  if (addr.name && addr.address) return `${addr.name} <${addr.address}>`;
  return addr.address || addr.name || '';
}

function headerMap(parsed) {
  const map = {};
  for (const entry of parsed.headers || []) {
    const key = String(entry.key || '').toLowerCase();
    if (!key || map[key] !== undefined) continue;
    map[key] = String(entry.value ?? '');
  }
  return map;
}

function buildHeaderBlock(parsed, opts) {
  const map = headerMap(parsed);
  const values = {
    from: formatAddress(parsed.from) || map.from || opts.from || '',
    'reply-to': map['reply-to'] || '',
    'return-path': map['return-path'] || '',
    to: (parsed.to || []).map(formatAddress).filter(Boolean).join(', ') || map.to || '',
    subject: parsed.subject || map.subject || opts.subject || '',
    'authentication-results': map['authentication-results'] || '',
  };
  return KEY_HEADERS
    .filter(key => values[key])
    .map(key => `${HEADER_LABELS[key]}: ${String(values[key]).replace(/[\r\n]+/g, ' ').trim()}`)
    .join('\n');
}

function stripBase64(content) {
  return String(content || '')
    .replace(/data:[\w.+-]+\/[\w.+-]+;base64,[A-Za-z0-9+/=\s]+/gi, ' ')
    .replace(/[A-Za-z0-9+/]{120,}={0,2}/g, ' ');
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/\s+/g, ' ')
    .trim();
}

function attr(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return match ? (match[2] ?? match[3] ?? match[4] ?? '') : '';
}

function extensionForType(type) {
  const subtype = String(type || '').split('/')[1] || 'img';
  return subtype.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'img';
}

function collectInlineImages(parsed) {
  const html = String(parsed.html || '');
  const imgTags = html.match(/<img\b[^>]*>/gi) || [];
  const altByCid = {};
  for (const tag of imgTags) {
    const cid = attr(tag, 'src').match(/^cid:(.+)$/i);
    if (cid) altByCid[cid[1]] = attr(tag, 'alt');
  }

  const attachments = (parsed.attachments || []).filter(attachment => {
    const type = String(attachment.contentType || '');
    return /^image\//i.test(type)
      || attachment.related
      || /^inline$/i.test(String(attachment.disposition || ''));
  });

  if (attachments.length === 0) {
    return imgTags
      .filter(tag => /src\s*=\s*["']?(?:data:|cid:)/i.test(tag))
      .map((tag, index) => {
        const src = attr(tag, 'src');
        const dataMatch = src.match(/^data:([^;]+);base64,/i);
        const type = dataMatch ? dataMatch[1] : 'image/unknown';
        return {
          index: index + 1,
          filename: `inline-image-${index + 1}.${extensionForType(type)}`,
          alt: attr(tag, 'alt'),
          type,
          bytes: 0,
        };
      });
  }

  return attachments.map((attachment, index) => {
    const type = String(attachment.contentType || 'application/octet-stream');
    const cid = String(attachment.contentId || '').replace(/^<|>$/g, '');
    const tagAlt = index < imgTags.length ? attr(imgTags[index], 'alt') : '';
    const bytes = attachment.content && attachment.content.byteLength !== undefined
      ? attachment.content.byteLength
      : (Number(attachment.size) || 0);
    return {
      index: index + 1,
      filename: attachment.filename || `inline-image-${index + 1}.${extensionForType(type)}`,
      alt: altByCid[cid] ?? tagAlt,
      type,
      bytes,
    };
  });
}

function buildAiEmailContent(parsed, opts = {}) {
  const source = parsed || {};
  const maxTextChars = Number(opts.maxTextChars || 2000) || 2000;

  const plainText = stripBase64(source.text || '');
  let visibleText = plainText.trim()
    ? plainText
    : stripHtml(stripBase64(source.html || ''));
  visibleText = visibleText.replace(/\s+/g, ' ').trim();

  const wordCount = visibleText ? visibleText.split(/\s+/).filter(Boolean).length : 0;
  const cappedText = visibleText.slice(0, maxTextChars);

  const images = collectInlineImages(source);
  const imageLines = images.length
    ? images.map(image => `[Inline Image ${image.index}: ${image.filename}, alt="${image.alt}", type=${image.type}, size=${Math.round(image.bytes / 1024)} KB]`).join('\n')
    : 'None';

  const parts = [];
  const headerBlock = buildHeaderBlock(source, opts);
  if (headerBlock) parts.push(headerBlock);
  parts.push(`Visible Body Text (${wordCount} words):\n${cappedText || '(no visible text)'}`);
  parts.push(`Inline Media:\n${imageLines}`);
  return parts.join('\n\n');
}

module.exports = { buildAiEmailContent, stripHtml, stripBase64, collectInlineImages };
