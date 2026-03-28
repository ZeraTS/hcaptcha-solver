'use strict';

const { AccessibilitySolver } = require('./src/accessibility_solver');

async function main() {
  const cookie = process.env.HC_ACCESSIBILITY_COOKIE;

  if (!cookie) {
    console.log('=== Accessibility Solver Test ===\n');
    console.log('No HC_ACCESSIBILITY_COOKIE set.\n');
    console.log('To test:');
    console.log('  1. Sign up at https://dashboard.hcaptcha.com/signup?type=accessibility');
    console.log('  2. Verify email and click "Set Cookie"');
    console.log('  3. Extract the hc_accessibility cookie value from your browser');
    console.log('  4. Run: HC_ACCESSIBILITY_COOKIE=<value> node test_accessibility.js\n');

    console.log('Testing solver initialization (no cookie)...');
    const solver = new AccessibilitySolver({ debug: true });
    try {
      await solver.solve('a5f74b19-9e45-40e0-b45d-47ff91b7a6c2', 'accounts.hcaptcha.com');
    } catch (err) {
      console.log('Expected error:', err.message);
      console.log('\nSolver works — just needs a valid cookie.');
    }
    return;
  }

  console.log('=== Accessibility Solver Test ===\n');
  console.log('Cookie:', cookie.slice(0, 10) + '...' + cookie.slice(-5));

  const solver = new AccessibilitySolver({
    accessibilityCookie: cookie,
    debug: true,
  });

  // Test 1: hCaptcha demo sitekey
  console.log('\n--- Test: hCaptcha demo sitekey ---');
  try {
    const result = await solver.solve('a5f74b19-9e45-40e0-b45d-47ff91b7a6c2', 'accounts.hcaptcha.com');
    console.log('SUCCESS!');
    console.log('Token:', result.token.slice(0, 50) + '...');
    console.log('Type:', result.type);
    console.log('Elapsed:', result.elapsed + 'ms');
  } catch (err) {
    console.log('FAILED:', err.message);
  }

  // Test 2: Discord sitekey
  console.log('\n--- Test: Discord sitekey ---');
  try {
    const result = await solver.solve('a9b5fb07-92ff-493f-86fe-352a2803b3df', 'discord.com');
    console.log('SUCCESS!');
    console.log('Token:', result.token.slice(0, 50) + '...');
    console.log('Type:', result.type);
    console.log('Elapsed:', result.elapsed + 'ms');
  } catch (err) {
    console.log('FAILED:', err.message);
  }
}

main().catch(console.error);
