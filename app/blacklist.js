const path = require('path');
const MMDBReader = require('mmdb-reader');
const tools = require('./tools');
const { findMatchingSender, findMatchingIpRange, extractTLD, checkCombos } = require('./shared');

const mmdb = new MMDBReader(path.join(__dirname, '..', 'GeoLite2-Country.mmdb'));

function matchCountry(originatingIp, countries) {
  if (originatingIp) {
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
      tools.logError(`GeoIP lookup failed for IP: ${originatingIp}.  Error: ${err.message}`);
    }
  }
  return { matched: false, country: null };
}

function checkBlacklist(fromAddr, originatingIp, recipients, blacklistRules, allowedTLDs) {
  if (!blacklistRules) return { matched: false, type: null };

  // Allowed TLDs enforcement
  const allowed = (allowedTLDs || []).map(s => String(s).toLowerCase().replace(/^\./, '')).filter(Boolean);
  if (allowed.length > 0) {
    const fromTld = extractTLD(fromAddr);
    if (fromTld && !allowed.includes(fromTld)) {
      return { matched: true, type: 'tld', score: 99, detail: `TLD ${fromTld} not allowed` };
    }
  }

  // Blacklisted sender
  const sender = findMatchingSender(fromAddr, blacklistRules.senders);
  if (sender !== null) {
    return { matched: true, type: 'sender', score: 99, detail: `Sender ${fromAddr}`, ruleType: 'blacklist.senders', rule: sender };
  }

  // Blacklisted IP
  const ipRange = findMatchingIpRange(originatingIp, blacklistRules.ipRanges);
  if (ipRange !== null) {
    return { matched: true, type: 'ip', score: 99, detail: `IP ${originatingIp}`, ruleType: 'blacklist.ipRanges', rule: ipRange };
  }

  return { matched: false, type: null };
}

module.exports = { matchCountry, checkBlacklist, checkCombos };
