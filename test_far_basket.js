'use strict';
// Hypothesis: click the basket FARTHER from the ball (not the closest one)
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
chromium.use(stealth());
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';

async function analyzeAndClick(cf, page, bb) {
  const a = await cf.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return null;
    const c = canvas.getContext('2d');
    const W=canvas.width, H=canvas.height;
    const rect=canvas.getBoundingClientRect();
    const data=c.getImageData(0,0,W,H).data;
    const px=(x,y)=>{const i=(y*W+x)*4;return[data[i],data[i+1],data[i+2],data[i+3]];};
    const ball=[], rims=[];
    for(let y=50;y<H*0.88;y+=3){
      for(let x=30;x<W-30;x+=3){
        const[r,g,b,a]=px(x,y);
        if(a<150)continue;
        if(r>195&&g>80&&g<195&&b<90)ball.push([x,y]);
        if(r>165&&g<75&&b<75)rims.push([x,y]);
      }
    }
    const C=pts=>pts.length?[pts.reduce((s,p)=>s+p[0],0)/pts.length,pts.reduce((s,p)=>s+p[1],0)/pts.length]:null;
    const ballC=C(ball);
    // Split rims into 2 clusters by largest gap
    const sorted=[...rims].sort((a,b)=>a[0]-b[0]);
    let maxG=0,split=Math.floor(sorted.length/2);
    for(let i=1;i<sorted.length;i++){const g=sorted[i][0]-sorted[i-1][0];if(g>maxG){maxG=g;split=i;}}
    let g1=sorted.slice(0,split), g2=sorted.slice(split);
    if(g1.length<3||g2.length<3) {
      // Try Y split instead
      const byY=[...rims].sort((a,b)=>a[1]-b[1]);
      let maxGY=0,splitY=Math.floor(byY.length/2);
      for(let i=1;i<byY.length;i++){const g=byY[i][1]-byY[i-1][1];if(g>maxGY){maxGY=g;splitY=i;}}
      g1=byY.slice(0,splitY); g2=byY.slice(splitY);
    }
    const basket1=C(g1), basket2=C(g2);
    const toPage=(cx,cy)=>[cx*rect.width/W+rect.x, cy*rect.height/H+rect.y];
    return {
      W,H,ballC,basket1,basket2,
      basket1Page: basket1?toPage(...basket1):null,
      basket2Page: basket2?toPage(...basket2):null,
      rimCount:rims.length,ballCount:ball.length,
    };
  }).catch(()=>null);

  if (!a || !a.ballC || !a.basket1 || !a.basket2) return null;

  // Distance from ball to each basket
  const d1 = Math.hypot(a.ballC[0]-a.basket1[0], a.ballC[1]-a.basket1[1]);
  const d2 = Math.hypot(a.ballC[0]-a.basket2[0], a.ballC[1]-a.basket2[1]);

  // Pick FARTHER basket (hypothesis: ball moving AWAY from close basket)
  const targetPage = d1 > d2 ? a.basket1Page : a.basket2Page;

  console.log(`  Ball:(${Math.round(a.ballC[0])},${Math.round(a.ballC[1])}) Basket1:(${Math.round(a.basket1[0])},${Math.round(a.basket1[1])}) d1=${Math.round(d1)} Basket2:(${Math.round(a.basket2[0])},${Math.round(a.basket2[1])}) d2=${Math.round(d2)}`);
  console.log(`  → Picking FARTHER basket (d=${d1>d2?Math.round(d1):Math.round(d2)})`);
  console.log(`  Target page: (${Math.round(targetPage[0])}, ${Math.round(targetPage[1])})`);

  return [bb.x + targetPage[0], bb.y + targetPage[1]];
}

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  let correct=0, total=0;

  for (let trial=0; trial<8; trial++) {
    const ctx = await browser.newContext({ userAgent: UA, viewport: {width:1366,height:768} });
    const page = await ctx.newPage();
    await page.goto('https://accounts.hcaptcha.com/demo?sitekey=338af34c-7bcb-4c7c-900b-acbec73d7d43', {waitUntil:'domcontentloaded',timeout:15000});
    let cbf=null;
    for(let i=0;i<20;i++){await page.waitForTimeout(400);cbf=page.frames().find(f=>f.url().includes('frame=checkbox'));if(cbf)break;}
    await cbf.waitForSelector('#checkbox',{timeout:6000});
    await page.waitForTimeout(600);
    await cbf.click('#checkbox');
    await page.waitForTimeout(6000);

    const iframeEl=await page.$('iframe[src*="frame=challenge"]');
    if(!iframeEl){await ctx.close();continue;}
    const bb=await iframeEl.boundingBox();
    const cf=page.frames().find(f=>f.url().includes('frame=challenge'));
    if(!cf){await ctx.close();continue;}
    total++;

    console.log(`\nTrial ${trial+1}:`);
    const clickCoords = await analyzeAndClick(cf, page, bb);

    if (clickCoords) {
      await page.mouse.click(...clickCoords);
    } else {
      // fallback
      await page.mouse.click(bb.x+bb.width*0.5, bb.y+bb.height*0.6);
    }
    await page.waitForTimeout(500);

    // Click Next
    await page.mouse.click(bb.x+bb.width*0.900, bb.y+bb.height*0.947);
    await page.waitForTimeout(3000);

    const cfA=page.frames().find(f=>f.url().includes('frame=challenge'));
    const fb=cfA?await cfA.evaluate(()=>{const e=document.querySelector('.display-error');return e?e.textContent.trim():'ok';}).catch(()=>'ok'):'ok';
    if(!fb.includes('try again')){correct++;console.log('  ✓ CORRECT');}
    else{console.log('  ✗ WRONG:',fb);}

    await ctx.close();
  }
  await browser.close();
  console.log(`\n=== ${correct}/${total} correct ===`);
}

main().catch(e=>{console.error(e.message);process.exit(1);});
