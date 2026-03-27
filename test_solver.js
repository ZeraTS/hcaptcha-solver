'use strict';

const { HCaptchaSolver } = require('./src/solver');

const USE_REAL = process.argv.includes('--real');

async function testSitekey(label, sitekey, host) {
  console.log(`\n--- ${label} ---`);
  console.log(`Sitekey: ${sitekey}`);
  console.log(`Host:    ${host}`);
  console.log('');

  const solver = new HCaptchaSolver({
    sitekey,
    host,
    debug: true,
    timeout: 60000,
  });

  try {
    console.log('Starting solve...');
    const result = await solver.solve();
    console.log('\nSUCCESS!');
    console.log('Token:', result.token);
    console.log('Type:', result.type);
    console.log('Elapsed:', result.elapsed + 'ms');

    if (result.token.startsWith('P0_') || result.token.startsWith('P1_') || result.token.startsWith('P2_')) {
      console.log('Token format verified.');
    } else {
      console.log('Warning: Unexpected token format:', result.token.slice(0, 30));
    }
    return true;
  } catch (err) {
    console.error('\nFAILED:', err.message);
    if (err.stack) {
      console.error(err.stack.split('\n').slice(0, 5).join('\n'));
    }
    return false;
  } finally {
    solver.close();
  }
}

async function main() {
  console.log('hCaptcha Solver Test');
  console.log('====================');

  // Test 1: official test sitekey (always passes immediately, no PoW)
  const ok1 = await testSitekey(
    'Test sitekey (always pass)',
    '10000000-ffff-ffff-ffff-000000000001',
    'hcaptcha.com'
  );

  if (!ok1) {
    console.error('\nBaseline test failed — stopping.');
    process.exit(1);
  }

  // Test 2: real production sitekey (exercises PoW VM)
  if (USE_REAL) {
    console.log('\n--- Real sitekey test (exercises PoW + image challenge) ---');
    console.log('Note: client-fail / pass=false is expected without a real browser session.');
    console.log('Success criterion: PoW runs without error and HTTP calls are made.\n');

    const ok2 = await testSitekey(
      'Real sitekey (Discord)',
      'a9b5fb07-92ff-493f-86fe-352a2803b3df',
      'discord.com'
    );

    // For the real sitekey, failure is expected and acceptable
    if (!ok2) {
      console.log('\nReal sitekey test ended with error (expected without real browser session).');
      console.log('Check logs above — if PoW solved and HTTP calls were made, the solver is working.');
    }
  } else {
    console.log('\nSkipping real sitekey test. Run with --real flag to include it.');
    console.log('  node test_solver.js --real');
  }

  console.log('\nDone.');
}

main();
