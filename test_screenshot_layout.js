'use strict';
/**
 * Screenshot each challenge type with grid overlays to calibrate drag coordinates.
 * Saves annotated screenshots to /tmp/hc_layout/
 */
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');

chromium.use(stealth());
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';
const OUT = '/tmp/hc_layout';
fs.mkdirSync(OUT, { recursive: true });

const SITEKEYS = [
  { key: '338af34c-7bcb-4c7c-900b-acbec73d7d43', name: 'demo' },        // basket/ball
  { key: 'a5f74b19-9e45-40e0-b45d-47ff91b7a6c2', name: 'hc-demo' },    // drag_half
  { key: '4c672d35-0701-42b2-88c3-78380b0db560', name: 'hc-accounts' }, // drag_half
];

async function captureChallenge(browser, sitekey, name) {
  const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1366, height: 768 } });
  const page = await ctx.newPage();

  try {
    await page.goto(`https://accounts.hcaptcha.com/demo?sitekey=${sitekey}`, {
      waitUntil: 'domcontentloaded', timeout: 15000
    });

    // Wait for checkbox and click it
    let cbf = null;
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(400);
      cbf = page.frames().find(f => f.url().includes('frame=checkbox'));
      if (cbf) break;
    }
    if (!cbf) { console.log(`[${name}] No checkbox frame`); return; }
    await cbf.waitForSelector('#checkbox', { timeout: 6000 });
    await page.waitForTimeout(600);
    await cbf.click('#checkbox');
    console.log(`[${name}] Clicked checkbox`);

    // Wait for challenge to fully render
    await page.waitForTimeout(6000);

    // Get challenge prompt
    const cf = page.frames().find(f => f.url().includes('frame=challenge'));
    if (!cf) { console.log(`[${name}] No challenge frame`); return; }

    const prompt = await cf.evaluate(() => {
      const el = document.querySelector('.prompt-text');
      return el ? el.textContent.trim() : 'unknown';
    }).catch(() => 'unknown');
    console.log(`[${name}] Prompt: ${prompt}`);

    // Screenshot the full page
    await page.screenshot({ path: path.join(OUT, `${name}_full.png`) });

    // Screenshot just the challenge iframe
    const iframeEl = await page.$('iframe[src*="frame=challenge"]');
    if (iframeEl) {
      await iframeEl.screenshot({ path: path.join(OUT, `${name}_challenge.png`) });

      // Get bounding box info
      const bb = await iframeEl.boundingBox();
      console.log(`[${name}] iframe BB: x=${Math.round(bb.x)} y=${Math.round(bb.y)} w=${Math.round(bb.width)} h=${Math.round(bb.height)}`);

      // Get canvas data for inspection
      const canvasData = await cf.evaluate(() => {
        const c = document.querySelector('canvas');
        return c ? { w: c.width, h: c.height, data: c.toDataURL('image/png') } : null;
      });
      if (canvasData) {
        const buf = Buffer.from(canvasData.data.split(',')[1], 'base64');
        fs.writeFileSync(path.join(OUT, `${name}_canvas.png`), buf);
        console.log(`[${name}] Canvas: ${canvasData.w}x${canvasData.h}`);
      }

      // Get all element positions in the challenge frame
      const elements = await cf.evaluate(() => {
        const results = [];
        const selectors = [
          '.prompt-text', '.challenge-container', '.challenge-view',
          '.example-wrapper', '[class*="task"]', 'canvas', 'img',
          '[class*="draggable"]', '[class*="target"]', '[class*="slot"]',
          '[class*="piece"]', '[class*="basket"]',
        ];
        for (const sel of selectors) {
          const els = document.querySelectorAll(sel);
          for (const el of els) {
            const rect = el.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              results.push({
                sel,
                cls: el.className.slice(0, 60),
                x: Math.round(rect.x), y: Math.round(rect.y),
                w: Math.round(rect.width), h: Math.round(rect.height),
              });
            }
          }
        }
        return results;
      });

      console.log(`[${name}] Elements (${elements.length}):`);
      for (const e of elements) {
        console.log(`  ${e.sel} cls="${e.cls}" @ (${e.x},${e.y}) ${e.w}x${e.h}`);
      }
    }

    // Wait a bit then screenshot again (let animations settle)
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(OUT, `${name}_full2.png`) });

  } finally {
    await ctx.close().catch(() => {});
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    for (const { key, name } of SITEKEYS) {
      console.log(`\n=== ${name} ===`);
      await captureChallenge(browser, key, name).catch(e => console.log(`[${name}] ERROR:`, e.message));
    }
  } finally {
    await browser.close();
  }
  console.log(`\nScreenshots saved to ${OUT}`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
