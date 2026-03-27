'use strict';
/**
 * Debug: test CLIP trajectory detection + basket click + Next.
 * Shows full debug output to validate correct basket selection.
 */
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
const { CLIPSolver, getSolver } = require('./src/clip_solver');
chromium.use(stealth());
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';

async function cropRegion(page, iframeEl, xPct, yPct, wPct, hPct) {
  const bb = await iframeEl.boundingBox();
  if (!bb) return null;
  const clip = {
    x: Math.max(0, bb.x + bb.width * xPct),
    y: Math.max(0, bb.y + bb.height * yPct),
    width: Math.min(bb.width * wPct, bb.width - bb.width * xPct),
    height: Math.min(bb.height * hPct, bb.height - bb.height * yPct),
  };
  if (clip.width < 10 || clip.height < 10) return null;
  return page.screenshot({ clip, type: 'png' });
}

async function main() {
  const clip = await getSolver({ debug: true });
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1366, height: 768 } });
  const page = await ctx.newPage();

  let capturedToken = null;
  page.on('response', async resp => {
    const url = resp.url();
    if (url.includes('checkcaptcha') || url.includes('getcaptcha')) {
      const body = await resp.body().catch(() => Buffer.alloc(0));
      if (body[0] === 0x7b) {
        const txt = body.toString();
        console.log('[api]', txt.slice(0, 200));
        if (txt.includes('generated_pass_UUID')) capturedToken = JSON.parse(txt).generated_pass_UUID;
      }
    }
  });

  await page.goto('https://accounts.hcaptcha.com/demo?sitekey=338af34c-7bcb-4c7c-900b-acbec73d7d43', {
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
  await page.waitForTimeout(6000);

  const iframeEl = await page.$('iframe[src*="frame=challenge"]');
  const bb = await iframeEl.boundingBox();

  // Crop full challenge frame and run zero-shot CLIP classification
  const fullShot = await cropRegion(page, iframeEl, 0.0, 0.05, 1.0, 0.88);
  const labels = [
    'ball moving to upper basket on the left',
    'ball moving to lower basket on the left',
    'basketball trajectory pointing upward',
    'basketball trajectory pointing downward',
  ];
  const results = await clip.classify(fullShot, labels);
  console.log('\n=== CLIP Zero-Shot Results ===');
  results.forEach(r => console.log(`  ${r.label}: ${r.score.toFixed(4)}`));

  const upperScore = (results[0]?.score || 0) + (results[2]?.score || 0);
  const lowerScore = (results[1]?.score || 0) + (results[3]?.score || 0);
  const clickIdx = lowerScore > upperScore ? 1 : 0;
  console.log(`\nUpper score: ${upperScore.toFixed(4)}, Lower score: ${lowerScore.toFixed(4)}`);
  console.log(`→ Picking basket: ${clickIdx} (0=upper, 1=lower)`);

  const basketCoords = [
    { xPct: 0.337, yPct: 0.368 }, // upper
    { xPct: 0.202, yPct: 0.711 }, // lower
  ];
  const { xPct, yPct } = basketCoords[clickIdx];
  const clickX = bb.x + bb.width * xPct;
  const clickY = bb.y + bb.height * yPct;

  await page.mouse.click(clickX, clickY);
  await page.waitForTimeout(600);

  const nextX = bb.x + bb.width * 0.900;
  const nextY = bb.y + bb.height * 0.947;
  console.log(`Clicking Next at (${Math.round(nextX)}, ${Math.round(nextY)})`);
  await page.mouse.click(nextX, nextY);
  await page.waitForTimeout(3000);

  const cf = page.frames().find(f => f.url().includes('frame=challenge'));
  const feedback = cf ? await cf.evaluate(() => {
    const err = document.querySelector('.display-error, .error-text');
    const ok = document.querySelector('.success, [class*="correct"]');
    return { error: err ? err.textContent.trim() : null, ok: ok ? ok.textContent.trim() : null };
  }).catch(() => ({})) : {};

  console.log('\n=== Result ===');
  console.log('Feedback:', feedback);
  console.log('Token:', capturedToken ? capturedToken.slice(0, 40) : null);

  await page.screenshot({ path: '/tmp/clip_result.png' });
  await browser.close();
  console.log('Screenshot: /tmp/clip_result.png');
}

main().catch(e => { console.error(e.message); process.exit(1); });
