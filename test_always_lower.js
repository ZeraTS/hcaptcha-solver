'use strict';
// Test: always click lower basket — does it always pass?
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
chromium.use(stealth());
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  let correct = 0, total = 0;

  for (let trial = 0; trial < 5; trial++) {
    const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1366, height: 768 } });
    const page = await ctx.newPage();

    let capturedToken = null;
    page.on('response', async resp => {
      if (resp.url().includes('checkcaptcha') || resp.url().includes('getcaptcha')) {
        const body = await resp.body().catch(()=>Buffer.alloc(0));
        if (body[0]===0x7b) {
          const txt = body.toString();
          if (txt.includes('generated_pass_UUID')) capturedToken = JSON.parse(txt).generated_pass_UUID;
        }
      }
    });

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
    if (!iframeEl) { console.log(`Trial ${trial+1}: no challenge iframe`); await ctx.close(); continue; }
    const bb = await iframeEl.boundingBox();
    total++;

    // Get prompt
    const cf = page.frames().find(f=>f.url().includes('frame=challenge'));
    const prompt = cf ? await cf.evaluate(()=>{const e=document.querySelector('.prompt-text');return e?e.textContent.trim():'?';}).catch(()=>'?') : '?';
    console.log(`\nTrial ${trial+1}: "${prompt}"`);

    // Multi-round handler — keep clicking lower + Next until token or 5 rounds
    let rounds = 0;
    while (!capturedToken && rounds < 6) {
      rounds++;
      // Click lower basket
      await page.mouse.click(bb.x + bb.width * 0.202, bb.y + bb.height * 0.711);
      await page.waitForTimeout(500);
      // Click Next
      await page.mouse.click(bb.x + bb.width * 0.900, bb.y + bb.height * 0.947);
      await page.waitForTimeout(2000);

      if (capturedToken) break;

      const cfA = page.frames().find(f=>f.url().includes('frame=challenge'));
      const fb = cfA ? await cfA.evaluate(()=>{const e=document.querySelector('.display-error');return e?e.textContent.trim():'ok';}).catch(()=>'frame_gone') : 'frame_gone';
      console.log(`  Round ${rounds}: ${fb}`);
      if (fb === 'ok' || fb === 'frame_gone') break; // no error → possibly passed
      if (fb.includes('try again')) {
        // Wrong — try upper basket instead
        await page.mouse.click(bb.x + bb.width * 0.337, bb.y + bb.height * 0.368);
        await page.waitForTimeout(500);
        await page.mouse.click(bb.x + bb.width * 0.900, bb.y + bb.height * 0.947);
        await page.waitForTimeout(2000);
        rounds++;
        const cfB = page.frames().find(f=>f.url().includes('frame=challenge'));
        const fb2 = cfB ? await cfB.evaluate(()=>{const e=document.querySelector('.display-error');return e?e.textContent.trim():'ok';}).catch(()=>'ok') : 'ok';
        console.log(`  Round ${rounds} (upper): ${fb2}`);
        if (!fb2.includes('try again')) break;
      }
    }

    if (capturedToken) {
      correct++;
      console.log(`✓ TOKEN: ${capturedToken.slice(0,50)}...`);
    } else {
      console.log('✗ No token after', rounds, 'rounds');
    }

    await ctx.close();
  }
  await browser.close();
  console.log(`\n=== RESULTS: ${correct}/${total} ===`);
}

main().catch(e=>{console.error(e.message);process.exit(1);});
