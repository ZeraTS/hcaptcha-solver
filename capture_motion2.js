'use strict';
// Try to trigger hCaptcha through a real site that auto-fires the challenge
const shapeDir = '/root/.openclaw/workspace/shape-solver';
const { chromium } = require(shapeDir + '/node_modules/playwright-extra');
const stealth = require(shapeDir + '/node_modules/puppeteer-extra-plugin-stealth');
const { fetch } = require('undici');
chromium.use(stealth());

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 768 },
  });
  const page = await ctx.newPage();

  let capturedMotion = null;

  // Intercept ALL hcaptcha API calls
  await ctx.route('**', async route => {
    const url = route.request().url();
    if (url.includes('hcaptcha.com/getcaptcha') || url.includes('api2.hcaptcha.com/getcaptcha')) {
      const body = route.request().postData() || '';
      const params = new URLSearchParams(body);
      const md = params.get('motionData');
      if (md) {
        capturedMotion = JSON.parse(Buffer.from(md, 'base64').toString());
        console.log('[CAPTURED] motionData from:', url.substring(0, 80));
      }
    }
    route.continue();
  });

  // Use a page that reliably shows hCaptcha
  // The hCaptcha test endpoint itself
  console.log('Loading hCaptcha test page...');

  // Use the hcaptcha.com/verify endpoint which always shows a challenge
  await page.goto('https://hcaptcha.com/api.js', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});

  // Build our own test page with hcaptcha
  await page.setContent(`<!DOCTYPE html>
<html><head>
<script src="https://js.hcaptcha.com/1/api.js" async defer></script>
</head><body>
<form>
<div class="h-captcha" data-sitekey="4c672d35-0701-42b2-88c3-78380b0db560" data-theme="light"></div>
<button type="submit">Submit</button>
</form>
</body></html>`, { waitUntil: 'domcontentloaded' });

  console.log('Waiting for widget to load...');
  await page.waitForTimeout(4000);

  // Find and click the checkbox
  const frames = page.frames();
  console.log('Frames:', frames.length);
  for (const f of frames) {
    const u = f.url();
    if (u.includes('newassets.hcaptcha.com') || u.includes('hcaptcha.com/captcha')) {
      console.log('hCaptcha frame:', u.substring(0, 80));
      try {
        await f.waitForSelector('#checkbox', { timeout: 5000 });
        await f.click('#checkbox');
        console.log('Clicked checkbox in frame');
        await page.waitForTimeout(6000);
        break;
      } catch(e) {
        console.log('No checkbox in frame:', e.message.substring(0, 50));
      }
    }
  }

  await page.waitForTimeout(3000);
  await browser.close();

  if (capturedMotion) {
    const allKeys = Object.keys(capturedMotion);
    const std = ['st','dct','mm','md','mu','tch','kd','ku','xy','wn','v','sc','nv','dr','inv','exec','wba','or','wi'];
    console.log('\n=== REAL motionData ===');
    console.log('All keys:', allKeys.join(','));
    console.log('EXTRA keys not in our impl:', allKeys.filter(k => !std.includes(k)).join(',') || 'none');
    console.log('mm events:', capturedMotion.mm?.length);
    console.log('wn events:', capturedMotion.wn?.length);
    console.log('nv:', JSON.stringify(capturedMotion.nv || {}).substring(0, 200));
    console.log('\nFULL:', JSON.stringify(capturedMotion).substring(0, 1500));
  } else {
    console.log('\nNo motionData captured');
  }
})().catch(e => console.error('Fatal:', e.message));
