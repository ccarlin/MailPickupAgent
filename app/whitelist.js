const { findMatchingSender, findMatchingIpRange } = require('./shared');

function checkWhitelist(fromAddr, originatingIp, recipients, whitelistRules) {
  if (!whitelistRules) return { whitelisted: false, reason: '' };
  const sender = findMatchingSender(fromAddr, whitelistRules.senders, recipients);
  if (sender !== null) {
    return { whitelisted: true, reason: 'Whitelisted Sender', ruleType: 'whitelist.senders', rule: sender };
  }
  const ipRange = findMatchingIpRange(originatingIp, whitelistRules.ipRanges);
  if (ipRange !== null) {
    return { whitelisted: true, reason: 'Whitelisted Originating IP', ruleType: 'whitelist.ipRanges', rule: ipRange };
  }
  return { whitelisted: false, reason: '' };
}

module.exports = { checkWhitelist };
