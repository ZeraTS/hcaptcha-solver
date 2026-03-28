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

  page.on('response', async resp => {
    if (resp.url().includes('getcaptcha') || resp.url().includes('checkcaptcha')) {
      const body = await resp.body().catch(() => Buffer.alloc(0));
      if (body[0] === 0x7b) {
        const data = JSON.parse(body.toString());
        console.log('[API]', Object.keys(data));
        if (data.request_type) console.log('  request_type:', data.request_type);
        if (data.tasklist) {
          console.log('  tasks:', data.tasklist.length);
          console.log('  question:', JSON.stringify(data.requester_question));
          for (const t of data.tasklist.slice(0, 2)) console.log('  task:', JSON.stringify(t).slice(0, 200));
        }
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
  console.log('Checkbox clicked, waiting for challenge...');
  await page.waitForTimeout(5000);

  const cf = page.frames().find(f => f.url().includes('frame=challenge'));
  if (!cf) { console.log('No challenge frame'); await browser.close(); return; }

  // Click the accessibility/info button
  console.log('\nClicking "About hCaptcha & Accessibility Options" button...');
  try {
    await cf.click('button[title="About hCaptcha & Accessibility Options"]', { timeout: 3000 });
  } catch (e) {
    // Try by aria label
    await cf.click('[aria-label="About hCaptcha & Accessibility Options"]', { timeout: 3000 }).catch(() => {});
  }
  await page.waitForTimeout(2000);

  // Screenshot the modal/menu that appeared
  const iframeEl = await page.$('iframe[src*="frame=challenge"]');
  if (iframeEl) {
    await iframeEl.screenshot({ path: '/tmp/a11y_menu.png' });
    console.log('Screenshot: /tmp/a11y_menu.png');
  }

  // Check what's in the modal
  const modalContent = await cf.evaluate(() => {
    const modal = document.querySelector('.modal, [role="dialog"]');
    if (!modal) return { found: false };
    return {
      found: true,
      html: modal.innerHTML,
      text: modal.textContent?.trim().slice(0, 500),
      buttons: [...modal.querySelectorAll('button, a, [role="button"], .button')].map(b => ({
        text: b.textContent?.trim().slice(0, 60),
        class: b.className?.toString()?.slice(0, 60),
        href: b.getAttribute('href'),
        title: b.getAttribute('title'),
      })),
    };
  });

  console.log('\nModal content:');
  console.log('  Found:', modalContent.found);
  if (modalContent.found) {
    console.log('  Text:', modalContent.text);
    console.log('  Buttons:', JSON.stringify(modalContent.buttons, null, 2));
  }

  // Look for "Text Challenge" or "Accessibility Challenge" link/button
  if (modalContent.text?.includes('Text Challenge') || modalContent.text?.includes('Accessibility')) {
    console.log('\n*** FOUND ACCESSIBILITY OPTION ***');
    
    // Try to click it
    try {
      await cf.click('.modal a, .modal button, .modal [role="button"]', { timeout: 2000 });
      console.log('Clicked accessibility link');
      await page.waitForTimeout(5000);
      
      // Screenshot result
      if (iframeEl) {
        await iframeEl.screenshot({ path: '/tmp/a11y_text_challenge.png' });
        console.log('Screenshot after click: /tmp/a11y_text_challenge.png');
      }
    } catch (e) {
      console.log('Could not click:', e.message);
    }
  }

  await browser.close();
}

main().catch(console.error);
