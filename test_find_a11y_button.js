'use strict';

const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
chromium.use(stealth());

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 768 },
  });
  const page = await ctx.newPage();

  // Capture responses
  page.on('response', async resp => {
    if (resp.url().includes('getcaptcha') || resp.url().includes('checkcaptcha')) {
      const body = await resp.body().catch(() => Buffer.alloc(0));
      if (body[0] === 0x7b) {
        const data = JSON.parse(body.toString());
        console.log('[API JSON]', Object.keys(data), data.request_type || '', data.tasklist?.length || 0, 'tasks');
        if (data.requester_question) console.log('  Q:', JSON.stringify(data.requester_question));
        if (data.generated_pass_UUID) console.log('  TOKEN:', data.generated_pass_UUID.slice(0, 40));
      } else {
        console.log('[API enc]', body.length, 'bytes');
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
  await page.waitForTimeout(6000);

  const cf = page.frames().find(f => f.url().includes('frame=challenge'));
  if (!cf) { console.log('No challenge frame'); await browser.close(); return; }

  // Get FULL HTML to search for accessibility trigger
  const fullHTML = await cf.evaluate(() => document.body.innerHTML);

  // Search for accessibility references
  const a11yMatches = fullHTML.match(/access|a11y|accessibility|screen.?reader|text.?challenge/gi);
  console.log('\nA11y text matches in HTML:', a11yMatches?.length || 0);

  // Get all interactive elements with full details
  const elements = await cf.evaluate(() => {
    const result = [];
    // Check everything with a click handler or role
    document.querySelectorAll('div, button, a, span, svg, [role], [tabindex], [onclick], [class]').forEach(el => {
      const cls = el.className?.toString() || '';
      const aria = el.getAttribute('aria-label') || '';
      const title = el.getAttribute('title') || '';
      const role = el.getAttribute('role') || '';
      // Filter for potentially interactive bottom-bar elements
      if (cls.includes('info') || cls.includes('refresh') || cls.includes('button') || 
          cls.includes('skip') || cls.includes('accessibility') || cls.includes('menu') ||
          cls.includes('logo') || cls.includes('hcaptcha') || role || aria || title) {
        result.push({
          tag: el.tagName,
          class: cls.slice(0, 80),
          aria,
          title,
          role,
          text: (el.textContent || '').trim().slice(0, 60),
          rect: el.getBoundingClientRect(),
        });
      }
    });
    return result;
  });

  console.log('\nInteractive elements:');
  for (const el of elements) {
    if (el.rect.width > 0 && el.rect.height > 0) {
      console.log(`  [${el.tag}] class="${el.class}" aria="${el.aria}" title="${el.title}" role="${el.role}" text="${el.text}" (${Math.round(el.rect.x)},${Math.round(el.rect.y)} ${Math.round(el.rect.width)}x${Math.round(el.rect.height)})`);
    }
  }

  // Click on the info-on/info-off button (bottom right of challenge)
  try {
    await cf.click('.info-on, .info-off', { timeout: 2000 });
    console.log('\nClicked info button');
    await page.waitForTimeout(2000);
    
    // Check what appeared
    const afterClick = await cf.evaluate(() => {
      return document.body.innerHTML.slice(0, 2000);
    });
    
    if (afterClick.includes('accessibility') || afterClick.includes('Accessibility')) {
      console.log('FOUND ACCESSIBILITY MENU AFTER CLICK!');
      console.log(afterClick.match(/.{0,100}accessibility.{0,100}/gi));
    }

    // Screenshot
    const iframeEl = await page.$('iframe[src*="frame=challenge"]');
    if (iframeEl) {
      await iframeEl.screenshot({ path: '/tmp/a11y_after_info.png' });
      console.log('Screenshot: /tmp/a11y_after_info.png');
    }
  } catch (e) {
    console.log('Info button not found:', e.message);
  }

  await browser.close();
}

main().catch(console.error);
