'use strict';
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
chromium.use(stealth());
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1366, height: 768 } });
  const page = await ctx.newPage();

  await page.goto('https://accounts.hcaptcha.com/demo?sitekey=338af34c-7bcb-4c7c-900b-acbec73d7d43', {
    waitUntil: 'domcontentloaded', timeout: 15000
  });
  let cbf=null;
  for(let i=0;i<20;i++){await page.waitForTimeout(400);cbf=page.frames().find(f=>f.url().includes('frame=checkbox'));if(cbf)break;}
  await cbf.waitForSelector('#checkbox',{timeout:6000});
  await page.waitForTimeout(600);
  await cbf.click('#checkbox');
  await page.waitForTimeout(6000);

  const iframeEl = await page.$('iframe[src*="frame=challenge"]');
  const bb = await iframeEl.boundingBox();
  console.log('iframe BB:', Math.round(bb.x), Math.round(bb.y), Math.round(bb.width), Math.round(bb.height));

  // Screenshot before click
  await page.screenshot({ path: '/tmp/before_click_v2.png' });

  // Try clicking the UPPER basket at various precise positions and screenshot each
  const testPoints = [
    { name: 'upper-precise', xPct: 0.337, yPct: 0.368 },
    { name: 'upper-rim', xPct: 0.300, yPct: 0.360 },
    { name: 'upper-net', xPct: 0.315, yPct: 0.430 },
    { name: 'lower-precise', xPct: 0.202, yPct: 0.711 },
    { name: 'lower-rim', xPct: 0.165, yPct: 0.700 },
    { name: 'lower-net', xPct: 0.165, yPct: 0.750 },
  ];

  for (const pt of testPoints) {
    const x = bb.x + bb.width * pt.xPct;
    const y = bb.y + bb.height * pt.yPct;
    console.log(`Clicking ${pt.name} at (${Math.round(x)}, ${Math.round(y)})`);
    await page.mouse.move(x, y);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `/tmp/hover_${pt.name}.png` });
    await page.mouse.click(x, y);
    await page.waitForTimeout(800);
    await page.screenshot({ path: `/tmp/click_${pt.name}.png` });

    const cf = page.frames().find(f=>f.url().includes('frame=challenge'));
    const sel = cf ? await cf.evaluate(()=>{
      // Check canvas state — look for any highlighted pixel changes
      const canvas = document.querySelector('canvas');
      if (!canvas) return 'no canvas';
      // Also check for any selected class
      const sel = document.querySelector('[class*="selected"], [class*="highlight"]');
      return sel ? sel.className : 'no selected el';
    }).catch(()=>'err') : 'no frame';
    console.log(`  DOM state: ${sel}`);
  }

  await browser.close();
  console.log('\nDone. Check /tmp/hover_*.png and /tmp/click_*.png');
}

main().catch(e=>{console.error(e.message);process.exit(1);});
