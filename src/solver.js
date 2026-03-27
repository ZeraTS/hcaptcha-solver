'use strict';

const { fetch } = require('undici');
const { solvePoW } = require('./pow');
const { generateMotionData, generateAnswerMotionData } = require('./motion');

// hCaptcha API constants
const HCAPTCHA_API_DOMAIN = 'https://hcaptcha.com';
const ASSET_DOMAIN = 'https://newassets.hcaptcha.com';

// Current hCaptcha widget version — fetched dynamically or cached
let cachedVersion = null;

const CHROME_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-site',
};

/**
 * Fetches the current hCaptcha widget version from api.js
 */
async function getVersion() {
  if (cachedVersion) return cachedVersion;

  const resp = await fetch('https://js.hcaptcha.com/1/api.js', {
    headers: {
      'User-Agent': CHROME_HEADERS['User-Agent'],
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
 */
async function checkSiteConfig(sitekey, host, version) {
  const url = `${HCAPTCHA_API_DOMAIN}/checksiteconfig/v1/${version}?host=${host}&sitekey=${sitekey}&sc=1&swa=1&spst=1`;

  const resp = await fetch(url, {
    headers: {
      ...CHROME_HEADERS,
      'Origin': `https://${host}`,
      'Referer': `https://${host}/`,
    }
  });

  if (!resp.ok) {
    throw new Error(`checksiteconfig failed: ${resp.status}`);
  }

  return resp.json();
}

/**
 * Step 2: POST to getcaptcha
 */
async function getCaptcha(sitekey, host, version, powProof, challengeSpec, motionData) {
  const url = `${HCAPTCHA_API_DOMAIN}/getcaptcha/v1/${version}`;

  const body = new URLSearchParams({
    v: version,
    sitekey,
    host,
    hl: 'en',
    motionData,
    n: powProof,
    c: JSON.stringify(challengeSpec),
    pdc: JSON.stringify({ s: Date.now(), d: 0, p: 0 }),
    ts: String(Date.now()),
  });

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      ...CHROME_HEADERS,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Origin': `https://${host}`,
      'Referer': `https://${host}/`,
    },
    body: body.toString(),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`getcaptcha failed: ${resp.status} - ${text.slice(0, 200)}`);
  }

  return resp.json();
}

/**
 * Step 3: POST to checkcaptcha with answers
 */
async function checkCaptcha(sitekey, host, version, sessionKey, answers, motionData, challengeSpec) {
  const url = `${HCAPTCHA_API_DOMAIN}/checkcaptcha/v1/${version}/${sessionKey}`;

  const body = JSON.stringify({
    v: version,
    sitekey,
    c: JSON.stringify(challengeSpec),
    host,
    answers,
    motionData,
    n: null,
    pdc: { s: Date.now(), d: 0, p: 0 },
  });

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      ...CHROME_HEADERS,
      'Content-Type': 'application/json',
      'Origin': `https://${host}`,
      'Referer': `https://${host}/`,
    },
    body,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`checkcaptcha failed: ${resp.status} - ${text.slice(0, 200)}`);
  }

  return resp.json();
}

/**
 * Builds the answers object for image tasks
 * Uses 'true' for all tasks (random pass attempt) or generates plausible answers
 */
function buildAnswers(taskList, mode) {
  const answers = {};

  if (!taskList || taskList.length === 0) {
    return answers;
  }

  for (const task of taskList) {
    if (task.task_key) {
      // For binary image tasks, answer 'true' or 'false'
      // Using 'true' for all as a pass attempt on easy tasks
      answers[task.task_key] = 'true';
    }
  }

  return answers;
}

class HCaptchaSolver {
  constructor(options = {}) {
    this.sitekey = options.sitekey || '4c672d35-0701-42b2-88c3-78380b0db560';
    this.host = options.host || 'democaptcha.com';
    this.timeout = options.timeout || 60000;
    this.debug = options.debug || false;
  }

  log(...args) {
    if (this.debug) {
      console.log('[hcaptcha]', ...args);
    }
  }

  /**
   * Main solve function
   * Returns the P0_... or P1_... token string
   */
  async solve() {
    const startTime = Date.now();

    // Get widget version
    this.log('Fetching widget version...');
    const version = await getVersion();
    this.log('Version:', version);

    // Step 1: checksiteconfig
    this.log('Checking site config...');
    const siteConfig = await checkSiteConfig(this.sitekey, this.host, version);
    this.log('Site config:', JSON.stringify(siteConfig).slice(0, 200));

    if (!siteConfig.pass) {
      throw new Error(`Site config check failed: ${JSON.stringify(siteConfig)}`);
    }

    const challengeSpec = siteConfig.c;
    if (!challengeSpec || !challengeSpec.req) {
      throw new Error(`No challenge spec in site config: ${JSON.stringify(siteConfig)}`);
    }

    // Step 2: Solve PoW
    this.log('Solving PoW challenge...');
    const powProof = await solvePoW(challengeSpec.req, ASSET_DOMAIN);
    this.log('PoW proof:', powProof ? powProof.slice(0, 80) + '...' : 'null');

    // Step 3: getcaptcha
    this.log('Fetching captcha challenge...');
    const motionData1 = generateMotionData();
    const captchaData = await getCaptcha(
      this.sitekey, this.host, version,
      powProof, challengeSpec, motionData1
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

    // Step 4: Answer image challenge
    const sessionKey = captchaData.key;
    const taskList = captchaData.tasklist || [];
    const jobMode = captchaData.request_type || 'image_label_binary';

    if (!sessionKey) {
      throw new Error(`No session key in captcha response: ${JSON.stringify(captchaData).slice(0, 200)}`);
    }

    this.log(`Got ${taskList.length} tasks, type: ${jobMode}`);

    // Build answers
    const answers = buildAnswers(taskList, jobMode);
    this.log('Answers:', JSON.stringify(answers).slice(0, 100));

    // Step 5: checkcaptcha
    this.log('Submitting answers...');
    const motionData2 = generateAnswerMotionData(taskList.length);

    const checkData = await checkCaptcha(
      this.sitekey, this.host, version,
      sessionKey, answers, motionData2,
      challengeSpec
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
