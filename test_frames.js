'use strict';
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
chromium.use(stealth());
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
  });
  const page = await ctx.newPage();

  // Track all frames as they're created
  browser.on('page', p => {
    p.on('frameattached', f => console.log('[frameattached]', f.url().slice(0, 120)));
  });
  page.on('frameattached', f => console.log('[frameattached]', f.url().slice(0, 120)));
  page.on('framenavigated', f => console.log('[framenavigated]', f.url().slice(0, 120)));

  await page.goto('https://accounts.hcaptcha.com/demo', { waitUntil: 'domcontentloaded', timeout: 15000 });
  console.log('loaded');
  await page.waitForTimeout(6000);

  const frames = page.frames();
  console.log('\nfinal frame count:', frames.length);
  frames.forEach((f, i) => console.log(i, JSON.stringify(f.url().slice(0, 120))));

  // Check iframes in DOM
  const iframes = await page.$$('iframe');
  console.log('\niframes in DOM:', iframes.length);
  for (const iframe of iframes) {
    const src = await iframe.getAttribute('src').catch(() => '');
    const id = await iframe.getAttribute('id').catch(() => '');
    console.log('  id:', id, 'src:', src ? src.slice(0, 120) : '(none)');
  }

  await browser.close();
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
