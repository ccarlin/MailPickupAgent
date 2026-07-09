const { SpamAssassinClient } = require('spamassassin-client');
const tools = require('./tools');
const config = require('../config');

const SPAMASSASSIN_ENABLED = config.SPAMASSASSIN_ENABLED;
const SPAMASSASSIN_HOST = config.SPAMASSASSIN_HOST;
const SPAMASSASSIN_PORT = Number(config.SPAMASSASSIN_PORT);

const spamAssassinClient = SPAMASSASSIN_ENABLED ? new SpamAssassinClient({
  host: SPAMASSASSIN_HOST,
  port: SPAMASSASSIN_PORT,
  timeout: 5,
}) : null;

function checkSpamAssassin(rawEmail) {
  if (!spamAssassinClient) {
    return Promise.resolve(null);
  }

  return spamAssassinClient.symbols(rawEmail).then((result) => {
    return {
      isSpam: result.spam,
      score: result.score,
      threshold: 5.0,
      fullReport: (result.symbols || []).join(', '),
    };
  }).catch((err) => {
    tools.logError(`SpamAssassin check failed: ${err.message}`);
    return null;
  });
}

module.exports = { checkSpamAssassin };
