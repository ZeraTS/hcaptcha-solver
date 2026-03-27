'use strict';
const shapeDir = '/root/.openclaw/workspace/shape-solver';
const { chromium } = require(shapeDir + '/node_modules/playwright-extra');
const stealth = require(shapeDir + '/node_modules/puppeteer-extra-plugin-stealth');
chromium.use(stealth());

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 768 },
  });
  const page = await ctx.newPage();

  let capturedMotion = null;
  let gcResponse = null;

  await ctx.route('**/getcaptcha/**', async route => {
    const body = route.request().postData() || '';
    const params = new URLSearchParams(body);
    const md = params.get('motionData');
    if (md && !capturedMotion) {
      capturedMotion = JSON.parse(Buffer.from(md, 'base64').toString());
    }
    const resp = await route.fetch();
    const txt = await resp.text();
    try {
      gcResponse = JSON.parse(txt);
      console.log('getcaptcha response:', JSON.stringify(gcResponse).substring(0, 200));
    } catch(e) {}
    route.fulfill({ response: resp });
  });

  console.log('Navigating to hCaptcha demo...');
  await page.goto('https://accounts.hcaptcha.com/demo?sitekey=4c672d35-0701-42b2-88c3-78380b0db560', {
    waitUntil: 'domcontentloaded', timeout: 30000
  });

  console.log('Page loaded, waiting for widget...');
  await page.waitForTimeout(3000);

  // Try clicking the checkbox inside the iframe
  try {
    const frames = page.frames();
    for (const f of frames) {
      if (f.url().includes('hcaptcha.com')) {
        console.log('Found hcaptcha iframe:', f.url().substring(0, 80));
        const cb = await f.$('#checkbox');
        if (cb) {
          console.log('Clicking checkbox...');
          await cb.click();
          await page.waitForTimeout(5000);
          break;
        }
      }
    }
  } catch(e) {
    console.log('Checkbox click error:', e.message.substring(0, 80));
  }

  await page.waitForTimeout(3000);
  await browser.close();

  if (capturedMotion) {
    const allKeys = Object.keys(capturedMotion);
    const std = ['st','dct','mm','md','mu','tch','kd','ku','xy','wn','v','sc','nv','dr','inv','exec','wba','or','wi'];
    console.log('\n=== REAL motionData ===');
    console.log('Keys:', allKeys.join(','));
    console.log('Extra keys:', allKeys.filter(k => !std.includes(k)).join(',') || 'none');
    console.log('mm events:', capturedMotion.mm?.length);
    console.log('nv keys:', Object.keys(capturedMotion.nv || {}).join(','));
    console.log('Full sample:', JSON.stringify(capturedMotion).substring(0, 1000));
  } else {
    console.log('No motionData captured — widget did not trigger getcaptcha');
  }
})().catch(e => console.error('Fatal:', e.message));
