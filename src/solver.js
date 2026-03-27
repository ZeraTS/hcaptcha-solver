'use strict';

const { fetch } = require('undici');
const { HCaptchaClient, USER_AGENT } = require('./tls_client');
const { solvePoW } = require('./pow');
const { generateMotionData, generateAnswerMotionData } = require('./motion');

// hCaptcha API constants
const HCAPTCHA_API_DOMAIN = 'https://hcaptcha.com';
const ASSET_DOMAIN = 'https://newassets.hcaptcha.com';

// Current hCaptcha widget version — fetched dynamically or cached
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

/**
 * Fetches the current hCaptcha widget version from api.js
 * Uses undici fetch — low-risk CDN call
 */
async function getVersion() {
  if (cachedVersion) return cachedVersion;

  const resp = await fetch('https://js.hcaptcha.com/1/api.js', {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': '*/*',
      'Referer': 'https://hcaptcha.com/',
    }
  });

  const text = await resp.text();
  const match = text.match(/captcha\/v1\/([a-f0-9]+)/);
  if (!match) throw new Error('Could not extract hCaptcha version from api.js');

  cachedVersion = match[1];
  return cachedVersion;
}

/**
 * Step 1: Fetch site config and PoW challenge
 * Uses undici fetch — low-risk CDN call
 * URL: GET https://hcaptcha.com/checksiteconfig?v={version}&host={host}&sitekey={sitekey}&sc=1&swa=1&spst=0
 */
async function checkSiteConfig(sitekey, host, version) {
  const url = `${HCAPTCHA_API_DOMAIN}/checksiteconfig?v=${version}&host=${host}&sitekey=${sitekey}&sc=1&swa=1&spst=0`;

  const resp = await fetch(url, {
    headers: {
      ...CHROME_HEADERS,
      'Origin': `https://${host}`,
      'Referer': `https://${host}/`,
    }
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`checksiteconfig failed: ${resp.status} - ${text.slice(0, 200)}`);
  }

  return resp.json();
}

/**
 * Step 2: POST to getcaptcha via TLS client
 * URL: POST https://hcaptcha.com/getcaptcha/{sitekey}
 * Body (form-encoded): v=...&sitekey=...&host=...&hl=en&motionData=...&pdc=...&n={pow_token}&c={challenge_json}
 */
async function getCaptcha(client, sitekey, host, version, powProof, challengeSpec, motionData) {
  const url = `${HCAPTCHA_API_DOMAIN}/getcaptcha/${sitekey}`;

  const body = new URLSearchParams({
    v: version,
    sitekey,
    host,
    hl: 'en',
    motionData,
    n: powProof || '',
    c: JSON.stringify(challengeSpec),
    pdc: JSON.stringify({ s: Date.now(), n: 0, p: 0, gcs: 10 }),
  });

  const headers = {
    ...CHROME_HEADERS,
    'Origin': `https://${host}`,
    'Referer': `https://${host}/`,
  };

  const r = await client.post(url, body.toString(), headers);

  if (r.error) {
    throw new Error(`getcaptcha sidecar error: ${r.error}`);
  }
  if (r.status && r.status >= 400) {
    const text = r.body || '';
    throw new Error(`getcaptcha failed: ${r.status} - ${text.slice(0, 200)}`);
  }

  const text = r.body || '';
  return JSON.parse(text);
}

/**
 * Step 3: POST to checkcaptcha with answers via TLS client
 * URL: POST https://hcaptcha.com/checkcaptcha/{sitekey}/{key}
 * Body (JSON): {answers, c, n, ...}
 */
async function checkCaptcha(client, sitekey, host, version, sessionKey, answers, motionData, challengeSpec, powProof) {
  const url = `${HCAPTCHA_API_DOMAIN}/checkcaptcha/${sitekey}/${sessionKey}`;

  const bodyObj = {
    v: version,
    sitekey,
    c: JSON.stringify(challengeSpec),
    job_mode: challengeSpec.type || 'image_label_binary',
    host,
    answers,
    motionData,
    n: powProof || '',
    pdc: { s: Date.now(), n: 0, p: 0, gcs: 10 },
  };

  const headers = {
    ...CHROME_HEADERS,
    'Origin': `https://${host}`,
    'Referer': `https://${host}/`,
  };

  const r = await client.postJson(url, bodyObj, headers);

  if (r.error) {
    throw new Error(`checkcaptcha sidecar error: ${r.error}`);
  }
  if (r.status && r.status >= 400) {
    const text = r.body || '';
    throw new Error(`checkcaptcha failed: ${r.status} - ${text.slice(0, 200)}`);
  }

  const text = r.body || '';
  return JSON.parse(text);
}

/**
 * Builds the answers object for image tasks
 * Uses 'true' for all tasks (random pass attempt — placeholder for real image solving)
 */
function buildAnswers(taskList) {
  const answers = {};
  if (!taskList || taskList.length === 0) return answers;
  for (const task of taskList) {
    if (task.task_key) {
      answers[task.task_key] = 'true';
    }
  }
  return answers;
}

class HCaptchaSolver {
  constructor(options = {}) {
    this.sitekey = options.sitekey || '4c672d35-0701-42b2-88c3-78380b0db560';
    this.host = options.host || 'accounts.hcaptcha.com';
    this.timeout = options.timeout || 60000;
    this.debug = options.debug || false;
    this.proxy = options.proxy || '';
    this.client = new HCaptchaClient({ proxy: this.proxy });
  }

  log(...args) {
    if (this.debug) {
      console.log('[hcaptcha]', ...args);
    }
  }

  close() {
    this.client.stop();
  }

  /**
   * Main solve function
   * @param {string} sitekey - Override sitekey (optional)
   * @param {string} host - Override host (optional)
   * Returns the P1_... or P2_... token string
   */
  async solve(sitekey, host) {
    const startTime = Date.now();
    const sk = sitekey || this.sitekey;
    const h = host || this.host;

    // Get widget version
    this.log('Fetching widget version...');
    const version = await getVersion();
    this.log('Version:', version);

    // Step 1: checksiteconfig — get PoW challenge (undici, low-risk CDN)
    this.log('Checking site config...');
    const siteConfig = await checkSiteConfig(sk, h, version);
    this.log('Site config:', JSON.stringify(siteConfig).slice(0, 200));

    if (!siteConfig.pass) {
      throw new Error(`Site config check failed: ${JSON.stringify(siteConfig)}`);
    }

    const configChallenge = siteConfig.c;
    let configPowProof = null;

    if (configChallenge && configChallenge.req) {
      // Solve PoW from checksiteconfig
      this.log('Solving config PoW challenge...');
      configPowProof = await solvePoW(configChallenge.req, ASSET_DOMAIN);
      this.log('Config PoW proof:', configPowProof ? configPowProof.slice(0, 80) + '...' : 'null');
    } else {
      this.log('No PoW challenge in site config (pre-approved or test key) — skipping PoW');
    }

    // Step 2: getcaptcha — submit PoW proof, get challenge or immediate pass (TLS client)
    this.log('Fetching captcha challenge...');
    const motionData1 = generateMotionData();
    const captchaData = await getCaptcha(
      this.client, sk, h, version,
      configPowProof, configChallenge || {}, motionData1
    );
    this.log('Captcha data:', JSON.stringify(captchaData).slice(0, 300));

    // Check for immediate pass (no image challenge needed)
    if (captchaData.generated_pass_UUID) {
      this.log('Got immediate pass token!');
      return {
        token: captchaData.generated_pass_UUID,
        elapsed: Date.now() - startTime,
        type: 'immediate',
      };
    }

    // getcaptcha returns a NEW PoW challenge for checkcaptcha
    const captchaChallenge = captchaData.c;
    if (!captchaChallenge || !captchaChallenge.req) {
      throw new Error(`No challenge spec in getcaptcha response: ${JSON.stringify(captchaData).slice(0, 200)}`);
    }

    // Solve the new PoW challenge from getcaptcha
    this.log('Solving captcha PoW challenge...');
    const captchaPowProof = await solvePoW(captchaChallenge.req, ASSET_DOMAIN);
    this.log('Captcha PoW proof:', captchaPowProof ? captchaPowProof.slice(0, 80) + '...' : 'null');

    // Answer image challenge
    const sessionKey = captchaData.key;
    const taskList = captchaData.tasklist || [];
    const jobMode = captchaData.request_type || 'image_label_binary';

    if (!sessionKey) {
      throw new Error(`No session key in captcha response: ${JSON.stringify(captchaData).slice(0, 200)}`);
    }

    this.log(`Got ${taskList.length} tasks, type: ${jobMode}`);

    // Build answers (answer 'true' to all — placeholder for real image solving)
    const answers = buildAnswers(taskList);
    this.log('Answers:', JSON.stringify(answers).slice(0, 100));

    // Step 3: checkcaptcha — submit answers with new PoW proof (TLS client)
    this.log('Submitting answers...');
    const motionData2 = generateAnswerMotionData(taskList.length);

    const checkData = await checkCaptcha(
      this.client, sk, h, version,
      sessionKey, answers, motionData2,
      captchaChallenge, captchaPowProof
    );
    this.log('Check result:', JSON.stringify(checkData).slice(0, 200));

    if (checkData.generated_pass_UUID) {
      return {
        token: checkData.generated_pass_UUID,
        elapsed: Date.now() - startTime,
        type: 'image_solved',
      };
    }

    if (checkData.pass === false) {
      throw new Error(`Captcha failed: ${JSON.stringify(checkData)}`);
    }

    throw new Error(`Unexpected response: ${JSON.stringify(checkData).slice(0, 200)}`);
  }
}

// Export for direct use
module.exports = { HCaptchaSolver, getVersion, checkSiteConfig, getCaptcha, checkCaptcha };
