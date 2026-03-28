'use strict';
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
chromium.use(stealth());
(async () => {
  const b = await chromium.launch({headless:true, args:['--no-sandbox']});
  const c = await b.newContext({userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', viewport:{width:1366,height:768}});
  const p = await c.newPage();
  await p.goto('https://accounts.hcaptcha.com/demo?sitekey=a9b5fb07-92ff-493f-86fe-352a2803b3df',{waitUntil:'domcontentloaded',timeout:15000});
  let cbf = null;
  for(let i=0;i<20;i++){await p.waitForTimeout(400); cbf=p.frames().find(f=>f.url().includes('frame=checkbox')); if(cbf) break;}
  await cbf.waitForSelector('#checkbox',{timeout:5000});
  await p.waitForTimeout(500);
  await cbf.click('#checkbox');
  console.log('Clicked checkbox');
  await p.waitForTimeout(5000);
  const ie = await p.$('iframe[src*="frame=challenge"]');
  const bb = await ie.boundingBox();
  console.log('iframe:', bb);
  
  // Screenshot before menu
  await ie.screenshot({path:'/tmp/step1_challenge.png'});
  
  // Try clicking info via (27, 540) — the original working position
  console.log('Clicking at', bb.x+27, bb.y+540);
  await p.mouse.click(bb.x + 27, bb.y + 540);
  await p.waitForTimeout(2000);
  await ie.screenshot({path:'/tmp/step2_menu.png'});
  console.log('Saved step2_menu.png');
  
  await b.close();
})();
