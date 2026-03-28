'use strict';

const { solvePoW } = require('./src/pow');
const { generateMotionData } = require('./src/motion');

const SITEKEY = 'a9b5fb07-92ff-493f-86fe-352a2803b3df';
const HOST = 'discord.com';
const VERSION = 'f4a6f30bb4f2f71cf58fd8dcd483138f9c494c52';

async function main() {
  console.log('=== Raw HTTP Flow — No Browser, No Cookie ===\n');

  // Step 1: checksiteconfig
  const configResp = await fetch(`https://hcaptcha.com/checksiteconfig?v=${VERSION}&host=${HOST}&sitekey=${SITEKEY}&sc=1&swa=1&spst=1`);
  const config = await configResp.json();
  console.log('Features:', JSON.stringify(config.features));

  // Step 2: Solve PoW
  const pow1 = await solvePoW(config.c.req, 'https://newassets.hcaptcha.com');
  console.log('PoW1 solved');

  // Step 3: getcaptcha
  const body1 = new URLSearchParams({
    v: VERSION, sitekey: SITEKEY, host: HOST, hl: 'en',
    motionData: generateMotionData(),
    n: pow1,
    c: JSON.stringify(config.c),
    pdc: JSON.stringify({ s: Date.now(), n: 0, p: 0, gcs: 10 }),
  });

  const resp1 = await fetch(`https://hcaptcha.com/getcaptcha/${SITEKEY}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
      'Origin': 'https://newassets.hcaptcha.com',
      'Referer': 'https://newassets.hcaptcha.com/',
    },
    body: body1.toString(),
  });

  const buf1 = Buffer.from(await resp1.arrayBuffer());
  const data1 = JSON.parse(buf1.toString());
  
  console.log('\ngetcaptcha response:');
  console.log('  Keys:', Object.keys(data1));
  console.log('  success:', data1.success);
  console.log('  error-codes:', data1['error-codes']);
  
  if (data1.generated_pass_UUID) {
    console.log('  AUTO PASS:', data1.generated_pass_UUID.slice(0, 50));
    return;
  }

  if (data1.tasklist) {
    console.log('  request_type:', data1.request_type);
    console.log('  tasks:', data1.tasklist.length);
    console.log('  question:', JSON.stringify(data1.requester_question));
    console.log('  key:', data1.key?.slice(0, 40));
    for (let i = 0; i < Math.min(3, data1.tasklist.length); i++) {
      console.log(`  task[${i}]:`, JSON.stringify(data1.tasklist[i]).slice(0, 150));
    }
  }

  if (!data1.key && !data1.tasklist && data1.c) {
    // Got a new PoW challenge back — means we need to solve again and resubmit
    console.log('  Got new PoW challenge (no tasks yet)');
    console.log('  Solving PoW2...');
    const pow2 = await solvePoW(data1.c.req, 'https://newassets.hcaptcha.com');
    console.log('  PoW2 solved');

    // Try getcaptcha again with pow2
    const body2 = new URLSearchParams({
      v: VERSION, sitekey: SITEKEY, host: HOST, hl: 'en',
      motionData: generateMotionData(),
      n: pow2,
      c: JSON.stringify(data1.c),
      pdc: JSON.stringify({ s: Date.now(), n: 0, p: 0, gcs: 10 }),
    });

    const resp2 = await fetch(`https://hcaptcha.com/getcaptcha/${SITEKEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
        'Origin': 'https://newassets.hcaptcha.com',
        'Referer': 'https://newassets.hcaptcha.com/',
      },
      body: body2.toString(),
    });

    const buf2 = Buffer.from(await resp2.arrayBuffer());
    console.log('\n  2nd getcaptcha:');
    console.log('    Is JSON:', buf2[0] === 0x7b);
    console.log('    Length:', buf2.length);
    if (buf2[0] === 0x7b) {
      const data2 = JSON.parse(buf2.toString());
      console.log('    Keys:', Object.keys(data2));
      console.log('    success:', data2.success);
      if (data2.tasklist) {
        console.log('    request_type:', data2.request_type);
        console.log('    tasks:', data2.tasklist.length);
        console.log('    question:', JSON.stringify(data2.requester_question));
        console.log('    key:', data2.key?.slice(0, 40));
        for (let i = 0; i < Math.min(3, data2.tasklist.length); i++) {
          console.log(`    task[${i}]:`, JSON.stringify(data2.tasklist[i]).slice(0, 200));
        }
      }
      if (data2.generated_pass_UUID) {
        console.log('    AUTO PASS:', data2.generated_pass_UUID.slice(0, 50));
      }
    } else {
      console.log('    Encrypted:', buf2.length, 'bytes');
      console.log('    First 32 hex:', buf2.slice(0, 32).toString('hex'));
    }
  }
}

main().catch(console.error);
