'use strict';
/**
 * Canvas analysis v4 — read circular arrow direction by asymmetry.
 * The circular arrow has an arrowhead on one end which creates an asymmetry
 * in white pixel density. Find the center of the arrow circle, then determine
 * which side (upper/lower half relative to basket positions) has more white pixels.
 */
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
chromium.use(stealth());
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';

async function analyzeCanvas(cf) {
  return cf.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return null;
    const c = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    // Only analyze game area (ignore bottom 15% which is UI chrome)
    const GAME_H = Math.floor(H * 0.85);
    const data = c.getImageData(0, 0, W, GAME_H).data;
    const px = (x, y) => { const i=(y*W+x)*4; return [data[i],data[i+1],data[i+2],data[i+3]]; };

    const ball=[], rims=[], whitePts=[];
    for (let y = 50; y < GAME_H; y += 2) {
      for (let x = 50; x < W-50; x += 2) {
        const [r,g,b,a] = px(x,y);
        if (a < 150) continue;
        if (r>200 && g>80 && g<190 && b<90) ball.push([x,y]);  // orange ball
        if (r>170 && g<80 && b<80) rims.push([x,y]);            // red rim
        if (r>220 && g>220 && b>220) whitePts.push([x,y]);      // white (arrow indicator)
      }
    }

    const centroid = pts => {
      if (!pts.length) return null;
      const cx = pts.reduce((s,p)=>s+p[0],0)/pts.length;
      const cy = pts.reduce((s,p)=>s+p[1],0)/pts.length;
      return [Math.round(cx), Math.round(cy)];
    };

    const ballC = centroid(ball);

    // Find white pixels that form the circular arrow
    // The arrow is near the ball, in the range 150-600px radius from ball center
    const arrowPts = ballC
      ? whitePts.filter(p => {
          const d = Math.hypot(p[0]-ballC[0], p[1]-ballC[1]);
          return d > 30 && d < 400;
        })
      : whitePts.filter(p => {
          return p[0] > W*0.2 && p[0] < W*0.8 && p[1] < GAME_H*0.7;
        });

    const arrowC = centroid(arrowPts);

    // Find the two rim clusters (2 baskets)
    const rimsSorted = [...rims].sort((a,b)=>a[1]-b[1]);
    let upperRims=[], lowerRims=[];
    if (rimsSorted.length >= 4) {
      let maxGap=0, split=Math.floor(rimsSorted.length/2);
      for (let i=1;i<rimsSorted.length;i++) {
        const g=rimsSorted[i][1]-rimsSorted[i-1][1];
        if(g>maxGap){maxGap=g;split=i;}
      }
      upperRims=rimsSorted.slice(0,split);
      lowerRims=rimsSorted.slice(split);
    }
    const upperC = centroid(upperRims);
    const lowerC = centroid(lowerRims);

    // Key insight: determine which basket the ARROW is "pointing toward"
    // by seeing which basket center is closest to the arrowhead direction.
    // The arrowhead creates more white pixels on the side it points to.
    // Split arrow pixels by which quadrant relative to ball they're in.
    let upArrowPts=0, downArrowPts=0;
    if (ballC && arrowPts.length > 0) {
      for (const p of arrowPts) {
        if (p[1] < ballC[1]) upArrowPts++;
        else downArrowPts++;
      }
    }

    // Determine prediction: more white pixels toward upper basket → upper direction
    let prediction = null;
    if (upArrowPts !== downArrowPts) {
      prediction = upArrowPts > downArrowPts ? 'upper' : 'lower';
    }
    if (!prediction && arrowC && upperC && lowerC) {
      const dU = Math.hypot(arrowC[0]-upperC[0], arrowC[1]-upperC[1]);
      const dL = Math.hypot(arrowC[0]-lowerC[0], arrowC[1]-lowerC[1]);
      prediction = dU < dL ? 'upper' : 'lower';
    }

    return {
      W, H, GAME_H,
      ballC, arrowC,
      arrowCount: arrowPts.length,
      upArrowPts, downArrowPts,
      upperC, lowerC,
      rimCount: rims.length,
      prediction,
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

    const cf = page.frames().find(f=>f.url().includes('frame=challenge'));
    if(!cf){await ctx.close();continue;}

    const a = await analyzeCanvas(cf);
    if(!a){await ctx.close();continue;}
    total++;

    console.log(`\n=== Trial ${trial+1} ===`);
    console.log(`Ball:${a.ballC} Arrow:${a.arrowC} arrowPts:${a.arrowCount}`);
    console.log(`Upper arrows:${a.upArrowPts} Lower arrows:${a.downArrowPts}`);
    console.log(`UpperBasket:${a.upperC} LowerBasket:${a.lowerC}`);
    console.log(`→ Prediction: ${a.prediction}`);

    const iframeEl = await page.$('iframe[src*="frame=challenge"]');
    const bb = await iframeEl.boundingBox();
    const coords = {
      upper: {xPct:0.337, yPct:0.368},
      lower: {xPct:0.202, yPct:0.711},
    };
    const coord = coords[a.prediction||'lower'];
    await page.mouse.click(bb.x+bb.width*coord.xPct, bb.y+bb.height*coord.yPct);
    await page.waitForTimeout(500);
    await page.mouse.click(bb.x+bb.width*0.900, bb.y+bb.height*0.947);
    await page.waitForTimeout(3000);

    const cfA = page.frames().find(f=>f.url().includes('frame=challenge'));
    const fb = cfA ? await cfA.evaluate(()=>{const e=document.querySelector('.display-error');return e?e.textContent.trim():'ok';}).catch(()=>'ok') : 'ok';
    const isCorrect = !fb.includes('try again');
    if(isCorrect){correct++;console.log('✓ CORRECT!');}
    else{console.log('✗ WRONG — feedback:',fb);}

    await ctx.close();
  }
  await browser.close();
  console.log(`\n=== SUMMARY: ${correct}/${total} correct ===`);
}

main().catch(e=>{console.error(e.message);process.exit(1);});
