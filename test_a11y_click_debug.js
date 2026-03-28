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
  await p.waitForTimeout(5000);
  
  const ie = await p.$('iframe[src*="frame=challenge"]');
  const bb = await ie.boundingBox();
  console.log('iframe:', JSON.stringify(bb));
  
  // Step 1: click info
  await p.mouse.click(bb.x + 27, bb.y + 540);
  await p.waitForTimeout(1500);
  await ie.screenshot({path:'/tmp/dbg_step1_menu.png'});
  console.log('Step 1: menu opened');
  
  // Step 2: click at (135, 352) — should be Accessibility Challenge
  await p.mouse.click(bb.x + 135, bb.y + 352);
  await p.waitForTimeout(3000);
  await ie.screenshot({path:'/tmp/dbg_step2_after.png'});
  console.log('Step 2: after a11y click');
  
  // Check state
  const cf = p.frames().find(f => f.url().includes('frame=challenge'));
  if (cf) {
    const state = await cf.evaluate(() => ({
      prompt: document.querySelector('.prompt-text')?.textContent?.trim()?.slice(0, 80),
      hasInput: !!document.querySelector('input[type="text"]')?.offsetHeight,
      bodySnippet: document.body.innerText?.slice(0, 200),
    })).catch(() => null);
    console.log('State:', JSON.stringify(state, null, 2));
  }
  
  await b.close();
})();
