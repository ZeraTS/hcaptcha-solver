'use strict';

const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
chromium.use(stealth());

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    viewport: { width: 1366, height: 768 },
  });
  const page = await ctx.newPage();

  page.on('response', async resp => {
    const url = resp.url();
    if (url.includes('getcaptcha') || url.includes('checkcaptcha')) {
      const body = await resp.body().catch(() => Buffer.alloc(0));
      if (body[0] === 0x7b) {
        const data = JSON.parse(body.toString());
        console.log('[API JSON]', Object.keys(data));
        if (data.request_type) console.log('  type:', data.request_type);
        if (data.tasklist) {
          console.log('  tasks:', data.tasklist.length);
          console.log('  question:', JSON.stringify(data.requester_question));
          for (const t of data.tasklist.slice(0, 3)) console.log('  task:', JSON.stringify(t).slice(0, 300));
        }
        if (data.generated_pass_UUID) console.log('  *** TOKEN:', data.generated_pass_UUID.slice(0, 50));
        if (data.key) console.log('  key:', data.key.slice(0, 30));
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
  await page.waitForTimeout(5000);

  const cf = page.frames().find(f => f.url().includes('frame=challenge'));
  if (!cf) { console.log('No challenge frame'); await browser.close(); return; }

  // Get iframe bounding box
  const iframeEl = await page.$('iframe[src*="frame=challenge"]');
  const bb = await iframeEl.boundingBox();
  console.log('Challenge iframe at:', bb.x, bb.y, bb.width, bb.height);

  // Click the info button (bottom-left of challenge frame, ~x=10, y=523 relative to iframe)
  const infoBtnX = bb.x + 27;
  const infoBtnY = bb.y + 540;
  console.log('Clicking info button at', infoBtnX, infoBtnY);
  await page.mouse.click(infoBtnX, infoBtnY);
  await page.waitForTimeout(1500);

  await iframeEl.screenshot({ path: '/tmp/a11y_menu_visible.png' });
  console.log('Menu screenshot saved');

  // The menu from the vision analysis shows 5 items stacked vertically
  // Item 1: Accessibility Cookie
  // Item 2: Accessibility Challenge  <-- this is what we want
  // Item 3: Report Image
  // Item 4: Report Bug
  // Item 5: Information
  // The modal appears to be positioned around the info button area
  // From the previous screenshot, the modal was at (82,235) with size 357x101
  // But let me find it dynamically

  const modalInfo = await cf.evaluate(() => {
    const modal = document.querySelector('.modal, [role="dialog"]');
    if (!modal) return null;
    const rect = modal.getBoundingClientRect();
    // Get all child elements with their positions
    const children = [...modal.querySelectorAll('*')].map(el => {
      const r = el.getBoundingClientRect();
      return {
        tag: el.tagName,
        class: el.className?.toString()?.slice(0, 40),
        text: el.textContent?.trim()?.slice(0, 50),
        innerText: el.innerText?.trim()?.slice(0, 50),
        x: Math.round(r.x), y: Math.round(r.y),
        w: Math.round(r.width), h: Math.round(r.height),
        href: el.getAttribute('href'),
      };
    }).filter(c => c.w > 0 && c.h > 0);
    return { rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) }, children };
  });

  if (modalInfo) {
    console.log('\nModal rect:', modalInfo.rect);
    console.log('Children:');
    for (const c of modalInfo.children) {
      console.log(`  [${c.tag}] "${c.innerText}" class="${c.class}" at (${c.x},${c.y}) ${c.w}x${c.h} href=${c.href}`);
    }

    // Click "Accessibility Challenge" — it's the second menu item
    // Find it by scanning children
    for (const c of modalInfo.children) {
      if (c.innerText?.includes('Accessibility Challenge') || c.text?.includes('Accessibility Challenge')) {
        const clickX = bb.x + c.x + c.w / 2;
        const clickY = bb.y + c.y + c.h / 2;
        console.log('\nClicking "Accessibility Challenge" at', clickX, clickY);
        await page.mouse.click(clickX, clickY);
        await page.waitForTimeout(8000);

        await iframeEl.screenshot({ path: '/tmp/a11y_text_challenge.png' });
        console.log('Text challenge screenshot saved');

        // Check new state
        const state = await cf.evaluate(() => {
          return {
            prompt: document.querySelector('.prompt-text')?.textContent?.trim(),
            canvasAria: document.querySelector('canvas')?.getAttribute('aria-label'),
            inputs: document.querySelectorAll('input, textarea').length,
            bodyText: document.body.innerText?.slice(0, 500),
          };
        }).catch(() => null);
        console.log('\nNew state:', JSON.stringify(state, null, 2));
        break;
      }
    }
  }

  await browser.close();
}

main().catch(console.error);
