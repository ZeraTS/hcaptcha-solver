'use strict';

const { fetch } = require('undici');
const { HCaptchaClient, USER_AGENT } = require('./tls_client');
const { solvePoW } = require('./pow');
const { generateMotionData, generateAnswerMotionData } = require('./motion');
const { BrowserSession } = require('./browser_session');
const { AccessibilitySolver } = require('./accessibility_solver');
const cookieStore = require('./a11y_cookie_store');

const HCAPTCHA_API_DOMAIN = 'https://hcaptcha.com';
const ASSET_DOMAIN = 'https://newassets.hcaptcha.com';

let cachedVersion = null;

const CHROME_HEADERS = {
  'User-Agent': USER_AGENT,
  'Accept': 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="133", "Google Chrome";v="133"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-site',
};

async function getVersion() {
  if (cachedVersion) return cachedVersion;
  const resp = await fetch('https://js.hcaptcha.com/1/api.js', {
    headers: { 'User-Agent': USER_AGENT, 'Accept': '*/*', 'Referer': 'https://hcaptcha.com/' }
  });
  const text = await resp.text();
  const match = text.match(/captcha\/v1\/([a-f0-9]+)/);
  if (!match) throw new Error('Could not extract hCaptcha version from api.js');
  cachedVersion = match[1];
  return cachedVersion;
}

async function checkSiteConfig(sitekey, host, version) {
  const url = `${HCAPTCHA_API_DOMAIN}/checksiteconfig?v=${version}&host=${host}&sitekey=${sitekey}&sc=1&swa=1&spst=0`;
  const resp = await fetch(url, {
    headers: { ...CHROME_HEADERS, 'Origin': `https://${host}`, 'Referer': `https://${host}/` }
  });
  if (!resp.ok) throw new Error(`checksiteconfig failed: ${resp.status}`);
  return resp.json();
}

async function getCaptcha(client, sitekey, host, version, powProof, challengeSpec, motionData) {
  const url = `${HCAPTCHA_API_DOMAIN}/getcaptcha/${sitekey}`;
  const body = new URLSearchParams({
    v: version, sitekey, host, hl: 'en', motionData,
    n: powProof || '',
    c: JSON.stringify(challengeSpec),
    pdc: JSON.stringify({ s: Date.now(), n: 0, p: 0, gcs: 10 }),
  });
  const headers = { ...CHROME_HEADERS, 'Origin': `https://${host}`, 'Referer': `https://${host}/` };
  const r = await client.post(url, body.toString(), headers);
  if (r.error) throw new Error(`getcaptcha sidecar error: ${r.error}`);
  if (r.status >= 400) throw new Error(`getcaptcha failed: ${r.status}`);
  return JSON.parse(r.body || '{}');
}

async function checkCaptcha(client, sitekey, host, version, sessionKey, answers, motionData, challengeSpec, powProof) {
  const url = `${HCAPTCHA_API_DOMAIN}/checkcaptcha/${sitekey}/${sessionKey}`;
  const bodyObj = {
    v: version, sitekey,
    c: JSON.stringify(challengeSpec),
    job_mode: challengeSpec.type || 'image_label_binary',
    host, answers, motionData,
    n: powProof || '',
    pdc: { s: Date.now(), n: 0, p: 0, gcs: 10 },
  };
  const headers = { ...CHROME_HEADERS, 'Origin': `https://${host}`, 'Referer': `https://${host}/` };
  const r = await client.postJson(url, bodyObj, headers);
  if (r.error) throw new Error(`checkcaptcha sidecar error: ${r.error}`);
  if (r.status >= 400) throw new Error(`checkcaptcha failed: ${r.status}`);
  return JSON.parse(r.body || '{}');
}

class HCaptchaSolver {
  constructor(options = {}) {
    this.sitekey = options.sitekey || '4c672d35-0701-42b2-88c3-78380b0db560';
    this.host = options.host || 'accounts.hcaptcha.com';
    this.timeout = options.timeout || 90000;
    this.debug = options.debug || false;
    this.proxy = options.proxy || '';
    // Cookie priority: explicit option > env var > disk store
    this.accessibilityCookie = options.accessibilityCookie
      || process.env.HC_ACCESSIBILITY_COOKIE
      || cookieStore.load()
      || '';
    this.client = new HCaptchaClient({ proxy: this.proxy });
    this._browser = null;
    this._a11ySolver = null;
    if (this.accessibilityCookie) {
      this.log('Accessibility cookie loaded — fast-path active');
    }
  }

  log(...args) {
    if (this.debug) console.log('[hcaptcha]', ...args);
  }

  close() {
    this.client.stop();
    if (this._browser) { this._browser.close().catch(() => {}); this._browser = null; }
  }

  /**
   * Solve hCaptcha for a given sitekey + host.
   *
   * Strategy:
   *   1. Try pure-HTTP path (fast, works for test sitekey and any non-enc_get_req sitekey)
   *   2. If getcaptcha returns client-fail or enc_get_req, fall back to browser path
   *   3. Browser handles PoW + fingerprint + enc_get_req encryption
   *   4. If browser gets image challenge, extract images and classify with vision AI
   *
   * Returns: { token: string, elapsed: number, type: string }
   */
  async solve(sitekey, host) {
    const startTime = Date.now();
    const sk = sitekey || this.sitekey;
    const h = host || this.host;

    // Priority 1: Accessibility cookie bypass (pure HTTP, fastest)
    if (this.accessibilityCookie) {
      this.log('Trying accessibility cookie bypass...');
      try {
        if (!this._a11ySolver) {
          this._a11ySolver = new AccessibilitySolver({
            accessibilityCookie: this.accessibilityCookie,
            debug: this.debug,
          });
        }
        const result = await this._a11ySolver.solve(sk, h);
        this.log('Accessibility bypass succeeded in', result.elapsed + 'ms');
        return result;
      } catch (err) {
        this.log('Accessibility bypass failed:', err.message);
        // If cookie is invalid/expired, clear it from disk so next startup re-registers
        if (/invalid|expired|rejected|encrypted response/i.test(err.message)) {
          this.log('Clearing stale cookie from disk');
          cookieStore.clear();
          this.accessibilityCookie = '';
        }
        this.log('Falling back to standard path...');
      }
    }

    // Priority 2: Standard path
    this.log('Fetching version...');
    const version = await getVersion();
    this.log('Version:', version);

    this.log('Checking site config...');
    const siteConfig = await checkSiteConfig(sk, h, version);
    this.log('Site config:', JSON.stringify(siteConfig).slice(0, 150));

    if (!siteConfig.pass) throw new Error(`Site config failed: ${JSON.stringify(siteConfig)}`);

    const hasEncGetReq = siteConfig.features && siteConfig.features.enc_get_req;

    if (!hasEncGetReq) {
      this.log('Pure-HTTP path (no enc_get_req)');
      return this._solveHTTP(sk, h, version, siteConfig, startTime);
    }

    this.log('Browser path (enc_get_req=true)');
    return this._solveBrowser(sk, h, startTime);
  }

  async _solveHTTP(sk, h, version, siteConfig, startTime) {
    const configChallenge = siteConfig.c;
    let configPowProof = null;

    if (configChallenge && configChallenge.req) {
      this.log('Solving config PoW...');
      configPowProof = await solvePoW(configChallenge.req, ASSET_DOMAIN);
      this.log('Config PoW solved');
    }

    const motionData1 = generateMotionData();
    const captchaData = await getCaptcha(
      this.client, sk, h, version,
      configPowProof, configChallenge || {}, motionData1
    );
    this.log('Captcha data:', JSON.stringify(captchaData).slice(0, 200));

    if (captchaData.generated_pass_UUID) {
      return { token: captchaData.generated_pass_UUID, elapsed: Date.now() - startTime, type: 'immediate' };
    }

    const captchaChallenge = captchaData.c;
    if (!captchaChallenge || !captchaChallenge.req) {
      // Client-fail or enc_get_req response — escalate to browser
      this.log('HTTP path got non-standard response, falling back to browser');
      return this._solveBrowser(sk, h, startTime);
    }

    this.log('Solving captcha PoW...');
    const captchaPowProof = await solvePoW(captchaChallenge.req, ASSET_DOMAIN);

    const sessionKey = captchaData.key;
    const taskList = captchaData.tasklist || [];
    const jobMode = captchaData.request_type || 'image_label_binary';

    if (!sessionKey) throw new Error(`No session key: ${JSON.stringify(captchaData).slice(0, 200)}`);

    this.log(`${taskList.length} tasks, type: ${jobMode}`);

    // Default answers — browser path handles vision via CLIP
    let answers = {};
    for (const t of taskList) if (t.task_key) answers[t.task_key] = 'true';

    const motionData2 = generateAnswerMotionData(taskList.length);
    const checkData = await checkCaptcha(
      this.client, sk, h, version,
      sessionKey, answers, motionData2,
      captchaChallenge, captchaPowProof
    );
    this.log('Check result:', JSON.stringify(checkData).slice(0, 150));

    if (checkData.generated_pass_UUID) {
      return { token: checkData.generated_pass_UUID, elapsed: Date.now() - startTime, type: 'image_solved' };
    }
    if (checkData.pass === false) throw new Error(`Captcha failed: ${JSON.stringify(checkData)}`);
    throw new Error(`Unexpected: ${JSON.stringify(checkData).slice(0, 200)}`);
  }

  async _solveBrowser(sk, h, startTime) {
    if (!this._browser) {
      this._browser = new BrowserSession({
        debug: this.debug,
        proxy: this.proxy,
      });
    }

    this.log('Starting browser session...');
    const result = await this._browser.solve(sk, h);

    if (result.token) {
      return { token: result.token, elapsed: Date.now() - startTime, type: result.type || 'browser_solved' };
    }

    throw new Error('Browser solve failed: no token returned. Set ANTHROPIC_API_KEY for vision-based challenge solving.');
  }
}

module.exports = { HCaptchaSolver, getVersion, checkSiteConfig, getCaptcha, checkCaptcha };
