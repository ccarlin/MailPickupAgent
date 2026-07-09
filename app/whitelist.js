const { matchSender, ipInRange } = require('./shared');

function checkWhitelist(fromAddr, originatingIp, recipients, whitelistRules) {
  if (!whitelistRules) return { whitelisted: false, reason: '' };
  if (matchSender(fromAddr, whitelistRules.senders, recipients)) {
    return { whitelisted: true, reason: 'Whitelisted Sender' };
  }
  if (ipInRange(originatingIp, whitelistRules.ipRanges)) {
    return { whitelisted: true, reason: 'Whitelisted Originating IP' };
  }
  return { whitelisted: false, reason: '' };
}

module.exports = { checkWhitelist };
