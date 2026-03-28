#!/usr/bin/env node
'use strict';

/**
 * One-time accessibility cookie setup.
 *
 * Usage:
 *   node scripts/a11y_setup.js --email you@example.com
 *   node scripts/a11y_setup.js --magic-link "https://accounts.hcaptcha.com/accessibility/login?token=..."
 *   node scripts/a11y_setup.js --status
 *   node scripts/a11y_setup.js --clear
 */

const { register, followMagicLink } = require('../src/a11y_register');
const cookieStore = require('../src/a11y_cookie_store');

const args = process.argv.slice(2);

async function main() {
  if (args.includes('--status')) {
    const s = cookieStore.status();
    if (s.valid) {
      console.log(`Cookie valid — ${s.daysLeft} days remaining (${s.cookie})`);
    } else {
      console.log(`No valid cookie: ${s.reason}`);
    }
    return;
  }

  if (args.includes('--clear')) {
    cookieStore.clear();
    console.log('Cookie cleared.');
    return;
  }

  // Follow magic link only (skip signup)
  const mlIdx = args.indexOf('--magic-link');
  if (mlIdx !== -1) {
    const url = args[mlIdx + 1];
    if (!url) { console.error('--magic-link requires a URL argument'); process.exit(1); }
    console.log('Following magic link...');
    await followMagicLink(url, { debug: true });
    console.log('Done. Cookie saved.');
    return;
  }

  // Full registration
  const emailIdx = args.indexOf('--email');
  const email = emailIdx !== -1 ? args[emailIdx + 1] : process.env.HC_A11Y_EMAIL;
  if (!email) {
    console.error('Usage: node scripts/a11y_setup.js --email you@example.com');
    console.error('       node scripts/a11y_setup.js --magic-link "<url>"');
    console.error('       node scripts/a11y_setup.js --status');
    process.exit(1);
  }

  console.log('Starting accessibility registration for:', email);
  await register({ email, debug: true });
  console.log('\nSetup complete. Fast-path bypass is now active.');
  console.log('Cookie status:', cookieStore.status());
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
