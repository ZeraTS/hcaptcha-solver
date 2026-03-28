'use strict';

const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
chromium.use(stealth());

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    viewport: { width: 1366, height: 768 },
  });
  const page = await ctx.newPage();

  let gotTextChallenge = false;

  page.on('response', async resp => {
    const url = resp.url();
    if (url.includes('getcaptcha') || url.includes('checkcaptcha')) {
      const body = await resp.body().catch(() => Buffer.alloc(0));
      if (body[0] === 0x7b) {
        const data = JSON.parse(body.toString());
        console.log('\n[API JSON]');
        console.log('  keys:', Object.keys(data));
        if (data.request_type) console.log('  request_type:', data.request_type);
        if (data.tasklist) {
          console.log('  tasks:', data.tasklist.length);
          console.log('  question:', JSON.stringify(data.requester_question));
          for (const t of data.tasklist) {
            console.log('  task:', JSON.stringify(t).slice(0, 400));
          }
          gotTextChallenge = true;
        }
        if (data.generated_pass_UUID) console.log('  *** TOKEN:', data.generated_pass_UUID.slice(0, 50));
        if (data.key) console.log('  key:', data.key.slice(0, 40));
        if (data.success !== undefined) console.log('  success:', data.success);
      } else {
        console.log('\n[API enc]', body.length, 'bytes');
      }
    }
  });

  await page.goto('https://accounts.hcaptcha.com/demo?sitekey=a9b5fb07-92ff-493f-86fe-352a2803b3df', {
    waitUntil: 'domcontentloaded', timeout: 15000
  });

  let cbf = null;
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(400);
    cbf = page.frames().find(f => f.url().includes('frame=checkbox'));
    if (cbf) break;
  }
  await cbf.waitForSelector('#checkbox', { timeout: 6000 });
  await page.waitForTimeout(600);
  await cbf.click('#checkbox');
  console.log('Checkbox clicked');
  await page.waitForTimeout(5000);

  const iframeEl = await page.$('iframe[src*="frame=challenge"]');
  const bb = await iframeEl.boundingBox();

  // 1. Click info button (relative to iframe: x=27, y=540)
  console.log('Opening menu...');
  await page.mouse.click(bb.x + 27, bb.y + 540);
  await page.waitForTimeout(1500);

  // 2. Click "Accessibility Challenge" at iframe-relative (135, 352)
  console.log('Clicking Accessibility Challenge at iframe (135, 352)...');
  await page.mouse.click(bb.x + 135, bb.y + 352);
  await page.waitForTimeout(10000);

  // 3. Screenshot result
  await iframeEl.screenshot({ path: '/tmp/a11y_text_result.png' });
  console.log('Screenshot: /tmp/a11y_text_result.png');

  // 4. Check state
  const cf = page.frames().find(f => f.url().includes('frame=challenge'));
  if (cf) {
    const state = await cf.evaluate(() => {
      const inputs = [...document.querySelectorAll('input, textarea')];
      const allText = document.body.innerText || '';
      return {
        prompt: document.querySelector('.prompt-text')?.textContent?.trim(),
        canvasAria: document.querySelector('canvas')?.getAttribute('aria-label')?.slice(0, 150),
        inputs: inputs.map(i => ({ type: i.type, placeholder: i.placeholder, value: i.value })),
        bodySnippet: allText.slice(0, 500),
      };
    }).catch(() => null);
    console.log('\nChallenge state:', JSON.stringify(state, null, 2));
  }

  if (!gotTextChallenge) {
    console.log('\nNo text challenge captured from API — checking visual...');
  }

  await browser.close();
}

main().catch(console.error);
