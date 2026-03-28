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
    const url = resp.url();
    if (url.includes('getcaptcha') || url.includes('checkcaptcha') || url.includes('accessibility')) {
      const body = await resp.body().catch(() => Buffer.alloc(0));
      if (body[0] === 0x7b) {
        const data = JSON.parse(body.toString());
        console.log('[API JSON]', url.split('/').slice(-2).join('/').slice(0, 50));
        console.log('  Keys:', Object.keys(data));
        if (data.request_type) console.log('  type:', data.request_type);
        if (data.tasklist) {
          console.log('  tasks:', data.tasklist.length);
          console.log('  question:', JSON.stringify(data.requester_question));
          for (const t of data.tasklist.slice(0, 3)) console.log('  task:', JSON.stringify(t).slice(0, 250));
        }
        if (data.generated_pass_UUID) console.log('  *** TOKEN:', data.generated_pass_UUID.slice(0, 50));
      } else {
        console.log('[API]', url.split('/').slice(-2).join('/').slice(0, 50), '- enc', body.length, 'bytes');
      }
    }
  });

  await page.goto('https://accounts.hcaptcha.com/demo?sitekey=a9b5fb07-92ff-493f-86fe-352a2803b3df', {
    waitUntil: 'domcontentloaded', timeout: 15000
  });

  // Wait for checkbox and click
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

  // Click the info/accessibility button
  console.log('Opening accessibility menu...');
  await cf.click('button[title="About hCaptcha & Accessibility Options"]').catch(() => {});
  await page.waitForTimeout(1500);

  // Now click "Accessibility Challenge" in the modal menu
  console.log('Looking for Accessibility Challenge option...');
  
  // Find all text in the modal and click the right one
  const clicked = await cf.evaluate(() => {
    const modal = document.querySelector('.modal, [role="dialog"]');
    if (!modal) return 'no modal';
    
    // Find all clickable elements in modal
    const links = modal.querySelectorAll('a, button, div, span');
    for (const el of links) {
      const text = (el.textContent || '').trim();
      if (text === 'Accessibility Challenge' || text.includes('Accessibility Challenge')) {
        el.click();
        return 'clicked: ' + text;
      }
    }
    
    // Dump all text for debugging
    return 'not found. texts: ' + [...links].map(l => l.textContent?.trim()).filter(Boolean).join(' | ');
  });
  
  console.log('Result:', clicked);
  await page.waitForTimeout(8000);

  // Screenshot after clicking
  const iframeEl = await page.$('iframe[src*="frame=challenge"]');
  if (iframeEl) {
    await iframeEl.screenshot({ path: '/tmp/a11y_after_click.png' });
    console.log('Screenshot: /tmp/a11y_after_click.png');
  }

  // Check what the challenge frame shows now
  const newState = await cf.evaluate(() => {
    const prompt = document.querySelector('.prompt-text');
    const canvas = document.querySelector('canvas');
    const inputs = document.querySelectorAll('input, textarea');
    const buttons = [...document.querySelectorAll('button, [role="button"]')].map(b => b.textContent?.trim()).filter(Boolean);
    return {
      prompt: prompt?.textContent?.trim() || '',
      hasCanvas: !!canvas,
      canvasAria: canvas?.getAttribute('aria-label') || '',
      inputs: inputs.length,
      buttons: buttons.slice(0, 10),
      bodyText: document.body.textContent?.trim().slice(0, 500),
    };
  }).catch(() => null);

  console.log('\nNew challenge state:');
  console.log(JSON.stringify(newState, null, 2));

  await browser.close();
}

main().catch(console.error);
