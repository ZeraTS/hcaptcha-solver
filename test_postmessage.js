'use strict';
// Intercept all postMessages and window.hcaptcha events to find the token delivery mechanism
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
chromium.use(stealth());

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ userAgent: USER_AGENT, viewport: { width: 1366, height: 768 } });
  const page = await ctx.newPage();

  // Expose a function so page JS can call back to Node with messages
  await ctx.exposeFunction('__logMsg', (type, data) => {
    console.log('[' + type + ']', JSON.stringify(data).slice(0, 200));
  });

  // Before navigating, intercept all network to see what fires
  page.on('response', async resp => {
    const url = resp.url();
    if (url.includes('getcaptcha') || url.includes('checkcaptcha') || url.includes('checksiteconfig')) {
      const status = resp.status();
      try {
        const body = await resp.body();
        const isText = body[0] === 0x7b || body[0] === 0x5b; // '{' or '['
        if (isText) {
          console.log('[network]', status, url.split('?')[0].slice(-50), '->', body.toString().slice(0, 150));
        } else {
          console.log('[network encrypted]', status, url.split('?')[0].slice(-50), 'body len:', body.length);
        }
      } catch (e) {
        console.log('[network]', status, url.split('?')[0].slice(-50));
      }
    }
  });

  await page.goto('https://accounts.hcaptcha.com/demo', { waitUntil: 'domcontentloaded', timeout: 15000 });

  // Inject postMessage snooper into main page AFTER load
  await page.evaluate(() => {
    window.__msgs = [];
    const orig = window.addEventListener;
    window.addEventListener('message', (e) => {
      try {
        window.__logMsg('postMessage', { data: e.data, origin: e.origin });
      } catch (_) {}
    });
  });

  // Wait for checkbox frame and click
  let checkboxFrame = null;
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(500);
    checkboxFrame = page.frames().find(f => f.url().includes('frame=checkbox'));
    if (checkboxFrame) break;
  }
  if (!checkboxFrame) throw new Error('No checkbox frame');

  await checkboxFrame.waitForSelector('#checkbox', { timeout: 6000 });
  console.log('Clicking checkbox...');
  await page.waitForTimeout(600);
  await checkboxFrame.click('#checkbox');
  console.log('Clicked. Waiting 30s...');

  // Poll for hcaptchaOnLoad callback or widget property
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(500);
    const state = await page.evaluate(() => {
      // Check if hcaptcha widget has token
      const hc = window.hcaptcha;
      if (!hc) return null;
      const widgets = Object.keys(hc._widgets || {});
      if (!widgets.length) return null;
      const w = hc._widgets[widgets[0]];
      return w ? (w.getResponse ? w.getResponse() : null) : null;
    }).catch(() => null);

    if (state) {
      console.log('TOKEN from hcaptcha._widgets:', state.slice(0, 60));
      break;
    }
  }

  await browser.close();
}

main().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
