'use strict';
// Screenshot the challenge iframe to inspect task images
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
const path = require('path');
chromium.use(stealth());

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ userAgent: USER_AGENT, viewport: { width: 1366, height: 768 } });
  const page = await ctx.newPage();

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
  await page.waitForTimeout(700);
  await cbf.click('#checkbox');
  console.log('Clicked, waiting for challenge...');
  await page.waitForTimeout(5000);

  // Screenshot full page
  await page.screenshot({ path: '/tmp/hcaptcha_page.png', fullPage: true });
  console.log('Page screenshot: /tmp/hcaptcha_page.png');

  // Screenshot challenge frame
  const challengeFrame = page.frames().find(f => f.url().includes('frame=challenge'));
  if (challengeFrame) {
    // Get the iframe element from the parent page
    const iframeEl = await page.$('iframe[src*="frame=challenge"]');
    if (iframeEl) {
      await iframeEl.screenshot({ path: '/tmp/hcaptcha_challenge.png' });
      console.log('Challenge screenshot: /tmp/hcaptcha_challenge.png');
    }

    // Get task/example elements and screenshot each
    const exampleCount = await challengeFrame.evaluate(() => {
      return document.querySelectorAll('.example-wrapper, [class*="task"], [class*="challenge"]').length;
    });
    console.log('Example/task elements:', exampleCount);

    // Get prompt text
    const prompt = await challengeFrame.evaluate(() => {
      const el = document.querySelector('.prompt-text');
      return el ? el.textContent.trim() : 'NOT FOUND';
    });
    console.log('Prompt:', prompt);

    // Get canvas data URL
    const canvasData = await challengeFrame.evaluate(() => {
      const canvas = document.querySelector('canvas');
      if (!canvas) return null;
      return canvas.toDataURL('image/png');
    });
    if (canvasData) {
      const base64 = canvasData.replace(/^data:image\/png;base64,/, '');
      require('fs').writeFileSync('/tmp/hcaptcha_canvas.png', Buffer.from(base64, 'base64'));
      console.log('Canvas screenshot: /tmp/hcaptcha_canvas.png');
    } else {
      console.log('No canvas found or empty');
    }
  }

  await browser.close();
}

main().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
