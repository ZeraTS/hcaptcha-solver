'use strict';
// Test: navigate to demo, wait for checkbox frame, click it, capture data
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
chromium.use(stealth());

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const ctx = await browser.newContext({ userAgent: USER_AGENT, viewport: { width: 1366, height: 768 } });
  const page = await ctx.newPage();

  let capturedMotionData = null;
  let capturedToken = null;

  await page.route('**/getcaptcha/**', async route => {
    const postData = route.request().postData();
    if (postData) {
      const params = new URLSearchParams(postData);
      capturedMotionData = params.get('motionData');
      console.log('[getcaptcha intercepted] v:', params.get('v'), 'motionData len:', capturedMotionData ? capturedMotionData.length : 0);
    }
    await route.continue();
  });

  page.on('response', async resp => {
    const url = resp.url();
    if (url.includes('/getcaptcha/') || url.includes('/checkcaptcha/')) {
      try {
        const body = await resp.text();
        console.log('[API response]', url.slice(0, 80), '->', body.slice(0, 200));
        if (body.includes('generated_pass_UUID')) {
          capturedToken = JSON.parse(body).generated_pass_UUID;
        }
      } catch (e) {}
    }
  });

  try {
    await page.goto('https://accounts.hcaptcha.com/demo', { waitUntil: 'domcontentloaded', timeout: 15000 });

    // Wait for checkbox iframe to be attached and navigated
    console.log('Waiting for checkbox frame to load...');
    const checkboxFrame = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('checkbox frame timeout')), 10000);
      const check = () => {
        const f = page.frames().find(f => f.url().includes('frame=checkbox'));
        if (f) { clearTimeout(timeout); resolve(f); return; }
        setTimeout(check, 200);
      };
      check();
    });

    console.log('Checkbox frame URL:', checkboxFrame.url().slice(0, 100));

    // Wait for the checkbox element
    await checkboxFrame.waitForSelector('#checkbox', { timeout: 8000 });
    console.log('Checkbox element ready, clicking...');

    // Human-like click with small delay
    await page.waitForTimeout(500 + Math.floor(Math.random() * 500));
    await checkboxFrame.click('#checkbox');
    console.log('Clicked');

    // Wait for API calls to fire
    console.log('Waiting up to 20s for challenge flow...');
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      await page.waitForTimeout(500);
      if (capturedToken || capturedMotionData) break;
    }

    console.log('\n=== Results ===');
    console.log('motionData captured:', !!capturedMotionData, capturedMotionData ? capturedMotionData.length + ' chars' : '');
    console.log('token:', capturedToken ? capturedToken.slice(0, 40) + '...' : null);

    const cookies = await ctx.cookies();
    console.log('Cookies:', cookies.map(c => c.name + '=' + c.value.slice(0, 10)).join(', '));

  } finally {
    await browser.close();
  }
}

main().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
