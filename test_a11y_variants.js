'use strict';

const { solvePoW } = require('./src/pow');
const { generateMotionData } = require('./src/motion');

const SITEKEY = 'a9b5fb07-92ff-493f-86fe-352a2803b3df';
const HOST = 'discord.com';
const VERSION = 'f4a6f30bb4f2f71cf58fd8dcd483138f9c494c52';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';

async function tryGetcaptcha(label, extraParams, extraHeaders) {
  console.log(`\n--- ${label} ---`);

  const configResp = await fetch(`https://hcaptcha.com/checksiteconfig?v=${VERSION}&host=${HOST}&sitekey=${SITEKEY}&sc=1&swa=1&spst=1`);
  const config = await configResp.json();
  const pow = await solvePoW(config.c.req, 'https://newassets.hcaptcha.com');

  const body = new URLSearchParams({
    v: VERSION,
    sitekey: SITEKEY,
    host: HOST,
    hl: 'en',
    motionData: generateMotionData(),
    n: pow,
    c: JSON.stringify(config.c),
    pdc: JSON.stringify({ s: Date.now(), n: 0, p: 0, gcs: 10 }),
    ...extraParams,
  });

  const resp = await fetch(`https://hcaptcha.com/getcaptcha/${SITEKEY}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': UA,
      'Origin': 'https://newassets.hcaptcha.com',
      'Referer': 'https://newassets.hcaptcha.com/',
      ...extraHeaders,
    },
    body: body.toString(),
  });

  const buf = Buffer.from(await resp.arrayBuffer());
  if (buf[0] === 0x7b) {
    const data = JSON.parse(buf.toString());
    console.log('  Keys:', Object.keys(data));
    if (data.generated_pass_UUID) console.log('  TOKEN:', data.generated_pass_UUID.slice(0, 40));
    if (data['error-codes']) console.log('  Errors:', data['error-codes']);
    if (data.success !== undefined) console.log('  Success:', data.success);
    if (data.request_type) console.log('  Request type:', data.request_type);
    if (data.tasklist) console.log('  Tasks:', data.tasklist.length, '- type:', data.request_type);
    if (data.requester_question) console.log('  Question:', JSON.stringify(data.requester_question));
    if (data.key) console.log('  Key:', data.key.slice(0, 30) + '...');
    if (data.pass) console.log('  PASS:', data.pass);
  } else {
    console.log('  Encrypted:', buf.length, 'bytes');
  }
}

async function main() {
  console.log('=== Testing A11y Variants ===');

  // Variant 1: a11y_tfe=true
  await tryGetcaptcha('a11y_tfe=true', { a11y_tfe: 'true' }, {});

  // Variant 2: accessibility=true
  await tryGetcaptcha('accessibility=true', { accessibility: 'true' }, {});

  // Variant 3: swa=1 (screen reader flag)
  await tryGetcaptcha('swa=1', { swa: '1' }, {});

  // Variant 4: both a11y_tfe and swa
  await tryGetcaptcha('a11y_tfe + swa=1', { a11y_tfe: 'true', swa: '1' }, {});

  // Variant 5: no extra params (baseline)
  await tryGetcaptcha('baseline (no a11y)', {}, {});

  // Variant 6: hasPst=true
  await tryGetcaptcha('hasPst=true', { hasPst: 'true' }, {});

  // Variant 7: action=challenge-accessibility  
  await tryGetcaptcha('action=challenge-accessibility', { action: 'challenge-accessibility' }, {});

  // Variant 8: cr=challenge-accessibility
  await tryGetcaptcha('cr=challenge-accessibility', { cr: 'challenge-accessibility' }, {});
}

main().catch(console.error);
