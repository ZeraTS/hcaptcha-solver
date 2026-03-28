'use strict';

const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
const { solveTextChallenge } = require('./text_solver');

chromium.use(stealth());

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';

class A11yFastSolver {
  constructor(opts = {}) {
    this.debug = opts.debug || false;
    this.proxy = opts.proxy || null;
    this._browser = null;
  }

  log(...args) { if (this.debug) console.log('[a11y]', ...args); }

  async warmup() {
    if (this._browser) return;
    this._browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
             '--disable-gpu', '--disable-software-rasterizer'],
    });
    this.log('Browser warm');
  }

  async close() {
    if (this._browser) { await this._browser.close().catch(() => {}); this._browser = null; }
  }

  /** Get the challenge frame. */
  _cf(page) { return page.frames().find(f => f.url().includes('frame=challenge')); }

  async solve(sitekey, host, opts = {}) {
    const t0 = Date.now();
    const ms = () => Date.now() - t0;
    await this.warmup();

    const pageUrl = opts.pageUrl || `https://accounts.hcaptcha.com/demo?sitekey=${encodeURIComponent(sitekey)}`;
    const ctx = await this._browser.newContext({ userAgent: UA, viewport: { width: 1366, height: 768 }, locale: 'en-US' });
    const page = await ctx.newPage();
    let token = null;

    page.on('response', async resp => {
      if (token) return;
      if (!resp.url().includes('/getcaptcha/') && !resp.url().includes('/checkcaptcha/')) return;
      try { const b = await resp.body(); if (b[0]===0x7b) { const d=JSON.parse(b.toString()); if(d.generated_pass_UUID) token=d.generated_pass_UUID; } } catch {}
    });

    try {
      await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });

      // Checkbox
      let cbf = null;
      for (let i = 0; i < 40 && !cbf; i++) { await new Promise(r=>setTimeout(r,100)); cbf = page.frames().find(f=>f.url().includes('frame=checkbox')); }
      if (!cbf) throw new Error('No checkbox');
      await cbf.waitForSelector('#checkbox', { timeout: 3000 });
      await cbf.click('#checkbox');
      this.log('Checkbox', ms());

      // Wait for challenge frame content
      let cf = null;
      for (let i = 0; i < 50; i++) {
        await new Promise(r=>setTimeout(r,100));
        cf = this._cf(page);
        if (!cf) continue;
        const ready = await cf.evaluate(() => {
          const p = document.querySelector('.prompt-text');
          return p && p.textContent.trim().length > 5;
        }).catch(() => false);
        if (ready) break;
      }
      if (!cf) throw new Error('No challenge');
      this.log('Challenge', ms());

      // Token listener
      await page.evaluate(() => { window.__t = null; window.addEventListener('message', e => { try { const d = typeof e.data==='string'?JSON.parse(e.data):e.data; if(d?.source==='hcaptcha'&&d.label==='challenge-passed') window.__t=d.contents?.response||d.response; } catch{} }); });

      // ── Open accessibility menu ──
      // Click info button via DOM (works reliably inside the frame)
      await cf.evaluate(() => {
        const sels = ['.info-on', '.info-off', '.info-btn', '[title*="About"]'];
        for (const s of sels) { const el = document.querySelector(s); if (el?.offsetHeight > 0) { el.click(); return; } }
      });
      await new Promise(r=>setTimeout(r, 1000));

      // ── Click "Accessibility Challenge" ──
      // Menu items are canvas-rendered. We need to dispatch mouse events
      // at the right iframe-relative coordinates.
      // Modal is at ~(82, 235). "Accessibility Challenge" is ~117px below modal top.
      // Use dispatchEvent on the canvas to simulate clicks at those coordinates.
      
      let textMode = false;
      
      const modalY = await cf.evaluate(() => {
        const m = document.querySelector('.modal');
        return m ? m.getBoundingClientRect().y : 235;
      }).catch(() => 235);
      
      this.log('Modal y:', Math.round(modalY));

      // Try clicking at different y offsets within the iframe using dispatchEvent
      for (const yOff of [115, 95, 135, 75]) {
        const targetY = modalY + yOff;
        
        // Dispatch a real mouse click event inside the iframe at these coordinates
        await cf.evaluate(({ x, y }) => {
          const el = document.elementFromPoint(x, y);
          if (el) {
            el.dispatchEvent(new MouseEvent('mousedown', { clientX: x, clientY: y, bubbles: true }));
            el.dispatchEvent(new MouseEvent('mouseup', { clientX: x, clientY: y, bubbles: true }));
            el.dispatchEvent(new MouseEvent('click', { clientX: x, clientY: y, bubbles: true }));
          }
        }, { x: 150, y: targetY });
        
        await new Promise(r=>setTimeout(r, 1200));
        
        // Check for text challenge
        try {
          textMode = await cf.evaluate(() => {
            const inp = document.querySelector('input[type="text"]');
            const p = (document.querySelector('.prompt-text')?.textContent || '').toLowerCase();
            return !!(inp?.offsetHeight > 0 && (p.includes('number') || p.includes('digit') || p.includes('question') || p.includes('answer')));
          });
          if (textMode) { this.log('Text mode at offset', yOff); break; }
        } catch {}
        
        // Close any accidental dialogs + re-open menu
        await cf.evaluate(() => {
          const c = [...document.querySelectorAll('*')].find(el => el.textContent?.trim() === 'Cancel');
          if (c) c.click();
        }).catch(() => {});
        await new Promise(r=>setTimeout(r, 300));
        await cf.evaluate(() => {
          const sels = ['.info-on', '.info-off', '.info-btn'];
          for (const s of sels) { const el = document.querySelector(s); if (el?.offsetHeight > 0) { el.click(); return; } }
        }).catch(() => {});
        await new Promise(r=>setTimeout(r, 800));
      }

      if (!textMode) throw new Error('Text mode failed');
      this.log('Text active', ms());

      // ── Solve rounds ──
      for (let round = 0; round < 5; round++) {
        if (token) break;
        const pt = await page.evaluate(() => window.__t).catch(() => null);
        if (pt) { token = pt; break; }

        cf = this._cf(page);
        if (!cf) break;

        const body = await cf.evaluate(() => document.body.innerText || '').catch(() => '');
        const lines = body.split('\n').map(l => l.trim()).filter(l => l.length > 0);

        let q = '';
        for (const l of lines) {
          if (/^(answer|please|respond)/i.test(l) || l.length < 15) continue;
          if (/^(EN|Skip|Next)$/i.test(l) || l.includes('try again')) break;
          q = l; break;
        }
        if (!q) { await new Promise(r=>setTimeout(r,200)); continue; }

        const ans = solveTextChallenge(q);
        if (!ans) { this.log('Unknown:', q); continue; }
        this.log(`R${round+1}: ${ans} (${ms()}ms)`);

        // Type + submit
        await cf.evaluate(() => { const e = document.querySelector('input[type="text"]'); if(e){e.value='';e.dispatchEvent(new Event('input',{bubbles:true}));} }).catch(()=>{});
        await cf.type('input[type="text"]', ans, { delay: 0 });
        await cf.evaluate(() => { const b = document.querySelector('.button-submit'); if(b) b.click(); }).catch(()=>{});

        // Wait for token or new question
        const prevBody = body;
        for (let i = 0; i < 25; i++) {
          await new Promise(r=>setTimeout(r,120));
          if (token) break;
          const t2 = await page.evaluate(() => window.__t).catch(() => null);
          if (t2) { token = t2; break; }
          const nb = await cf.evaluate(() => document.body.innerText || '').catch(() => '');
          if (nb !== prevBody) break;
        }
      }

      if (!token) {
        const tv = await page.evaluate(() => document.querySelector('textarea[name="h-captcha-response"]')?.value).catch(() => null);
        if (tv?.length > 10) token = tv;
      }

      if (!token) throw new Error('No token');
      this.log('Done', ms() + 'ms');
      return { token, elapsed: ms(), type: 'a11y_text_challenge' };

    } finally {
      await ctx.close().catch(() => {});
    }
  }
}

module.exports = { A11yFastSolver };
