'use strict';

const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
const { solveTextChallenge } = require('./text_solver');

chromium.use(stealth());

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';

class A11yBrowserSolver {
  constructor(opts = {}) {
    this.debug = opts.debug || false;
    this.proxy = opts.proxy || null;
    this._browser = null;
  }

  log(...args) {
    if (this.debug) console.log('[a11y]', ...args);
  }

  async _ensureBrowser() {
    if (this._browser) return;
    this._browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
  }

  async _poll(fn, timeoutMs = 8000, interval = 150) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try { const r = await fn(); if (r) return r; } catch {}
      await new Promise(r => setTimeout(r, interval));
    }
    return null;
  }

  async solve(sitekey, host, opts = {}) {
    const t0 = Date.now();
    await this._ensureBrowser();

    const pageUrl = opts.pageUrl || `https://accounts.hcaptcha.com/demo?sitekey=${encodeURIComponent(sitekey)}`;

    const ctx = await this._browser.newContext({
      userAgent: UA, viewport: { width: 1366, height: 768 }, locale: 'en-US',
    });
    const page = await ctx.newPage();
    let token = null;

    page.on('response', async resp => {
      if (token) return;
      if (!resp.url().includes('/getcaptcha/') && !resp.url().includes('/checkcaptcha/')) return;
      try {
        const body = await resp.body();
        if (body[0] === 0x7b) {
          const d = JSON.parse(body.toString());
          if (d.generated_pass_UUID) token = d.generated_pass_UUID;
        }
      } catch {}
    });

    try {
      await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 12000 });

      // Wait for and click checkbox
      const cbf = await this._poll(() =>
        page.frames().find(f => f.url().includes('frame=checkbox')) || null, 8000);
      if (!cbf) throw new Error('No checkbox frame');
      await cbf.waitForSelector('#checkbox', { timeout: 4000 });
      await page.waitForTimeout(200);
      await cbf.click('#checkbox');
      this.log('Checkbox', Date.now() - t0, 'ms');

      // Wait for challenge iframe
      const iframeEl = await this._poll(() => page.$('iframe[src*="frame=challenge"]'), 6000);
      if (!iframeEl) throw new Error('No challenge iframe');
      const bb = await iframeEl.boundingBox();

      // Give hCaptcha time to fully render the challenge
      await page.waitForTimeout(2000);

      // Wait for challenge to load
      await this._poll(() => {
        const cf = page.frames().find(f => f.url().includes('frame=challenge'));
        return cf?.evaluate(() => {
          const p = document.querySelector('.prompt-text');
          const c = document.querySelector('canvas');
          return (p?.textContent?.trim()) || (c?.offsetHeight > 0) || null;
        });
      }, 8000, 200);
      this.log('Challenge loaded', Date.now() - t0, 'ms');

      // Inject token capture
      await page.evaluate(() => {
        window.__hcToken = null;
        window.addEventListener('message', e => {
          try {
            const d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
            if (d?.source === 'hcaptcha' && d.label === 'challenge-passed')
              window.__hcToken = d.contents?.response || d.response;
          } catch {}
        });
      });

      // Open menu and click Accessibility Challenge — retry up to 3 times
      let a11yActivated = false;
      for (let menuAttempt = 0; menuAttempt < 3 && !a11yActivated; menuAttempt++) {
        // Click the three-dot menu button (⋮) at bottom-left of challenge frame
        // Anchors from DOM show it at iframe-relative (10, 523) size 35x35
        await page.mouse.click(bb.x + 27, bb.y + 540);
        // Also try the exact DOM anchor position as fallback
        await page.waitForTimeout(500);
        // Check if modal appeared
        const modalCheck = await (page.frames().find(f => f.url().includes('frame=challenge')))?.evaluate(() => {
          const m = document.querySelector('.modal');
          return m && m.offsetHeight > 50;
        }).catch(() => false);
        if (!modalCheck) {
          // Try alternative click position
          await page.mouse.click(bb.x + 12, bb.y + 530);
        }
        await page.waitForTimeout(1500);
        
        // Screenshot to verify menu opened
        try { await iframeEl.screenshot({ path: `/tmp/a11y_menu_attempt_${menuAttempt}.png` }); } catch {}

        // Click "Accessibility Challenge" position
        await page.mouse.click(bb.x + 135, bb.y + 352);
        await page.waitForTimeout(3000);

        // Check if text mode activated
        const cf_chk = page.frames().find(f => f.url().includes('frame=challenge'));
        if (cf_chk) {
          try {
            const hasText = await cf_chk.evaluate(() => {
              const inp = document.querySelector('input[type="text"]');
              const p = (document.querySelector('.prompt-text')?.textContent || '').toLowerCase();
              return !!(inp?.offsetHeight > 0 && (p.includes('number') || p.includes('digit') || p.includes('answer') || p.includes('question')));
            });
            if (hasText) { a11yActivated = true; break; }
          } catch {}
        }
        this.log(`Menu attempt ${menuAttempt + 1} failed, retrying...`);
      }
      
      if (!a11yActivated) {
        try { await iframeEl.screenshot({ path: '/tmp/a11y_solver_debug.png' }); } catch {}
      }
      this.log(a11yActivated ? 'A11y mode active' : 'A11y mode FAILED', Date.now() - t0, 'ms');
      // Wait for text challenge to appear — poll aggressively for up to 15s
      const textReady = await this._poll(async () => {
        const cf = page.frames().find(f => f.url().includes('frame=challenge'));
        if (!cf) return null;
        try {
          const result = await cf.evaluate(() => {
            const inp = document.querySelector('input[type="text"]');
            const prompt = (document.querySelector('.prompt-text')?.textContent || '').toLowerCase();
            const isText = prompt.includes('number') || prompt.includes('digit') || 
              prompt.includes('answer') || prompt.includes('question') || prompt.includes('using only');
            return inp && inp.offsetHeight > 0 && isText;
          });
          return result || null;
        } catch { return null; }
      }, 15000, 200);

      if (!textReady) throw new Error('Text challenge did not load');
      this.log('Text mode active', Date.now() - t0, 'ms');

      // Solve loop
      for (let round = 0; round < 5; round++) {
        if (token) break;
        const pmTok = await page.evaluate(() => window.__hcToken).catch(() => null);
        if (pmTok) { token = pmTok; break; }

        const cf = page.frames().find(f => f.url().includes('frame=challenge'));
        if (!cf) break;

        const bodyText = await cf.evaluate(() => document.body.innerText || '').catch(() => '');
        const lines = bodyText.split('\n').map(l => l.trim()).filter(Boolean);

        let question = '';
        for (const line of lines) {
          if (/^(answer|please|respond)/i.test(line) || line.length < 15) continue;
          if (/^(EN|Skip|Next)$/i.test(line) || line.includes('try again')) break;
          question = line; break;
        }

        if (!question) { await page.waitForTimeout(300); continue; }

        const answer = solveTextChallenge(question);
        if (!answer) { this.log('Unsupported:', question); await page.waitForTimeout(300); continue; }

        this.log(`R${round + 1}: "${question.slice(0, 50)}..." → ${answer}`);

        const sel = 'input[type="text"], textarea';
        await cf.evaluate(s => { const e = document.querySelector(s); if (e) e.value = ''; }, sel);
        await cf.fill(sel, answer);

        // Click submit
        const submitted = await cf.evaluate(() => {
          const btn = document.querySelector('.button-submit');
          if (btn) { btn.click(); return true; } return false;
        }).catch(() => false);
        if (!submitted) await page.mouse.click(bb.x + 468, bb.y + 540);

        // Wait for token or new question
        await this._poll(async () => {
          if (token) return true;
          const t = await page.evaluate(() => window.__hcToken).catch(() => null);
          if (t) { token = t; return true; }
          const newText = await cf.evaluate(() => document.body.innerText || '').catch(() => '');
          return newText !== bodyText ? 'next' : null;
        }, 5000, 150);

        if (token) break;
      }

      if (!token) {
        const tv = await page.evaluate(() =>
          document.querySelector('textarea[name="h-captcha-response"]')?.value
        ).catch(() => null);
        if (tv?.length > 10) token = tv;
      }

      if (!token) throw new Error('No token after 5 rounds');
      this.log(`Done in ${Date.now() - t0}ms`);
      return { token, elapsed: Date.now() - t0, type: 'a11y_text_challenge' };

    } finally {
      await ctx.close().catch(() => {});
    }
  }

  async close() {
    if (this._browser) { await this._browser.close().catch(() => {}); this._browser = null; }
  }
}

module.exports = { A11yBrowserSolver };
