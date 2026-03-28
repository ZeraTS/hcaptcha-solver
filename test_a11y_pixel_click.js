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
        console.log('\n[API JSON]', Object.keys(data));
        if (data.request_type) console.log('  type:', data.request_type);
        if (data.tasklist) {
          console.log('  tasks:', data.tasklist.length);
          console.log('  question:', JSON.stringify(data.requester_question));
          for (const t of data.tasklist.slice(0, 3)) console.log('  task:', JSON.stringify(t).slice(0, 300));
        }
        if (data.generated_pass_UUID) console.log('  *** TOKEN:', data.generated_pass_UUID.slice(0, 50));
        if (data.key) console.log('  key:', data.key.slice(0, 30));
      } else {
        console.log('\n[API enc]', body.length, 'bytes');
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

  const iframeEl = await page.$('iframe[src*="frame=challenge"]');
  const bb = await iframeEl.boundingBox();
  console.log('Iframe at:', bb.x, bb.y, bb.width, bb.height);

  // Click info button at bottom-left (relative: ~27, ~540)
  await page.mouse.click(bb.x + 27, bb.y + 540);
  console.log('Clicked info button');
  await page.waitForTimeout(1500);

  // The menu from vision analysis shows 5 items stacked in a white popup
  // Modal is at relative (82, 235) inside iframe, size ~357x101
  // But the vision shows it's bigger with 5 items
  // The menu items are below the modal header
  // "Accessibility Cookie" is item 1
  // "Accessibility Challenge" is item 2 — roughly at y offset ~20px below first item
  
  // Let me take a fresh screenshot to get exact positions
  await iframeEl.screenshot({ path: '/tmp/a11y_menu2.png' });

  // The modal in the iframe starts at ~(82, 235)
  // The header takes ~44px, underline at y=300
  // Menu items would be below the underline
  // But the DOM says modal is only 101px tall (235 to 336)
  // The menu items might extend below the modal div
  
  // Let me try clicking various y positions in the modal area
  // Menu items in the vision: appear to be in the lower half of the challenge frame
  // around y=300-500 in the iframe coordinates
  
  // Actually — re-reading the vision output more carefully, the menu is at the BOTTOM
  // of the challenge frame, not in the center modal. Let me try clicking lower.
  
  // From the first vision analysis: the menu items were in a "Bottom Menu Panel (White Background)"
  // This suggests they're at the very bottom of the frame, above the footer controls
  
  // Footer controls are at y~523. Menu items above that.
  // Let's try clicking at different y positions
  
  const menuItems = [
    { name: 'Accessibility Cookie', relY: 410 },
    { name: 'Accessibility Challenge', relY: 430 },
    { name: 'Report Image', relY: 450 },
    { name: 'Report Bug', relY: 470 },
    { name: 'Information', relY: 490 },
  ];

  // Try "Accessibility Challenge" 
  const target = menuItems[1];
  const clickX = bb.x + 200; // center-ish horizontally
  const clickY = bb.y + target.relY;
  console.log(`Clicking "${target.name}" at (${clickX}, ${clickY})`);
  await page.mouse.click(clickX, clickY);
  await page.waitForTimeout(8000);

  await iframeEl.screenshot({ path: '/tmp/a11y_after_menu_click.png' });
  console.log('Screenshot saved');

  // Check new frame state
  const cf = page.frames().find(f => f.url().includes('frame=challenge'));
  if (cf) {
    const state = await cf.evaluate(() => {
      const inputs = [...document.querySelectorAll('input, textarea')];
      return {
        prompt: document.querySelector('.prompt-text')?.textContent?.trim(),
        canvasAria: document.querySelector('canvas')?.getAttribute('aria-label')?.slice(0, 100),
        inputs: inputs.length,
        inputTypes: inputs.map(i => ({ type: i.type, placeholder: i.placeholder, class: i.className?.toString()?.slice(0, 40) })),
        allText: document.body.innerText?.slice(0, 300),
      };
    }).catch(() => null);
    console.log('\nFrame state:', JSON.stringify(state, null, 2));
  }

  await browser.close();
}

main().catch(console.error);
