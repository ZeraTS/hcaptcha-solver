'use strict';
const { BrowserSession } = require('./src/browser_session');

async function main() {
  const sess = new BrowserSession({ debug: true });
  try {
    console.log('=== BrowserSession: demo sitekey (accounts.hcaptcha.com/demo) ===\n');
    const r = await sess.solve('a5f74b19-9e45-40e0-b45d-47ff91b7a6c2', 'accounts.hcaptcha.com');
    console.log('\n--- Result ---');
    console.log('token:', r.token ? r.token.slice(0, 50) + '...' : null);
    console.log('elapsed:', r.elapsed + 'ms');
    console.log('autoSolved:', r.autoSolved);
    console.log('cookies:', Object.keys(r.cookies).join(', '));
    if (r.token) {
      console.log('\nSUCCESS — P-token captured from browser');
    } else {
      console.log('\nFAILED — no token after timeout');
    }
  } finally {
    await sess.close();
  }
}

main().catch(e => { console.error('FAIL:', e.message, '\n', e.stack); process.exit(1); });
