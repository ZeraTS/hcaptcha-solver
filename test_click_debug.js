'use strict';
/**
 * Debug: capture a screenshot right after clicking the basket to confirm
 * where we're clicking and what happens after.
 */
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

chromium.use(stealth());
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1366, height: 768 } });
  const page = await ctx.newPage();

  let capturedToken = null;
  page.on('response', async resp => {
    const url = resp.url();
    if (url.includes('/getcaptcha/') || url.includes('/checkcaptcha/')) {
      const body = await resp.body().catch(() => Buffer.alloc(0));
      console.log('[api]', url.slice(-50), 'len:', body.length, 'first byte:', body[0]);
      if (body[0] === 0x7b) {
        const txt = body.toString();
        console.log('[api text]', txt.slice(0, 200));
        if (txt.includes('generated_pass_UUID')) {
          capturedToken = JSON.parse(txt).generated_pass_UUID;
        }
      }
    }
  });

  await page.goto('https://accounts.hcaptcha.com/demo?sitekey=338af34c-7bcb-4c7c-900b-acbec73d7d43', {
    waitUntil: 'domcontentloaded', timeout: 15000
  });

  // Click checkbox
  let cbf = null;
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(400);
    cbf = page.frames().find(f => f.url().includes('frame=checkbox'));
    if (cbf) break;
  }
  await cbf.waitForSelector('#checkbox', { timeout: 6000 });
  await page.waitForTimeout(600);
  await cbf.click('#checkbox');
  console.log('Clicked checkbox, waiting for challenge...');
  await page.waitForTimeout(6000);

  // Screenshot before any click
  await page.screenshot({ path: '/tmp/before_click.png' });
  console.log('Pre-click screenshot saved');

  const iframeEl = await page.$('iframe[src*="frame=challenge"]');
  const bb = await iframeEl.boundingBox();
  console.log(`Iframe at (${Math.round(bb.x)},${Math.round(bb.y)}) size ${Math.round(bb.width)}x${Math.round(bb.height)}`);

  // Try clicking the upper basket (175/520=0.337 * 520 + 90 = 265, 210/570=0.368 * 570 + 11 = 221)
  const upperX = bb.x + bb.width * 0.337;
  const upperY = bb.y + bb.height * 0.368;
  console.log(`Clicking upper basket at (${Math.round(upperX)}, ${Math.round(upperY)})`);

  await page.mouse.move(upperX, upperY);
  await page.waitForTimeout(200);

  // Screenshot with mouse over basket
  await page.screenshot({ path: '/tmp/hover_basket.png' });
  console.log('Hover screenshot saved');

  await page.mouse.click(upperX, upperY);
  console.log('Clicked upper basket');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: '/tmp/after_upper_click.png' });

  // Also try lower basket
  const lowerX = bb.x + bb.width * 0.202;
  const lowerY = bb.y + bb.height * 0.711;
  console.log(`Clicking lower basket at (${Math.round(lowerX)}, ${Math.round(lowerY)})`);
  await page.mouse.click(lowerX, lowerY);
  await page.waitForTimeout(3000);
  await page.screenshot({ path: '/tmp/after_lower_click.png' });

  // Check for token
  const token = await page.evaluate(() => window.__hcToken).catch(() => null);
  console.log('postMessage token:', token);
  console.log('network token:', capturedToken);

  // Check challenge frame state
  const cf = page.frames().find(f => f.url().includes('frame=challenge'));
  if (cf) {
    const prompt = await cf.evaluate(() => {
      const el = document.querySelector('.prompt-text');
      return el ? el.textContent.trim() : 'gone';
    }).catch(() => 'error');
    console.log('Challenge prompt after clicks:', prompt);
  }

  await browser.close();
  console.log('Done. Check /tmp/after_*.png');
}

main().catch(e => { console.error(e.message); process.exit(1); });
