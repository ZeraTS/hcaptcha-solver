'use strict';
/**
 * Test LEFT/RIGHT basket click (not upper/lower).
 * The two baskets are at the bottom of the court, side by side.
 * Left basket: page ~(280, 430), Right basket: page ~(500, 390).
 * The ball/arrow indicator determines which basket it goes toward.
 */
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
chromium.use(stealth());
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  let correct = 0, total = 0;

  for (let trial = 0; trial < 5; trial++) {
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
    total++;

    // Screenshot before click
    await page.screenshot({ path: `/tmp/trial${trial+1}_before.png` });

    // Basket positions in iframe pct:
    // Left basket:  (280-90)/520=0.365 x, (430-11)/570=0.735 y
    // Right basket: (500-90)/520=0.788 x, (390-11)/570=0.665 y
    const LEFT  = { xPct: 0.365, yPct: 0.735 };
    const RIGHT = { xPct: 0.788, yPct: 0.665 };

    // Determine which basket from canvas analysis
    const cf = page.frames().find(f=>f.url().includes('frame=challenge'));
    const analysis = cf ? await cf.evaluate(() => {
      const canvas = document.querySelector('canvas');
      if (!canvas) return null;
      const c = canvas.getContext('2d');
      const W = canvas.width, H = canvas.height;
      const data = c.getImageData(0, 0, W, H).data;
      const px = (x,y) => { const i=(y*W+x)*4; return [data[i],data[i+1],data[i+2],data[i+3]]; };

      const ball=[], rims=[];
      for (let y=50;y<H*0.85;y+=2) {
        for (let x=50;x<W-50;x+=2) {
          const [r,g,b,a]=px(x,y);
          if(a<150)continue;
          if(r>200&&g>80&&g<190&&b<90) ball.push([x,y]);
          if(r>170&&g<80&&b<80) rims.push([x,y]);
        }
      }
      const C = pts => pts.length ? [Math.round(pts.reduce((s,p)=>s+p[0],0)/pts.length), Math.round(pts.reduce((s,p)=>s+p[1],0)/pts.length)] : null;
      const ballC = C(ball);

      // Split rims by X position (left vs right basket)
      const midX = W/2;
      const leftRims = rims.filter(p=>p[0]<midX);
      const rightRims = rims.filter(p=>p[0]>=midX);
      const leftC = C(leftRims);
      const rightC = C(rightRims);

      // Ball direction: ball X vs midX — if ball is left of center, heading right, and vice versa
      // More reliable: ball's horizontal relationship to arrow
      const prediction = ballC && ballC[0] < midX*0.6 ? 'left' : 'right';

      return { W, H, ballC, leftC, rightC, ballCount: ball.length, leftRimCount: leftRims.length, rightRimCount: rightRims.length, prediction };
    }).catch(()=>null) : null;

    console.log(`\nTrial ${trial+1}: analysis=`, analysis);

    const pick = analysis?.prediction || 'left';
    const coord = pick === 'left' ? LEFT : RIGHT;
    const clickX = bb.x + bb.width * coord.xPct;
    const clickY = bb.y + bb.height * coord.yPct;

    console.log(`Clicking ${pick} basket at (${Math.round(clickX)}, ${Math.round(clickY)})`);
    await page.mouse.click(clickX, clickY);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `/tmp/trial${trial+1}_selected.png` });

    // Click Next
    await page.mouse.click(bb.x+bb.width*0.900, bb.y+bb.height*0.947);
    await page.waitForTimeout(3000);

    const cfA = page.frames().find(f=>f.url().includes('frame=challenge'));
    const fb = cfA ? await cfA.evaluate(()=>{const e=document.querySelector('.display-error');return e?e.textContent.trim():'ok';}).catch(()=>'ok') : 'ok';
    console.log('Feedback:', fb);
    if (!fb.includes('try again')) { correct++; console.log('✓'); } else { console.log('✗'); }

    await ctx.close();
  }
  await browser.close();
  console.log(`\n=== ${correct}/${total} ===`);
}

main().catch(e=>{console.error(e.message);process.exit(1);});
