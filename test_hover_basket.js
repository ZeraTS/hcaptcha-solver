'use strict';
// Just hover over the dynamically computed basket position and screenshot
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

  await page.screenshot({ path: '/tmp/hover_initial.png' });

  const iframeEl = await page.$('iframe[src*="frame=challenge"]');
  const bb = await iframeEl.boundingBox();
  console.log('iframe BB:', JSON.stringify({ x: Math.round(bb.x), y: Math.round(bb.y), w: Math.round(bb.width), h: Math.round(bb.height) }));

  const cf = page.frames().find(f=>f.url().includes('frame=challenge'));
  const analysis = await cf.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return null;
    const c = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const data = c.getImageData(0, 0, W, H).data;
    const px = (x,y) => { const i=(y*W+x)*4; return [data[i],data[i+1],data[i+2],data[i+3]]; };
    // Get canvas element's actual rendered size and position
    const rect = canvas.getBoundingClientRect();
    const ball=[], rims=[];
    for(let y=50;y<H*0.88;y+=3){
      for(let x=30;x<W-30;x+=3){
        const[r,g,b,a]=px(x,y);
        if(a<150)continue;
        if(r>195&&g>80&&g<195&&b<90)ball.push([x,y]);
        if(r>165&&g<75&&b<75)rims.push([x,y]);
      }
    }
    const C=pts=>pts.length?[Math.round(pts.reduce((s,p)=>s+p[0],0)/pts.length),Math.round(pts.reduce((s,p)=>s+p[1],0)/pts.length)]:null;
    const ballC=C(ball);
    // Split rims into 2 clusters
    const sorted=[...rims].sort((a,b)=>a[0]-b[0]);
    let maxG=0,split=Math.floor(sorted.length/2);
    for(let i=1;i<sorted.length;i++){const g=sorted[i][0]-sorted[i-1][0];if(g>maxG){maxG=g;split=i;}}
    const g1=sorted.slice(0,split), g2=sorted.slice(split);
    return {
      W, H,
      canvasRect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
      ballC, basket1: C(g1), basket2: C(g2),
      rimCount: rims.length, ballCount: ball.length,
    };
  });

  console.log('Analysis:', JSON.stringify(analysis, null, 2));

  // Convert canvas pixel to PAGE coordinates
  // canvas pixel (cx, cy) → iframe display pixel = (cx * rect.w/W + rect.x, cy * rect.h/H + rect.y)
  // → page pixel = iframe display + page origin
  const toPage = (cx, cy) => {
    if (!analysis || !cx) return null;
    const { canvasRect: r, W, H } = analysis;
    const displayX = cx * r.w / W + r.x;
    const displayY = cy * r.h / H + r.y;
    // Add iframe page origin
    return [Math.round(bb.x + displayX), Math.round(bb.y + displayY)];
  };

  if (analysis?.basket1) {
    const [px, py] = toPage(...analysis.basket1) || [0,0];
    console.log(`\nBasket1 page coords: (${px}, ${py})`);
    await page.mouse.move(px, py);
    await page.waitForTimeout(300);
    await page.screenshot({ path: '/tmp/hover_basket1.png' });
  }

  if (analysis?.basket2) {
    const [px, py] = toPage(...analysis.basket2) || [0,0];
    console.log(`Basket2 page coords: (${px}, ${py})`);
    await page.mouse.move(px, py);
    await page.waitForTimeout(300);
    await page.screenshot({ path: '/tmp/hover_basket2.png' });
  }

  if (analysis?.ballC) {
    const [px, py] = toPage(...analysis.ballC) || [0,0];
    console.log(`Ball page coords: (${px}, ${py})`);
    await page.mouse.move(px, py);
    await page.waitForTimeout(300);
    await page.screenshot({ path: '/tmp/hover_ball.png' });
  }

  await browser.close();
  console.log('\nDone. Check /tmp/hover_*.png');
}

main().catch(e=>{console.error(e.message);process.exit(1);});
