const config = require('../config');
const { checkAiSpam } = require('../app/ai');

const TEST_EMAILS = [
  {
    name: 'spam',
    expectedSpam: true,
    from: 'security-alert@account-verify.example.xyz',
    subject: 'URGENT: Your account will be suspended today',
    text: 'Dear Customer, your account has been suspended. Click https://account-verify.example.xyz/login immediately to verify your identity or you will lose access.',
  },
  {
    name: 'ham',
    expectedSpam: false,
    from: 'sarah.williams@example.com',
    subject: 'Project update meeting tomorrow',
    text: 'Hi team, just a reminder that we are meeting at 10 AM tomorrow in Room B to review the Q3 slides. See you there, Sarah.',
  },
];

function getAiEndpoint() {
  const aiSystem = String(config.AI_SYSTEM || 'OLLAMA').toUpperCase();
  if (aiSystem === 'LLAMACPP') {
    return `${config.LLAMACPP_SERVER || 'localhost'}:${config.LLAMACPP_PORT || 8080}`;
  }
  return `${config.OLLAMA_SERVER || 'localhost'}:${config.OLLAMA_PORT || 11434}`;
}

async function testAiCheck() {
  const aiSystem = String(config.AI_SYSTEM || 'OLLAMA').toUpperCase();
  console.log(`Testing ${aiSystem} AI check at ${getAiEndpoint()}...`);
  console.log(`Model: ${aiSystem === 'LLAMACPP' ? config.LLAMACPP_MODEL : config.OLLAMA_MODEL}\n`);

  const overallStart = performance.now();
  let failures = 0;
  for (const test of TEST_EMAILS) {
    const testStart = performance.now();
    const result = await checkAiSpam(test.from, test.subject, { text: test.text });
    const elapsed = ((performance.now() - testStart) / 1000).toFixed(2);
    const expectedClassification = test.expectedSpam ? 'SPAM' : 'HAM';
    const passed = result.aiCheckSucceeded && result.aiClassification === expectedClassification;

    console.log(`=== ${test.name.toUpperCase()} test ===`);
    console.log(`  Classification: ${result.aiClassification}`);
    console.log(`  Score:          ${result.aiScore}`);
    console.log(`  Reasons:        ${result.aiReasons || 'None'}`);
    console.log(`  Time:           ${elapsed}s`);
    console.log(`  ${passed ? 'PASS' : 'FAIL'}: expected ${expectedClassification}.\n`);

    if (!passed) failures += 1;
  }

  const overallElapsed = ((performance.now() - overallStart) / 1000).toFixed(2);
  console.log(`Total time: ${overallElapsed}s`);

  if (failures) {
    console.error(`${failures} AI classification test(s) failed.`);
    process.exitCode = 1;
  } else {
    console.log('PASS: AI check classified both test emails as expected.');
  }
}

if (require.main === module) {
  testAiCheck().catch(err => {
    console.error(`AI check test failed: ${err.message}`);
    process.exitCode = 1;
  });
}

module.exports = { testAiCheck, TEST_EMAILS };
