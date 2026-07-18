const { SpamAssassinClient } = require('spamassassin-client');
const config = require('../config');

const HOST = config.SPAMASSASSIN_HOST || '127.0.0.1';
const PORT = Number(config.SPAMASSASSIN_PORT) || 783;
const TIMEOUT = 10;

const SPAM_EMAIL = [
  'From: "Earn Cash Fast" <spammer@example.xyz>',
  'To: victim@example.com',
  'Subject: IMPORTANT: You have won a FREE gift card! Claim now!',
  'Date: ' + new Date().toUTCString(),
  'MIME-Version: 1.0',
  'Content-Type: text/plain; charset="utf-8"',
  '',
  'CONGRATULATIONS!!!',
  '',
  'You have been selected as a WINNER of our exclusive promotion!',
  'This is your FINAL CHANCE to claim your FREE $1000 Amazon gift card!',
  '',
  'CLICK HERE NOW: http://spam.example.xyz/claim',
  '',
  'Act now! This limited time offer expires soon!',
  '',
  'Buy VIAGRA and other prescription drugs at unbeatable prices!',
  'No prescription needed! Discreet shipping!',
  '',
  'To unsubscribe, send an email to spam@example.xyz with subject "STOP"',
].join('\r\n');

async function testSpamAssassin() {
  console.log(`Connecting to SpamAssassin at ${HOST}:${PORT}...`);

  const client = new SpamAssassinClient({
    host: HOST,
    port: PORT,
    timeout: TIMEOUT,
  });

  try {
    await client.ping();
    console.log('Ping OK - SpamAssassin is reachable');
  } catch (err) {
    console.error(`Ping FAILED: ${err.message}`);
    console.error('Check that spamd is running and accessible at the configured host:port.');
    process.exit(1);
  }

  console.log('Sending spam-like test message...\n');

  try {
    const result = await client.report(SPAM_EMAIL);

    console.log('=== SpamAssassin Result ===');
    console.log(`  Score:     ${result.score}`);
    console.log(`  Is Spam:   ${result.spam}`);
    console.log(`  Response:  ${result.message}`);
    console.log('');

    if (result.report) {
      const lines = result.report.split('\n').slice(0, 20).join('\n');
      console.log('Report (first 20 lines):');
      console.log(lines);
    }

    const thresholdMatch = (result.report || '').match(/threshold[:\s]+([\d.]+)/i);
    const threshold = thresholdMatch ? parseFloat(thresholdMatch[1]) : 5.0;

    console.log('');
    if (result.spam) {
      console.log(`PASS: Message correctly classified as spam (score ${result.score} >= ${threshold})`);
    } else {
      console.log(`INFO: Message scored ${result.score} (threshold ${threshold}) - not classified as spam`);
      console.log('      This may be normal if your SpamAssassin rules are lenient.');
      console.log('      Ensure spam rules are enabled (e.g., with `sa-update` and `spamd --allow-tell`).');
    }

    process.exit(result.spam ? 0 : 2);
  } catch (err) {
    console.error(`SpamAssassin check FAILED: ${err.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  testSpamAssassin();
}

module.exports = { testSpamAssassin };
