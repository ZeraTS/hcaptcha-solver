'use strict';

// Use Playwright to trigger the accessibility challenge option on a real enterprise site
// and capture what the text challenge looks like

const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
chromium.use(stealth());

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';

async function main() {
  console.log('=== Browser A11y Challenge Capture ===\n');

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1366, height: 768 } });
  const page = await ctx.newPage();

  // Capture all hcaptcha API responses
  page.on('response', async resp => {
    const url = resp.url();
    if (url.includes('/getcaptcha/') || url.includes('/checkcaptcha/')) {
      try {
        const body = await resp.body();
        if (body[0] === 0x7b) {
          const data = JSON.parse(body.toString());
          console.log('[API]', url.split('/').pop().slice(0, 30));
          console.log('  Keys:', Object.keys(data));
          if (data.generated_pass_UUID) console.log('  TOKEN:', data.generated_pass_UUID.slice(0, 40));
          if (data.request_type) console.log('  Type:', data.request_type);
          if (data.tasklist) {
            console.log('  Tasks:', data.tasklist.length);
            console.log('  Question:', JSON.stringify(data.requester_question));
            for (let i = 0; i < Math.min(2, data.tasklist.length); i++) {
              console.log(`  Task[${i}]:`, JSON.stringify(data.tasklist[i]).slice(0, 200));
            }
          }
        } else {
          console.log('[API encrypted]', url.split('/').pop().slice(0, 30), body.length, 'bytes');
        }
      } catch (e) {}
    }
  });

  // Capture postMessages
  await page.goto('https://accounts.hcaptcha.com/demo?sitekey=a9b5fb07-92ff-493f-86fe-352a2803b3df', {
    waitUntil: 'domcontentloaded', timeout: 15000
  });

  // Wait for checkbox
  let cbf = null;
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(400);
    cbf = page.frames().find(f => f.url().includes('frame=checkbox'));
    if (cbf) break;
  }
  if (!cbf) { console.log('No checkbox frame'); await browser.close(); return; }

  await cbf.waitForSelector('#checkbox', { timeout: 6000 });

  // BEFORE clicking checkbox, try to find and click the accessibility option
  // The widget has a menu accessible via the bottom-right corner
  const challengeFrame = page.frames().find(f => f.url().includes('frame=challenge'));
  
  // First click the checkbox to trigger the challenge
  console.log('Clicking checkbox...');
  await page.waitForTimeout(600);
  await cbf.click('#checkbox');

  // Wait for challenge to load
  await page.waitForTimeout(5000);

  // Now look for the accessibility option in the challenge frame
  const cf = page.frames().find(f => f.url().includes('frame=challenge'));
  if (cf) {
    console.log('\nChallenge frame loaded. Looking for accessibility button...');
    
    // Check DOM for accessibility elements
    const a11yInfo = await cf.evaluate(() => {
      const allButtons = document.querySelectorAll('button, [role="button"], a, [tabindex]');
      const texts = [];
      for (const el of allButtons) {
        const txt = el.textContent?.trim() || el.getAttribute('aria-label') || '';
        const cls = el.className?.toString()?.slice(0, 60) || '';
        if (txt || cls) texts.push({ text: txt.slice(0, 50), class: cls, tag: el.tagName });
      }
      // Also check for accessibility menu
      const menuItems = document.querySelectorAll('[class*="accessibility"], [class*="a11y"], [aria-label*="accessibility"]');
      return { 
        buttons: texts.slice(0, 15),
        a11yElements: menuItems.length,
        allClasses: [...new Set([...document.querySelectorAll('[class]')].map(e => e.className.toString().slice(0, 40)))].slice(0, 20),
      };
    }).catch(() => null);

    if (a11yInfo) {
      console.log('Buttons found:', JSON.stringify(a11yInfo.buttons, null, 2));
      console.log('A11y elements:', a11yInfo.a11yElements);
      console.log('Classes:', a11yInfo.allClasses);
    }

    // Try clicking the "refresh" or menu button that might have accessibility option
    try {
      await cf.click('.refresh', { timeout: 2000 });
      console.log('Clicked refresh button');
      await page.waitForTimeout(2000);
    } catch (e) {}

    // Screenshot for visual inspection
    const iframeEl = await page.$('iframe[src*="frame=challenge"]');
    if (iframeEl) {
      await iframeEl.screenshot({ path: '/tmp/a11y_challenge.png' });
      console.log('\nScreenshot saved: /tmp/a11y_challenge.png');
    }
  }

  await browser.close();
}

main().catch(console.error);
