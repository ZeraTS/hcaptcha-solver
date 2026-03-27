'use strict';
/**
 * Test script to discover all challenge types served by different sitekeys.
 * Screenshots each challenge and saves to /tmp/hcaptcha_types/.
 */
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
chromium.use(stealth());

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';

const SITEKEYS = [
  { key: 'a9b5fb07-92ff-493f-86fe-352a2803b3df', host: 'discord.com', label: 'discord' },
  { key: '338af34c-7bcb-4c7c-900b-acbec73d7d43', host: 'democaptcha.com', label: 'demo' },
  { key: '4c672d35-0701-42b2-88c3-78380b0db560', host: 'accounts.hcaptcha.com', label: 'hcaptcha_accounts' },
  { key: 'a5f74b19-9e45-40e0-b45d-47ff91b7a6c2', host: 'accounts.hcaptcha.com', label: 'hcaptcha_demo' },
  { key: 'f5561ba9-8f1e-40ca-9b5b-a0b3f719ef34', host: 'accounts.hcaptcha.com', label: 'unknown1' },
];

const OUT_DIR = '/tmp/hcaptcha_types';
fs.mkdirSync(OUT_DIR, { recursive: true });

async function testSitekey(browser, sk, label) {
  const ctx = await browser.newContext({
    userAgent: USER_AGENT,
    viewport: { width: 1366, height: 768 },
    locale: 'en-US',
  });
  const page = await ctx.newPage();
  const results = { label, key: sk.key, challenges: [] };

  page.on('response', async resp => {
    const url = resp.url();
    if (url.includes('getcaptcha')) {
      const body = await resp.body().catch(() => Buffer.alloc(0));
      console.log(`  [getcaptcha] ${label} encrypted=${body[0] !== 0x7b} len=${body.length}`);
    }
  });

  try {
    const url = `https://accounts.hcaptcha.com/demo?sitekey=${encodeURIComponent(sk.key)}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });

    // Wait for and click checkbox
    let cbf = null;
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(400);
      cbf = page.frames().find(f => f.url().includes('frame=checkbox'));
      if (cbf) break;
    }
    if (!cbf) { console.log(`  No checkbox frame for ${label}`); return results; }

    await cbf.waitForSelector('#checkbox', { timeout: 6000 });
    await page.waitForTimeout(500);
    await cbf.click('#checkbox');
    console.log(`  Clicked checkbox for ${label}`);

    // Try multiple clicks to get different challenge types
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.waitForTimeout(4000);

      const cf = page.frames().find(f => f.url().includes('frame=challenge'));
      if (!cf) {
        console.log(`  No challenge frame attempt ${attempt} for ${label}`);
        // Maybe auto-passed - check for token
        continue;
      }

      const info = await cf.evaluate(() => {
        const prompt = document.querySelector('.prompt-text');
        const taskType = document.querySelector('[class*="task-type"], [data-task-type]');
        const canvas = document.querySelector('canvas');
        const imgs = document.querySelectorAll('img');
        const bodyClass = document.body.className;

        // Collect all unique classes
        const allClasses = new Set();
        document.querySelectorAll('[class]').forEach(el => {
          el.classList.forEach(c => allClasses.add(c));
        });

        return {
          prompt: prompt ? prompt.textContent.trim() : null,
          taskType: taskType ? taskType.textContent.trim() : null,
          hasCanvas: !!canvas,
          imgCount: imgs.length,
          bodyClass,
          classes: [...allClasses].join(' '),
          htmlSnippet: document.body.innerHTML.slice(0, 300),
        };
      }).catch(() => null);

      if (!info) continue;

      console.log(`  [${label}] attempt=${attempt} prompt="${info.prompt}" hasCanvas=${info.hasCanvas} imgs=${info.imgCount}`);
      console.log(`    classes: ${info.classes.slice(0, 150)}`);

      // Screenshot
      const iframeEl = await page.$('iframe[src*="frame=challenge"]');
      if (iframeEl) {
        const screenshotPath = path.join(OUT_DIR, `${label}_attempt${attempt}.png`);
        await iframeEl.screenshot({ path: screenshotPath }).catch(() => {});
        console.log(`    saved: ${screenshotPath}`);
      }

      results.challenges.push({
        attempt,
        prompt: info.prompt,
        hasCanvas: info.hasCanvas,
        imgCount: info.imgCount,
        classes: info.classes,
      });

      // Click "refresh" button to get a new challenge type
      try {
        await cf.click('.refresh, .refresh-on, [class*="refresh"]', { timeout: 2000 });
        console.log(`    Clicked refresh`);
      } catch(e) {}
    }
  } catch (e) {
    console.log(`  Error for ${label}:`, e.message.slice(0, 80));
  } finally {
    await ctx.close().catch(() => {});
  }
  return results;
}

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const allResults = [];

  for (const sk of SITEKEYS) {
    console.log(`\n=== Testing ${sk.label} (${sk.key.slice(0,8)}) ===`);
    const r = await testSitekey(browser, sk, sk.label);
    allResults.push(r);
  }

  await browser.close();

  console.log('\n\n=== SUMMARY ===');
  for (const r of allResults) {
    console.log(`\n${r.label} (${r.key.slice(0,8)}):`);
    for (const c of r.challenges) {
      console.log(`  attempt ${c.attempt}: prompt="${c.prompt}" canvas=${c.hasCanvas} imgs=${c.imgCount}`);
    }
  }

  fs.writeFileSync(path.join(OUT_DIR, 'results.json'), JSON.stringify(allResults, null, 2));
  console.log(`\nScreenshots saved to ${OUT_DIR}`);
}

main().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
