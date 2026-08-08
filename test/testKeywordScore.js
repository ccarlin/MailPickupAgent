const fs = require('fs');
const path = require('path');
const PostalMime = require('postal-mime');
const config = require('../config');
const tools = require('../app/tools');
const { scoreKeywordFilters } = require('../app/keyword');

// Keep console output focused on scoring results
tools.logData = () => {};

const THRESHOLD_QUARANTINE = Number(config.THRESHOLD_QUARANTINE || 5);
const THRESHOLD_DELETE = Number(config.THRESHOLD_DELETE || 15);

const SCOPE_LABELS = { '1': 'Body', '2': 'Subject', '3': 'Full', '4': 'Headers', '5': 'Sender' };

const SAMPLE_EMAIL = [
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

function loadRules() {
  const rulesPath = path.join(__dirname, '..', 'config', 'rules.json');
  try {
    return JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
  } catch (err) {
    console.error(`Error loading rules: ${err.message}`);
    return { whitelist: {}, blacklist: {} };
  }
}

function dispositionFor(score) {
  if (score >= THRESHOLD_DELETE) return `DELETE (score ${score} >= ${THRESHOLD_DELETE})`;
  if (score >= THRESHOLD_QUARANTINE) return `QUARANTINE (score ${score} >= ${THRESHOLD_QUARANTINE})`;
  return `RELEASE (score ${score} < ${THRESHOLD_QUARANTINE})`;
}

async function scoreEmailRaw(raw, sourceLabel) {
  const parsed = await PostalMime.parse(raw);
  const recipients = (parsed.to || []).map(v => (v.address || '').split('@')[0].toUpperCase()).filter(Boolean);

  console.log('=== Email details ===');
  console.log(`  Source:     ${sourceLabel}`);
  console.log(`  From:       ${parsed.from?.address || 'unknown'}`);
  console.log(`  To:         ${(parsed.to || []).map(v => v.address).filter(Boolean).join(', ') || 'unknown'}`);
  console.log(`  Subject:    ${parsed.subject || '(no subject)'}`);
  console.log(`  Recipients: ${recipients.join(', ') || '(none)'}`);
  console.log('');

  const rules = loadRules();
  const filters = (rules.blacklist && rules.blacklist.keywordFilters) || [];
  const result = scoreKeywordFilters(parsed, filters, recipients);

  console.log('=== Keyword filter scoring ===');
  if (result.matchedFilters.length === 0) {
    console.log('  No keyword filters matched.');
  } else {
    result.matchedFilters.forEach((filter, i) => {
      const score = Number(filter.Score) || 0;
      const scope = SCOPE_LABELS[String(filter.SearchScope || '').trim()] || filter.SearchScope || 'Unknown';
      const recipient = filter.Recipient ? ` (recipient: ${filter.Recipient})` : '';
      console.log(`  ${i + 1}. ${filter.FilterName || 'Keyword'}${recipient}`);
      console.log(`     Score: ${score} | Scope: ${scope}`);
      console.log(`     Expression: ${String(filter.FilterExpression || '').replace(/\n/g, '\\n')}`);
    });
  }

  console.log('');
  console.log('=== Result ===');
  console.log(`  Keyword score:   ${result.score}`);
  console.log(`  Matched filters: ${result.matchedFilters.length} of ${filters.length}`);
  console.log(`  Disposition:     ${dispositionFor(result.score)}`);
  return result.score;
}

async function scoreEmailFile(filePath) {
  return scoreEmailRaw(fs.readFileSync(filePath, 'utf8'), filePath);
}

if (require.main === module) {
  (async () => {
    const fileArg = process.argv[2];
    try {
      if (fileArg) {
        const filePath = path.resolve(fileArg);
        if (!fs.existsSync(filePath)) {
          console.error(`File not found: ${filePath}`);
          process.exit(1);
        }
        console.log(`Scoring email file: ${filePath}\n`);
        await scoreEmailFile(filePath);
      } else {
        console.log('No email file provided. Using built-in sample spam email.');
        console.log('Usage: node test/testKeywordScore.js [path/to/email.eml]\n');
        await scoreEmailRaw(SAMPLE_EMAIL, 'built-in sample');
      }
      console.log('\nKeyword scoring completed.');
    } catch (err) {
      console.error(`Keyword scoring FAILED: ${err.message}`);
      process.exitCode = 1;
    }
  })();
}

module.exports = { scoreEmailFile, scoreEmailRaw, SAMPLE_EMAIL };
