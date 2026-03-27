'use strict';
/**
 * Live drag challenge test — tests puzzle_piece and drag_half with debug screenshots
 */
const { BrowserSession } = require('./src/browser_session');
const fs = require('fs');

const SITEKEYS = [
  { key: '338af34c-7bcb-4c7c-900b-acbec73d7d43', name: 'demo-basket' },
  { key: 'a5f74b19-9e45-40e0-b45d-47ff91b7a6c2', name: 'hc-demo-drag' },
  { key: '4c672d35-0701-42b2-88c3-78380b0db560', name: 'hc-accounts-drag' },
];

async function main() {
  const session = new BrowserSession({ debug: true });
  let passes = 0, total = 0;

  try {
    for (const { key, name } of SITEKEYS) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        total++;
        console.log(`\n[${name}] attempt ${attempt}/2`);
        const t0 = Date.now();
        try {
          const r = await session.solve(key, name);
          if (r.token && !r.token.startsWith('00000000')) {
            passes++;
            console.log(`✓ TOKEN: ${r.token.slice(0, 40)}... (${Date.now() - t0}ms) type=${r.challengeType}`);
          } else if (r.token) {
            passes++;
            console.log(`✓ AUTO-TOKEN (test key): ${r.token.slice(0, 30)}... (${Date.now() - t0}ms)`);
          } else {
            console.log(`✗ No token (${Date.now() - t0}ms) type=${r.challengeType}`);
          }
        } catch (e) {
          console.log(`✗ ERROR: ${e.message}`);
        }
      }
    }
  } finally {
    await session.close();
  }

  console.log(`\n=== RESULTS: ${passes}/${total} passed ===`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
