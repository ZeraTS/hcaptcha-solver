'use strict';

/**
 * test_all_challenges.js — Comprehensive hCaptcha challenge test
 *
 * Tests all 5 sitekeys, 3 attempts each.
 * Records: challenge type, token obtained, elapsed time.
 * Saves screenshots to /tmp/hc_test_results/
 */

const fs = require('fs');
const path = require('path');
const { BrowserSession } = require('./src/browser_session');

const SITEKEYS = [
  { key: '10000000-ffff-ffff-ffff-000000000001', name: 'test-sitekey' },
  { key: '338af34c-7bcb-4c7c-900b-acbec73d7d43', name: 'demo' },
  { key: 'a5f74b19-9e45-40e0-b45d-47ff91b7a6c2', name: 'hcaptcha-demo' },
  { key: '4c672d35-0701-42b2-88c3-78380b0db560', name: 'hcaptcha-accounts' },
  { key: 'a9b5fb07-92ff-493f-86fe-352a2803b3df', name: 'discord' },
];

const ATTEMPTS_PER_KEY = 3;
const RESULTS_DIR = '/tmp/hc_test_results';

async function main() {
  // Ensure results directory exists
  if (!fs.existsSync(RESULTS_DIR)) {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
  }

  console.log('\n=== hCaptcha Challenge Type Test ===\n');
  console.log(`Testing ${SITEKEYS.length} sitekeys × ${ATTEMPTS_PER_KEY} attempts each`);
  console.log(`Results → ${RESULTS_DIR}\n`);

  // Pre-init CLIP model before browser tests to time it separately
  console.log('Pre-loading CLIP model (may download ~340MB on first run)...');
  const modelStart = Date.now();
  const { getSolver } = require('./src/clip_solver');
  const clipSolver = await getSolver({ debug: false });
  const modelMs = Date.now() - modelStart;
  console.log(`CLIP model ready in ${(modelMs / 1000).toFixed(1)}s\n`);

  const session = new BrowserSession({ debug: true });
  const results = [];

  try {
    for (const { key, name } of SITEKEYS) {
      console.log(`\n--- Sitekey: ${name} (${key}) ---`);

      for (let attempt = 1; attempt <= ATTEMPTS_PER_KEY; attempt++) {
        console.log(`  Attempt ${attempt}/${ATTEMPTS_PER_KEY}...`);
        const startMs = Date.now();
        let row = {
          sitekey: name,
          attempt,
          challengeType: 'unknown',
          tokenObtained: false,
          elapsed: 0,
          error: null,
        };

        try {
          const result = await session.solve(key, 'accounts.hcaptcha.com');
          row.elapsed = Date.now() - startMs;
          row.challengeType = result.challengeType || 'auto';
          row.tokenObtained = !!(result.token && result.token.length > 10);
          if (row.tokenObtained) {
            console.log(`  ✓ Token: ${result.token.slice(0, 40)}... (${row.elapsed}ms) type=${row.challengeType}`);
          } else {
            console.log(`  ✗ No token (${row.elapsed}ms) type=${row.challengeType}`);
          }
        } catch (e) {
          row.elapsed = Date.now() - startMs;
          row.error = e.message.slice(0, 80);
          console.log(`  ✗ Error: ${row.error}`);
        }

        results.push(row);

        // Small delay between attempts
        if (attempt < ATTEMPTS_PER_KEY) {
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    }
  } finally {
    await session.close();
  }

  // Print summary table
  console.log('\n\n=== RESULTS SUMMARY ===\n');
  console.log('Sitekey             | Attempt | Challenge Type     | Token | Elapsed');
  console.log('--------------------+---------+--------------------+-------+--------');
  for (const r of results) {
    const sk = r.sitekey.padEnd(20);
    const att = String(r.attempt).padStart(7);
    const ct = (r.challengeType || 'unknown').padEnd(20);
    const tok = r.tokenObtained ? '  ✓   ' : '  ✗   ';
    const ms = `${r.elapsed}ms`;
    console.log(`${sk}| ${att} | ${ct}| ${tok}| ${ms}`);
  }

  const totalAttempts = results.length;
  const tokenCount = results.filter(r => r.tokenObtained).length;
  const challengeTypes = [...new Set(results.map(r => r.challengeType))];

  console.log('\n--- Summary ---');
  console.log(`Total attempts: ${totalAttempts}`);
  console.log(`Tokens obtained: ${tokenCount}/${totalAttempts}`);
  console.log(`Challenge types seen: ${challengeTypes.join(', ')}`);
  console.log(`CLIP model load time: ${(modelMs / 1000).toFixed(1)}s`);

  // Save results JSON
  const resultsPath = path.join(RESULTS_DIR, 'results.json');
  fs.writeFileSync(resultsPath, JSON.stringify({ results, modelLoadMs: modelMs }, null, 2));
  console.log(`\nFull results saved to ${resultsPath}`);

  if (tokenCount > 0) {
    console.log('\n✓ SUCCESS: At least one token obtained!');
    process.exit(0);
  } else {
    console.log('\n✗ No tokens obtained. Check CLIP model inference and challenge coordinates.');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
