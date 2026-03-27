'use strict';
/**
 * Dynamic basket detection + trajectory analysis.
 * 1. Find red rim pixels → cluster into 2 baskets dynamically
 * 2. Find white circular arrow → determine arc direction by which sector has most white pixels
 * 3. Click the basket the arc direction points toward
 * 4. Click Next to submit
 */
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
chromium.use(stealth());
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';

async function analyzeChallenge(cf) {
  return cf.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return null;
    const c = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const SCALE = 0.5; // canvas is 2x the iframe display size
    const data = c.getImageData(0, 0, W, H).data;
    const px = (x, y) => { const i=(y*W+x)*4; return [data[i],data[i+1],data[i+2],data[i+3]]; };

    const ball=[], rims=[], whites=[];
    // Only sample game area (exclude bottom UI ~10% and borders)
    for (let y=50; y<H*0.88; y+=3) {
      for (let x=30; x<W-30; x+=3) {
        const [r,g,b,a]=px(x,y);
        if(a<150)continue;
        if(r>195&&g>80&&g<195&&b<90) ball.push([x,y]);        // orange ball
        if(r>165&&g<75&&b<75) rims.push([x,y]);                // red rim
        if(r>215&&g>215&&b>215) whites.push([x,y]);            // white pixels
      }
    }

    const C = pts => {
      if(!pts.length) return null;
      return [Math.round(pts.reduce((s,p)=>s+p[0],0)/pts.length), Math.round(pts.reduce((s,p)=>s+p[1],0)/pts.length)];
    };

    const ballC = C(ball);

    // Find two basket clusters from rim pixels via k-means-like split
    const findBaskets = (rims) => {
      if (rims.length < 6) return [null, null];
      // Split by largest gap in sorted order (either X or Y depending on layout)
      const byX = [...rims].sort((a,b)=>a[0]-b[0]);
      const byY = [...rims].sort((a,b)=>a[1]-b[1]);

      let maxXGap=0, xSplit=Math.floor(byX.length/2);
      for(let i=1;i<byX.length;i++){const g=byX[i][0]-byX[i-1][0];if(g>maxXGap){maxXGap=g;xSplit=i;}}
      let maxYGap=0, ySplit=Math.floor(byY.length/2);
      for(let i=1;i<byY.length;i++){const g=byY[i][1]-byY[i-1][1];if(g>maxYGap){maxYGap=g;ySplit=i;}}

      // Use whichever axis has the larger gap
      let g1, g2;
      if (maxXGap > maxYGap) {
        g1 = byX.slice(0, xSplit);
        g2 = byX.slice(xSplit);
      } else {
        g1 = byY.slice(0, ySplit);
        g2 = byY.slice(ySplit);
      }
      return [C(g1), C(g2)];
    };

    const [basket1, basket2] = findBaskets(rims);

    // White arc analysis — find white pixels in a ring around the ball
    // The arrowhead is in the sector that has more white density
    let arcAnalysis = null;
    if (ballC && whites.length > 10) {
      // Ring: 40-300px radius from ball center (in canvas coords)
      const ring = whites.filter(p => {
        const d = Math.hypot(p[0]-ballC[0], p[1]-ballC[1]);
        return d > 30 && d < 350;
      });

      if (ring.length > 5) {
        const ringC = C(ring);
        // The ring centroid offset from ball tells us the arc direction
        const dx = (ringC[0] - ballC[0]);
        const dy = (ringC[1] - ballC[1]);

        // Which basket is in the direction (dx, dy) from the ball?
        // Dot product: which basket has better alignment with the arrow direction
        let bestBasket = basket1, bestScore = -Infinity;
        for (const basket of [basket1, basket2]) {
          if (!basket) continue;
          const bx = basket[0] - ballC[0];
          const by = basket[1] - ballC[1];
          // Normalize and dot product
          const len = Math.hypot(bx, by) || 1;
          const arrowLen = Math.hypot(dx, dy) || 1;
          const dot = (dx/arrowLen)*(bx/len) + (dy/arrowLen)*(by/len);
          if (dot > bestScore) { bestScore = dot; bestBasket = basket; }
        }

        arcAnalysis = { ringC: ringC && ringC.map(v=>Math.round(v)), dx: Math.round(dx), dy: Math.round(dy), targetBasket: bestBasket };
      }
    }

    // Convert canvas coords to iframe display coords (divide by 2)
    const toDisplay = pts => pts ? [Math.round(pts[0]*SCALE), Math.round(pts[1]*SCALE)] : null;

    return {
      W, H,
      ballC: ballC && ballC.map(v=>Math.round(v)),
      ballDisplay: toDisplay(ballC),
      basket1: basket1, basket1Display: toDisplay(basket1),
      basket2: basket2, basket2Display: toDisplay(basket2),
      rimCount: rims.length, whiteCount: whites.length,
      arcAnalysis: arcAnalysis ? { ...arcAnalysis, targetBasketDisplay: toDisplay(arcAnalysis.targetBasket) } : null,
    };
  });
}

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
    if (!iframeEl) { await ctx.close(); continue; }
    const bb = await iframeEl.boundingBox();
    total++;

    const cf = page.frames().find(f=>f.url().includes('frame=challenge'));
    const a = cf ? await analyzeChallenge(cf).catch(()=>null) : null;

    console.log(`\n=== Trial ${trial+1} ===`);
    if (a) {
      console.log('Ball (canvas):', a.ballC, '→ display:', a.ballDisplay);
      console.log('Basket1 (canvas):', a.basket1, '→ display:', a.basket1Display);
      console.log('Basket2 (canvas):', a.basket2, '→ display:', a.basket2Display);
      if (a.arcAnalysis) {
        console.log('Arc direction dx:', a.arcAnalysis.dx, 'dy:', a.arcAnalysis.dy);
        console.log('Target basket (canvas):', a.arcAnalysis.targetBasket, '→ display:', a.arcAnalysis.targetBasketDisplay);
      } else {
        console.log('No arc analysis');
      }
    }

    // Click target basket using dynamic coords
    let clickX, clickY;
    if (a?.arcAnalysis?.targetBasketDisplay) {
      const [ix, iy] = a.arcAnalysis.targetBasketDisplay;
      clickX = bb.x + ix;
      clickY = bb.y + iy;
    } else if (a?.basket1Display) {
      const [ix, iy] = a.basket1Display;
      clickX = bb.x + ix;
      clickY = bb.y + iy;
    } else {
      clickX = bb.x + bb.width * 0.5;
      clickY = bb.y + bb.height * 0.6;
    }

    console.log(`Clicking at page (${Math.round(clickX)}, ${Math.round(clickY)})`);
    await page.mouse.click(clickX, clickY);
    await page.waitForTimeout(500);

    // Click Next
    await page.mouse.click(bb.x + bb.width*0.900, bb.y + bb.height*0.947);
    await page.waitForTimeout(3000);

    const cfA = page.frames().find(f=>f.url().includes('frame=challenge'));
    const fb = cfA ? await cfA.evaluate(()=>{const e=document.querySelector('.display-error');return e?e.textContent.trim():'ok';}).catch(()=>'ok') : 'ok';
    console.log('Feedback:', fb);
    if (!fb.includes('try again')) { correct++; console.log('✓'); } else { console.log('✗'); }

    await ctx.close();
  }
  await browser.close();
  console.log(`\n=== ${correct}/${total} correct ===`);
}

main().catch(e=>{console.error(e.message);process.exit(1);});
