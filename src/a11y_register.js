'use strict';

/**
 * a11y_register.js
 *
 * One-time Playwright flow to obtain the hc_accessibility cookie.
 *
 * Flow:
 *   1. Navigate to https://accounts.hcaptcha.com/accessibility
 *   2. Fill email + submit form (which itself has an hCaptcha — sitekey a6744f2e-...)
 *   3. Poll inbox for magic link (IMAP or manual paste)
 *   4. Follow magic link → extract hc_accessibility cookie from .hcaptcha.com domain
 *   5. Save to disk via a11y_cookie_store
 *
 * Two modes:
 *   - auto:   requires IMAP credentials (env HC_A11Y_EMAIL, HC_A11Y_EMAIL_PASS, HC_A11Y_IMAP_HOST)
 *   - manual: prints magic link prompt, user pastes the URL — good for one-off setup
 */

const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
const { save } = require('./a11y_cookie_store');
const readline = require('readline');

chromium.use(stealth());

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';
const SIGNUP_URL = 'https://accounts.hcaptcha.com/accessibility';
const MAGIC_LINK_BASE = 'https://accounts.hcaptcha.com/accessibility/login';

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim()); }));
}

/**
 * Register and obtain hc_accessibility cookie via browser.
 *
 * @param {object} opts
 * @param {string} opts.email        - Email address to register with
 * @param {string} [opts.proxy]      - Optional proxy (http://user:pass@host:port)
 * @param {boolean} [opts.headless]  - Run headless (default true)
 * @param {boolean} [opts.debug]     - Verbose logging
 * @returns {Promise<string>}        - The hc_accessibility cookie value
 */
async function register(opts = {}) {
  const email = opts.email || process.env.HC_A11Y_EMAIL;
  if (!email) throw new Error('email required (pass opts.email or set HC_A11Y_EMAIL)');

  const log = (...args) => { if (opts.debug !== false) console.log('[a11y-register]', ...args); };

  log('Launching browser...');
  const launchOpts = {
    headless: opts.headless !== false,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  };
  if (opts.proxy) launchOpts.proxy = { server: opts.proxy };

  const browser = await chromium.launch(launchOpts);

  try {
    const ctx = await browser.newContext({
      userAgent: UA,
      viewport: { width: 1366, height: 768 },
      locale: 'en-US',
    });
    const page = await ctx.newPage();

    // ── Step 1: Load signup page ──────────────────────────────────────────────
    log('Loading signup page:', SIGNUP_URL);
    await page.goto(SIGNUP_URL, { waitUntil: 'networkidle', timeout: 20000 });

    // ── Step 2: Fill email field ──────────────────────────────────────────────
    log('Filling email:', email);
    await page.waitForSelector('input[type="email"], input[name="email"], input[placeholder*="email" i]', { timeout: 10000 });
    const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]').first();
    await emailInput.fill(email);

    // ── Step 3: Solve the embedded hCaptcha (sitekey a6744f2e-...) ────────────
    // The signup form itself has an hCaptcha checkbox. Click it to trigger.
    log('Clicking hCaptcha checkbox on signup form...');
    const checkboxFrame = page.frameLocator('iframe[src*="checkbox"]').first();
    await checkboxFrame.locator('#checkbox').click({ timeout: 10000 }).catch(() => {
      log('Checkbox not found in iframe, trying direct click');
    });

    // Wait for hCaptcha to be solved (listen for h-captcha-response token)
    log('Waiting for hCaptcha token on signup form...');
    const token = await page.evaluate(() => {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('hCaptcha token timeout')), 60000);
        const check = setInterval(() => {
          const el = document.querySelector('textarea[name="h-captcha-response"]');
          if (el && el.value && el.value.length > 20) {
            clearInterval(check);
            clearTimeout(timeout);
            resolve(el.value);
          }
        }, 500);
      });
    }).catch(err => { throw new Error('hCaptcha on signup form not solved: ' + err.message); });

    log('hCaptcha token obtained:', token.slice(0, 30) + '...');

    // ── Step 4: Submit the form ───────────────────────────────────────────────
    log('Submitting signup form...');
    await page.click('button[type="submit"], input[type="submit"], button:has-text("Submit"), button:has-text("Send")').catch(() => {
      log('Submit button not found, pressing Enter');
      return page.keyboard.press('Enter');
    });

    // Wait for confirmation message
    await page.waitForTimeout(3000);
    const bodyText = await page.evaluate(() => document.body.innerText);
    log('Page after submit:', bodyText.slice(0, 200));

    await ctx.close();

    // ── Step 5: Follow magic link ─────────────────────────────────────────────
    log('\nEmail sent to', email);
    log('Check your inbox for a magic link from hCaptcha/Intuition Machines.');
    log('The link looks like: https://accounts.hcaptcha.com/accessibility/login?token=...\n');

    const magicLink = await prompt('Paste the magic link URL here: ');
    if (!magicLink.includes(MAGIC_LINK_BASE)) {
      throw new Error('Invalid magic link — should start with ' + MAGIC_LINK_BASE);
    }

    // ── Step 6: Follow magic link in fresh browser context, extract cookie ────
    log('Following magic link...');
    const ctx2 = await browser.newContext({ userAgent: UA, locale: 'en-US' });
    const page2 = await ctx2.newPage();
    await page2.goto(magicLink, { waitUntil: 'networkidle', timeout: 15000 });
    await page2.waitForTimeout(2000);

    // Extract hc_accessibility cookie from .hcaptcha.com
    const cookies = await ctx2.cookies('https://accounts.hcaptcha.com');
    const a11yCookie = cookies.find(c => c.name === 'hc_accessibility');

    if (!a11yCookie) {
      // Try broader domain
      const allCookies = await ctx2.cookies();
      log('All cookies after magic link:', allCookies.map(c => c.name).join(', '));
      throw new Error('hc_accessibility cookie not found after following magic link');
    }

    log('Got hc_accessibility cookie:', a11yCookie.value.slice(0, 20) + '...');
    await ctx2.close();

    // ── Step 7: Save to disk ──────────────────────────────────────────────────
    save(a11yCookie.value);
    log('Cookie saved. Fast-path bypass is now active.');
    return a11yCookie.value;

  } finally {
    await browser.close().catch(() => {});
  }
}

/**
 * Follow only the magic link (skip signup). Use when you already got the
 * email but want to run just Step 6 (e.g. re-running after a timeout).
 */
async function followMagicLink(magicLink, opts = {}) {
  if (!magicLink.includes(MAGIC_LINK_BASE)) {
    throw new Error('Invalid magic link — should start with ' + MAGIC_LINK_BASE);
  }

  const log = (...args) => { if (opts.debug !== false) console.log('[a11y-register]', ...args); };
  const launchOpts = {
    headless: opts.headless !== false,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  };
  if (opts.proxy) launchOpts.proxy = { server: opts.proxy };

  const browser = await chromium.launch(launchOpts);
  try {
    const ctx = await browser.newContext({ userAgent: UA, locale: 'en-US' });
    const page = await ctx.newPage();
    log('Following magic link:', magicLink.slice(0, 80) + '...');
    await page.goto(magicLink, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(2000);

    const cookies = await ctx.cookies('https://accounts.hcaptcha.com');
    const a11yCookie = cookies.find(c => c.name === 'hc_accessibility');

    if (!a11yCookie) {
      const allCookies = await ctx.cookies();
      log('All cookies:', allCookies.map(c => c.name).join(', '));
      throw new Error('hc_accessibility cookie not found');
    }

    await ctx.close();
    save(a11yCookie.value);
    log('Cookie saved:', a11yCookie.value.slice(0, 20) + '...');
    return a11yCookie.value;
  } finally {
    await browser.close().catch(() => {});
  }
}

module.exports = { register, followMagicLink };
