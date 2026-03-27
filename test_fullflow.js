'use strict';
// Full flow test — navigate to demo, click, watch ALL postMessages until challenge-passed or token
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
chromium.use(stealth());

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ userAgent: USER_AGENT, viewport: { width: 1366, height: 768 } });
  const page = await ctx.newPage();

  // Expose logger
  await ctx.exposeFunction('__logMsg', (label, data) => {
    console.log('[msg]', label, typeof data === 'string' ? data.slice(0, 120) : JSON.stringify(data).slice(0, 120));
  });

  let capturedToken = null;

  page.on('response', async resp => {
    const url = resp.url();
    if (url.includes('getcaptcha') || url.includes('checkcaptcha')) {
      const body = await resp.body().catch(() => Buffer.alloc(0));
      const isText = body[0] === 0x7b;
      if (isText) {
        const txt = body.toString();
        console.log('[api]', url.slice(-50), txt.slice(0, 150));
        if (txt.includes('generated_pass_UUID')) {
          const d = JSON.parse(txt);
          capturedToken = d.generated_pass_UUID;
        }
      } else {
        console.log('[api encrypted]', url.slice(-40), 'len:', body.length);
      }
    }
  });

  await page.goto('https://accounts.hcaptcha.com/demo', { waitUntil: 'domcontentloaded', timeout: 15000 });

  // Inject comprehensive postMessage snooper
  await page.evaluate(() => {
    window.addEventListener('message', (e) => {
      try {
        const d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
        if (!d || !d.source) return;
        const label = d.label || d.t || '?';
        window.__logMsg(label, d);
        // Capture token from challenge-passed
        if (label === 'challenge-passed' || label === 'pass' || label === 'response') {
          const tok = d.response || d.token || d.key || d.contents;
          if (tok && typeof tok === 'string' && tok.startsWith('P')) {
            window.__hcToken = tok;
          }
        }
      } catch (_) {}
    });
  });

  // Find and click checkbox
  let checkboxFrame = null;
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(500);
    checkboxFrame = page.frames().find(f => f.url().includes('frame=checkbox'));
    if (checkboxFrame) break;
  }
  if (!checkboxFrame) throw new Error('No checkbox frame');
  await checkboxFrame.waitForSelector('#checkbox', { timeout: 6000 });
  await page.waitForTimeout(600);
  console.log('Clicking checkbox...');
  await checkboxFrame.click('#checkbox');

  // Wait for challenge-passed (or timeout after 35s)
  console.log('Waiting 35s for all events...');
  for (let i = 0; i < 70; i++) {
    await page.waitForTimeout(500);
    if (capturedToken) break;
    const t = await page.evaluate(() => window.__hcToken).catch(() => null);
    if (t) { capturedToken = t; break; }
  }

  console.log('\n=== FINAL ===');
  console.log('capturedToken:', capturedToken ? capturedToken.slice(0, 60) : null);

  await browser.close();
}

main().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
