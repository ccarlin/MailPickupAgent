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

function extractOriginatingIp(commandData) {
  const match = commandData.match(/ClientIP=(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
  if (match) return match[1];
  return null;
}

function extractTLD(address) {
  if (!address || typeof address !== 'string') return null;
  const at = address.lastIndexOf('@');
  if (at === -1) return null;
  const domain = address.slice(at + 1).toLowerCase();
  const parts = domain.split('.').filter(Boolean);
  if (!parts.length) return null;
  return parts[parts.length - 1];
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
      if (atIndex !== -1) {
        const domain = addrLower.slice(atIndex + 1);
        if (domain === e || domain.endsWith('.' + e)) return true;
      }
    }
  }
  return false;
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

module.exports = {
  matchSubject,
  ipInRange,
  extractOriginatingIp,
  extractTLD,
  matchSender,
  checkCombos
};
