const config = require('../config');
const { check } = require('../app/abuseipdb');

const TEST_IPS = [
  { name: 'clean', ip: '8.8.8.8', description: 'Google DNS (expected clean)', expectedAbusive: false },
  { name: 'malicious', ip: '208.75.123.168', description: 'Known malicious IP (expected high confidence)', expectedAbusive: true },
];

async function testAbuseIPDB() {
  const key = config.ABUSEIPDB_KEY;
  if (!key) {
    console.error('ABUSEIPDB_KEY is not configured. Set it in config before running this test.');
    process.exit(1);
  }

  console.log('Testing AbuseIPDB API connection...\n');

  let failures = 0;
  for (const test of TEST_IPS) {
    console.log(`=== ${test.name.toUpperCase()} test (${test.ip}) ===`);
    console.log(`  Description: ${test.description}`);

    const result = await check(test.ip);

    if (!result) {
      console.log('  Result:      No response (API error or timeout)');
      console.log('  FAIL: Unable to reach AbuseIPDB API.\n');
      failures += 1;
      continue;
    }

    console.log(`  Confidence:  ${result.abuseConfidenceScore}`);
    console.log(`  Reports:     ${result.totalReports}`);
    console.log(`  Country:     ${result.countryCode || 'N/A'}`);
    console.log(`  ISP:         ${result.isp || 'N/A'}`);

    const isAbusive = result.abuseConfidenceScore > 0;
    const passed = isAbusive === test.expectedAbusive;
    console.log(`  ${passed ? 'PASS' : 'FAIL'}: Expected ${test.expectedAbusive ? 'abusive' : 'clean'} (confidence ${result.abuseConfidenceScore}).\n`);

    if (!passed) failures += 1;
  }

  if (failures) {
    console.error(`${failures} AbuseIPDB test(s) failed.`);
    process.exitCode = 1;
  } else {
    console.log('PASS: AbuseIPDB API is working correctly.');
  }
}

if (require.main === module) {
  testAbuseIPDB().catch(err => {
    console.error(`AbuseIPDB test failed: ${err.message}`);
    process.exitCode = 1;
  });
}

module.exports = { testAbuseIPDB };
