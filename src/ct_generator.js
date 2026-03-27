'use strict';

const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// Apply stealth plugin — only do this once
let stealthApplied = false;
if (!stealthApplied) {
  chromium.use(StealthPlugin());
  stealthApplied = true;
}

class HCaptchaSessionGenerator {
  constructor(opts = {}) {
    this.browser = null;
    this.debug = opts.debug || false;
    this.timeout = opts.timeout || 30000;
  }

  log(...args) {
    if (this.debug) console.log('[ct_generator]', ...args);
  }

  async initialize() {
    if (this.browser) return;
    this.log('Launching browser...');
    this.browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-blink-features=AutomationControlled',
      ],
    });
    this.log('Browser launched.');
  }

  /**
   * Generate a real browser session for the given host/sitekey.
   * Returns: { cookies: [...], version: string }
   */
  async generateSession(sitekey, host, opts = {}) {
    await this.initialize();

    const proxy = opts.proxy;
    const ctxOpts = {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
      viewport: { width: 1366, height: 768 },
      locale: 'en-US',
      timezoneId: 'America/New_York',
    };
    if (proxy) ctxOpts.proxy = { server: proxy, bypass: '127.0.0.1,localhost' };

    const ctx = await this.browser.newContext(ctxOpts);
    const page = await ctx.newPage();

    let capturedVersion = null;

    // Intercept hCaptcha API calls to get version
    page.on('response', async resp => {
      try {
        const url = resp.url();
        if (url.includes('hcaptcha.com/checksiteconfig')) {
          const m = url.match(/v=([a-f0-9]+)/);
          if (m) {
            capturedVersion = m[1];
            this.log('Captured version from checksiteconfig:', capturedVersion);
          }
        }
      } catch (e) {}
    });

    // Navigate to the target host to establish cookies
    this.log(`Navigating to https://${host}/`);
    try {
      await page.goto(`https://${host}/`, {
        waitUntil: 'domcontentloaded',
        timeout: this.timeout,
      });
      await page.waitForTimeout(3000);
    } catch (e) {
      this.log('Navigation error (acceptable):', e.message.slice(0, 100));
    }

    const capturedCookies = await ctx.cookies();
    this.log(`Captured ${capturedCookies.length} cookies from ${host}`);
    await ctx.close();

    // Get version via fetch if not captured from intercepted requests
    if (!capturedVersion) {
      this.log('Version not captured from network — fetching from api.js');
      try {
        const { fetch } = require('undici');
        const r = await fetch('https://js.hcaptcha.com/1/api.js', {
          headers: { 'User-Agent': ctxOpts.userAgent },
        });
        const txt = await r.text();
        const m = txt.match(/captcha\/v1\/([a-f0-9]+)/);
        if (m) {
          capturedVersion = m[1];
          this.log('Fetched version from api.js:', capturedVersion);
        }
      } catch (e) {
        this.log('Failed to fetch version from api.js:', e.message);
      }
    }

    return { cookies: capturedCookies, version: capturedVersion };
  }

  async close() {
    if (this.browser) {
      this.log('Closing browser...');
      await this.browser.close();
      this.browser = null;
    }
  }
}

module.exports = { HCaptchaSessionGenerator };
