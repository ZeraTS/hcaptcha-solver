'use strict';

const { solvePoW } = require('./src/pow');
const { generateMotionData, generateAnswerMotionData } = require('./src/motion');

const SITEKEY = 'a9b5fb07-92ff-493f-86fe-352a2803b3df';
const HOST = 'discord.com';
const VERSION = 'f4a6f30bb4f2f71cf58fd8dcd483138f9c494c52';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';

const HEADERS = {
  'Content-Type': 'application/x-www-form-urlencoded',
  'User-Agent': UA,
  'Origin': 'https://newassets.hcaptcha.com',
  'Referer': 'https://newassets.hcaptcha.com/',
  'Accept': 'application/json',
};

async function main() {
  console.log('=== A11y Challenge Flow Test ===\n');

  // Step 1: checksiteconfig
  console.log('Step 1: checksiteconfig');
  const configResp = await fetch(`https://hcaptcha.com/checksiteconfig?v=${VERSION}&host=${HOST}&sitekey=${SITEKEY}&sc=1&swa=1&spst=1`);
  const config = await configResp.json();
  console.log('  features:', JSON.stringify(config.features));
  console.log('  has a11y:', !!config.features?.a11y_challenge);

  // Step 2: Solve PoW
  console.log('\nStep 2: Solve PoW');
  const pow = await solvePoW(config.c.req, 'https://newassets.hcaptcha.com');
  console.log('  PoW solved:', pow.slice(0, 40) + '...');

  // Step 3: getcaptcha with a11y_tfe flag
  console.log('\nStep 3: getcaptcha with a11y_tfe=true');
  const body = new URLSearchParams({
    v: VERSION,
    sitekey: SITEKEY,
    host: HOST,
    hl: 'en',
    motionData: generateMotionData(),
    n: pow,
    c: JSON.stringify(config.c),
    pdc: JSON.stringify({ s: Date.now(), n: 0, p: 0, gcs: 10 }),
    a11y_tfe: 'true',
  });

  const captchaResp = await fetch(`https://hcaptcha.com/getcaptcha/${SITEKEY}`, {
    method: 'POST',
    headers: HEADERS,
    body: body.toString(),
  });

  const respBuf = Buffer.from(await captchaResp.arrayBuffer());
  console.log('  Status:', captchaResp.status);
  console.log('  Is JSON:', respBuf[0] === 0x7b);

  if (respBuf[0] === 0x7b) {
    const data = JSON.parse(respBuf.toString());
    console.log('\n  Full response keys:', Object.keys(data));

    if (data.generated_pass_UUID) {
      console.log('\n  AUTO-PASS TOKEN:', data.generated_pass_UUID.slice(0, 50));
      return;
    }

    if (data.tasklist) {
      console.log('\n  Got tasks:', data.tasklist.length);
      console.log('  Request type:', data.request_type);
      console.log('  Task sample:', JSON.stringify(data.tasklist[0]).slice(0, 200));
    }

    if (data.requester_question) {
      console.log('\n  Question:', JSON.stringify(data.requester_question));
    }

    if (data.key) {
      console.log('  Session key:', data.key.slice(0, 40) + '...');
    }

    // If we got a text challenge, try to answer it
    if (data.tasklist && data.c) {
      console.log('\nStep 4: Solve PoW for checkcaptcha');
      const pow2 = await solvePoW(data.c.req, 'https://newassets.hcaptcha.com');
      console.log('  PoW2 solved');

      // Build answers — for text challenges we need to figure out format
      const answers = {};
      for (const task of data.tasklist) {
        console.log('  Task:', JSON.stringify(task).slice(0, 200));
        // Try answering with the task entity text or a generic answer
        if (task.task_key) {
          answers[task.task_key] = task.datapoint_text || 'true';
        }
      }
      console.log('  Answers:', JSON.stringify(answers).slice(0, 200));

      console.log('\nStep 5: checkcaptcha');
      const checkBody = JSON.stringify({
        v: VERSION,
        sitekey: SITEKEY,
        host: HOST,
        c: JSON.stringify(data.c),
        job_mode: data.request_type || 'image_label_binary',
        answers,
        motionData: generateAnswerMotionData(data.tasklist.length),
        n: pow2,
        pdc: { s: Date.now(), n: 0, p: 0, gcs: 10 },
        a11y_tfe: true,
      });

      const checkResp = await fetch(`https://hcaptcha.com/checkcaptcha/${SITEKEY}/${data.key}`, {
        method: 'POST',
        headers: { ...HEADERS, 'Content-Type': 'application/json' },
        body: checkBody,
      });

      const checkBuf = Buffer.from(await checkResp.arrayBuffer());
      console.log('  Status:', checkResp.status);
      if (checkBuf[0] === 0x7b) {
        const checkData = JSON.parse(checkBuf.toString());
        console.log('  Result:', JSON.stringify(checkData).slice(0, 300));
        if (checkData.generated_pass_UUID) {
          console.log('\n  TOKEN:', checkData.generated_pass_UUID.slice(0, 50));
        }
      } else {
        console.log('  Encrypted response:', checkBuf.length, 'bytes');
      }
    }

    // Print full response for debugging
    console.log('\n  Raw response:', JSON.stringify(data, null, 2).slice(0, 500));
  } else {
    console.log('  Encrypted response:', respBuf.length, 'bytes');
  }
}

main().catch(console.error);
