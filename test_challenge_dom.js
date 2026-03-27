'use strict';
// Inspect the challenge iframe DOM after images load
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
chromium.use(stealth());

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ userAgent: USER_AGENT, viewport: { width: 1366, height: 768 } });
  const page = await ctx.newPage();

  let challengeEncResponse = null;

  page.on('response', async resp => {
    const url = resp.url();
    if (url.includes('getcaptcha')) {
      const body = await resp.body().catch(() => Buffer.alloc(0));
      challengeEncResponse = body;
      console.log('[getcaptcha response] len:', body.length, 'first byte:', body[0]);
    }
  });

  await page.goto('https://accounts.hcaptcha.com/demo?sitekey=a9b5fb07-92ff-493f-86fe-352a2803b3df', {
    waitUntil: 'domcontentloaded', timeout: 15000
  });

  // Wait for and click checkbox
  let cbf = null;
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(400);
    cbf = page.frames().find(f => f.url().includes('frame=checkbox'));
    if (cbf) break;
  }
  await cbf.waitForSelector('#checkbox', { timeout: 6000 });
  await page.waitForTimeout(600);
  await cbf.click('#checkbox');
  console.log('Clicked');

  // Wait for challenge to load
  await page.waitForTimeout(8000);

  // Inspect challenge frame
  const challengeFrame = page.frames().find(f => f.url().includes('frame=challenge'));
  if (!challengeFrame) { console.log('No challenge frame'); await browser.close(); return; }

  console.log('\n--- Challenge frame DOM inspection ---');
  const domInfo = await challengeFrame.evaluate(() => {
    const allEls = document.querySelectorAll('*');
    const interesting = [];
    for (const el of allEls) {
      const tag = el.tagName;
      if (['IMG', 'CANVAS', 'SVG', 'VIDEO'].includes(tag)) {
        interesting.push({ tag, src: el.src || el.getAttribute('src') || '', class: el.className.slice(0, 50) });
      }
      if (el.style && el.style.backgroundImage && el.style.backgroundImage.includes('http')) {
        interesting.push({ tag: 'BG-IMG', url: el.style.backgroundImage.slice(0, 100), class: el.className.slice(0, 50) });
      }
    }
    // Get ALL text content
    const texts = [];
    const textEls = document.querySelectorAll('div, span, p, h1, h2, h3, label');
    for (const el of textEls) {
      const txt = el.textContent.trim();
      if (txt && txt.length > 3 && txt.length < 200) {
        texts.push(txt.slice(0, 100));
      }
    }
    // Get ALL classes
    const classes = new Set();
    for (const el of document.querySelectorAll('[class]')) {
      for (const c of el.classList) classes.add(c);
    }
    return {
      interesting,
      texts: [...new Set(texts)].slice(0, 20),
      classes: [...classes].slice(0, 30),
      bodyHtml: document.body.innerHTML.slice(0, 2000),
    };
  });

  console.log('Interesting elements:', JSON.stringify(domInfo.interesting, null, 2));
  console.log('Texts:', domInfo.texts);
  console.log('Classes:', domInfo.classes);

  await browser.close();
}

main().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
