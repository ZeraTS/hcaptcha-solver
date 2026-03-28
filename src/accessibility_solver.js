'use strict';

/**
 * accessibility_solver.js — Pure HTTP hCaptcha bypass via accessibility cookie.
 *
 * Flow:
 *   1. checksiteconfig (with hc_accessibility cookie) → PoW JWT
 *   2. Solve PoW via VM (hsw.js)
 *   3. getcaptcha (with cookie) → immediate P1_ token (no image challenge)
 *
 * The accessibility cookie causes the server to auto-pass the user,
 * bypassing image/puzzle challenges entirely.
 *
 * Cookie must be obtained via https://dashboard.hcaptcha.com/signup?type=accessibility
 * and refreshed every ~24 hours via login.
 */

const { fetch } = require('undici');
const { solvePoW } = require('./pow');
const { generateMotionData } = require('./motion');

const HCAPTCHA_API = 'https://hcaptcha.com';
const ASSET_DOMAIN = 'https://newassets.hcaptcha.com';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';

const HEADERS = {
  'User-Agent': UA,
  'Accept': 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
  'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="133", "Google Chrome";v="133"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-site',
  'Origin': 'https://newassets.hcaptcha.com',
  'Referer': 'https://newassets.hcaptcha.com/',
};

let cachedVersion = null;

async function getVersion() {
  if (cachedVersion) return cachedVersion;
  const resp = await fetch('https://js.hcaptcha.com/1/api.js', {
    headers: { 'User-Agent': UA, 'Accept': '*/*' },
  });
  const text = await resp.text();
  const match = text.match(/captcha\/v1\/([a-f0-9]+)/);
  if (!match) throw new Error('Could not extract hCaptcha version');
  cachedVersion = match[1];
  return cachedVersion;
}

class AccessibilitySolver {
  constructor(opts = {}) {
    this.accessibilityCookie = opts.accessibilityCookie || process.env.HC_ACCESSIBILITY_COOKIE || '';
    this.debug = opts.debug || false;
  }

  log(...args) {
    if (this.debug) console.log('[a11y-solver]', ...args);
  }

  /**
   * Solve hCaptcha using the accessibility cookie bypass.
   *
   * @param {string} sitekey
   * @param {string} host
   * @returns {{ token: string, elapsed: number }}
   */
  async solve(sitekey, host) {
    if (!this.accessibilityCookie) {
      throw new Error('No accessibility cookie set. Set HC_ACCESSIBILITY_COOKIE env var or pass accessibilityCookie option.');
    }

    const startTime = Date.now();
    const cookieHeader = `hc_accessibility=${this.accessibilityCookie}`;

    // Step 1: Get version
    this.log('Fetching version...');
    const version = await getVersion();
    this.log('Version:', version);

    // Step 2: checksiteconfig
    this.log('Checking site config...');
    const configUrl = `${HCAPTCHA_API}/checksiteconfig?v=${version}&host=${host}&sitekey=${sitekey}&sc=1&swa=1&spst=1`;

    const configResp = await fetch(configUrl, {
      headers: {
        ...HEADERS,
        'Cookie': cookieHeader,
      },
    });

    if (!configResp.ok) {
      throw new Error(`checksiteconfig failed: ${configResp.status}`);
    }

    const siteConfig = await configResp.json();
    this.log('Site config:', JSON.stringify(siteConfig).slice(0, 200));

    if (!siteConfig.pass) {
      throw new Error(`Site config rejected: ${JSON.stringify(siteConfig)}`);
    }

    // Step 3: Solve PoW if present
    let powProof = '';
    if (siteConfig.c && siteConfig.c.req) {
      this.log('Solving PoW...');
      powProof = await solvePoW(siteConfig.c.req, ASSET_DOMAIN);
      this.log('PoW solved:', powProof ? powProof.slice(0, 40) + '...' : 'empty');
    }

    // Step 4: getcaptcha with accessibility cookie
    this.log('Calling getcaptcha with accessibility cookie...');
    const motionData = generateMotionData();

    const body = new URLSearchParams({
      v: version,
      sitekey,
      host,
      hl: 'en',
      motionData,
      n: powProof,
      c: JSON.stringify(siteConfig.c || {}),
      pdc: JSON.stringify({ s: Date.now(), n: 0, p: 0, gcs: 10 }),
    });

    const captchaResp = await fetch(`${HCAPTCHA_API}/getcaptcha/${sitekey}`, {
      method: 'POST',
      headers: {
        ...HEADERS,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': cookieHeader,
      },
      body: body.toString(),
    });

    if (!captchaResp.ok) {
      const errText = await captchaResp.text().catch(() => '');
      throw new Error(`getcaptcha failed: ${captchaResp.status} — ${errText.slice(0, 200)}`);
    }

    // Check if response is JSON (auto-pass) or binary (encrypted challenge)
    const contentType = captchaResp.headers.get('content-type') || '';
    const respBody = await captchaResp.arrayBuffer();
    const respBytes = Buffer.from(respBody);

    // JSON starts with '{' (0x7b)
    if (respBytes[0] === 0x7b) {
      const data = JSON.parse(respBytes.toString('utf8'));
      this.log('Response:', JSON.stringify(data).slice(0, 200));

      if (data.generated_pass_UUID) {
        const elapsed = Date.now() - startTime;
        this.log(`SUCCESS — token obtained in ${elapsed}ms`);
        return {
          token: data.generated_pass_UUID,
          elapsed,
          type: 'accessibility_bypass',
          expiration: data.expiration || 120,
        };
      }

      // Check for bypass message (rate limited or invalid cookie)
      if (data['bypass-message']) {
        throw new Error(`Accessibility bypass rejected: ${data['bypass-message']}`);
      }

      // Check for error codes
      if (data['error-codes']) {
        throw new Error(`hCaptcha error: ${data['error-codes'].join(', ')}`);
      }

      // Got a challenge instead of auto-pass — cookie may be invalid
      if (data.tasklist || data.request_type) {
        throw new Error('Got image challenge instead of auto-pass — accessibility cookie may be invalid or expired');
      }

      throw new Error(`Unexpected response: ${JSON.stringify(data).slice(0, 200)}`);
    }

    // Binary/encrypted response — the cookie didn't trigger auto-pass
    this.log('Got encrypted response (', respBytes.length, 'bytes) — cookie may not be working');
    throw new Error(`Got encrypted response (${respBytes.length} bytes) — accessibility cookie may be invalid or the site uses enc_get_req without a11y bypass`);
  }
}

module.exports = { AccessibilitySolver };
