// Full debug flow with proper c parameter
const https = require('https');
const crypto = require('crypto');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function decodeJWT(token) {
  const parts = token.split('.');
  const payload = parts[1];
  const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
}

function countLeadingZeroBits(buf) {
  let count = 0;
  for (const byte of buf) {
    for (let bit = 7; bit >= 0; bit--) {
      if ((byte >> bit) & 1) return count;
      count++;
    }
  }
  return count;
}

function solveHSW(d, s) {
  let nonce = 0;
  while (true) {
    const hash = crypto.createHash('sha256').update(d + ':' + nonce).digest();
    if (countLeadingZeroBits(hash) >= s) {
      return 'hsw:1:' + d + ':' + nonce;
    }
    nonce++;
  }
}

function httpsPost(hostname, path, body, headers) {
  return new Promise((resolve, reject) => {
    const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
    const opts = {
      hostname, path, method: 'POST',
      headers: {
        'User-Agent': USER_AGENT,
        'Content-Length': Buffer.byteLength(bodyStr),
        'Origin': 'https://assets.hcaptcha.com',
        'Referer': 'https://assets.hcaptcha.com/',
        ...headers
      }
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

async function main() {
  const sitekey = '4c672d35-0701-42b2-88c3-78380b0db560';
  const host = 'accounts.hcaptcha.com';
  const version = '1.10.4';

  // Step 1: checksiteconfig
  console.log('1. Calling checksiteconfig...');
  const configRes = await httpsPost(
    'hcaptcha.com',
    `/checksiteconfig?v=${version}&host=${host}&sitekey=${sitekey}&sc=1&swa=1`,
    '',
    { 'Content-Type': 'application/x-www-form-urlencoded' }
  );
  console.log('Config status:', configRes.status);
  const config = JSON.parse(configRes.body);
  console.log('Config:', JSON.stringify(config, null, 2));

  // Solve config PoW
  const configChallenge = decodeJWT(config.c.req);
  console.log('Config challenge:', configChallenge.n, 's:', configChallenge.s);
  const configAnswer = solveHSW(configChallenge.d, configChallenge.s);
  console.log('Config answer:', configAnswer.substring(0, 50) + '...');

  // Step 2: getcaptcha - pass c as the challenge object JSON
  console.log('\n2. Calling getcaptcha...');
  const st = Date.now();
  const motionData = {
    st, dct: st, mm: [], md: [], mu: [], v: 1,
    topLevel: { st, sc: {availWidth:1920, availHeight:1080}, nv: {userAgent: USER_AGENT, language: 'en-US', hardwareConcurrency: 8, maxTouchPoints: 0, vendor: 'Google Inc.'}, dr: '', exec: false, wn: [], xy: [], mm: [] },
    session: [], widgetList: ['0hnlmrl0mts'], widgetId: '0hnlmrl0mts',
    href: `https://${host}/`, prev: {escaped: false}
  };

  const params = new URLSearchParams({
    v: version, sitekey, host, hl: 'en',
    motionData: JSON.stringify(motionData),
    pdc: JSON.stringify({ s: Date.now(), n: 0, p: 0, gcs: 10 }),
    n: configAnswer,
    c: JSON.stringify(config.c)  // Pass the challenge object
  });

  const captchaRes = await httpsPost(
    'hcaptcha.com',
    `/getcaptcha/${sitekey}`,
    params.toString(),
    { 'Content-Type': 'application/x-www-form-urlencoded' }
  );
  console.log('Captcha status:', captchaRes.status);
  console.log('Captcha response:', captchaRes.body.substring(0, 500));

  let captchaData;
  try {
    captchaData = JSON.parse(captchaRes.body);
  } catch(e) {
    console.error('Failed to parse captcha response:', captchaRes.body);
    return;
  }

  if (captchaData.generated_pass_UUID) {
    console.log('SUCCESS (direct):', captchaData.generated_pass_UUID.substring(0, 30));
    return;
  }

  if (!captchaData.c || !captchaData.c.req) {
    console.log('No challenge in response');
    return;
  }

  // Step 3: Solve captcha PoW
  const captchaChallenge = decodeJWT(captchaData.c.req);
  console.log('\nCaptcha challenge:', captchaChallenge.n, 's:', captchaChallenge.s);
  const captchaAnswer = solveHSW(captchaChallenge.d, captchaChallenge.s);
  console.log('Captcha answer:', captchaAnswer.substring(0, 50) + '...');

  // Step 4: checkcaptcha
  console.log('\n3. Calling checkcaptcha...');
  const checkBody = {
    v: version,
    job_mode: 'hsl',
    answers: {},
    serverdomain: host,
    sitekey,
    motionData: JSON.stringify(motionData),
    n: captchaAnswer,
    c: JSON.stringify(captchaData.c)
  };

  // Try with version in query string
  const checkRes = await httpsPost(
    'hcaptcha.com',
    `/checkcaptcha/${sitekey}?v=${version}`,
    JSON.stringify(checkBody),
    { 'Content-Type': 'application/json' }
  );
  console.log('Check status:', checkRes.status);
  console.log('Check response:', checkRes.body.substring(0, 500));
}

main().catch(console.error);
