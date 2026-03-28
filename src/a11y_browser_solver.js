'use strict';

/**
 * a11y_browser_solver.js — Solve hCaptcha via accessibility text challenges using Playwright.
 *
 * Flow:
 *   1. Navigate to page with hCaptcha widget
 *   2. Click checkbox to trigger challenge
 *   3. Open info menu → click "Accessibility Challenge"
 *   4. Parse the text question from the DOM
 *   5. Compute answer programmatically
 *   6. Type answer into input field
 *   7. Submit and capture token
 *
 * No image classification. No cookies. Works on any enterprise site with a11y_challenge:true.
 */

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
    if (this.debug) console.log('[a11y-browser]', ...args);
  }

  async _ensureBrowser() {
    if (this._browser) return;
    const launchOpts = {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    };
    if (this.proxy) {
      launchOpts.proxy = { server: this.proxy, bypass: '127.0.0.1,localhost' };
    }
    this._browser = await chromium.launch(launchOpts);
    this.log('Browser launched');
  }

  async solve(sitekey, host, opts = {}) {
    const startTime = Date.now();
    await this._ensureBrowser();

    const pageUrl = opts.pageUrl || `https://accounts.hcaptcha.com/demo?sitekey=${encodeURIComponent(sitekey)}`;
    this.log(`Solving sitekey=${sitekey} url=${pageUrl}`);

    const ctx = await this._browser.newContext({
      userAgent: UA,
      viewport: { width: 1366, height: 768 },
      locale: 'en-US',
      timezoneId: 'America/New_York',
    });

    const page = await ctx.newPage();
    let capturedToken = null;

    // Intercept responses for token
    page.on('response', async resp => {
      if (!resp.url().includes('/getcaptcha/') && !resp.url().includes('/checkcaptcha/')) return;
      try {
        const body = await resp.body();
        if (body[0] === 0x7b) {
          const data = JSON.parse(body.toString());
          if (data.generated_pass_UUID && !capturedToken) {
            capturedToken = data.generated_pass_UUID;
            this.log('Token captured:', capturedToken.slice(0, 40));
          }
        }
      } catch (e) {}
    });

    try {
      await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });

      // Wait for checkbox frame
      let cbf = null;
      for (let i = 0; i < 20; i++) {
        await page.waitForTimeout(400);
        cbf = page.frames().find(f => f.url().includes('frame=checkbox'));
        if (cbf) break;
      }
      if (!cbf) throw new Error('Checkbox frame not found');

      // Click checkbox
      await cbf.waitForSelector('#checkbox', { timeout: 6000 });
      this.log('Clicking checkbox');
      await page.waitForTimeout(400 + Math.random() * 300);
      await cbf.click('#checkbox');
      await page.waitForTimeout(4000);

      // Get challenge iframe position
      const iframeEl = await page.$('iframe[src*="frame=challenge"]');
      if (!iframeEl) throw new Error('Challenge iframe not found');
      const bb = await iframeEl.boundingBox();
      if (!bb) throw new Error('No iframe bounding box');

      // Also inject token capture via postMessage
      await page.evaluate(() => {
        window.__hcToken = null;
        window.addEventListener('message', (e) => {
          try {
            const d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
            if (d?.source === 'hcaptcha' && d.label === 'challenge-passed') {
              window.__hcToken = d.contents?.response || d.response;
            }
          } catch (_) {}
        });
      });

      // Retry loop — solve up to 3 text challenges
      for (let attempt = 0; attempt < 5; attempt++) {
        this.log(`\nAttempt ${attempt + 1}/5`);

        if (attempt === 0) {
          // First attempt: open the accessibility menu
          this.log('Opening accessibility menu...');
          await page.mouse.click(bb.x + 27, bb.y + 540);
          await page.waitForTimeout(1200);

          this.log('Clicking Accessibility Challenge...');
          await page.mouse.click(bb.x + 135, bb.y + 352);
          await page.waitForTimeout(4000);
        } else {
          // Subsequent attempts: we're already on text challenge, just wait for new question
          this.log('Waiting for new text challenge...');
          await page.waitForTimeout(3000);
        }

        // Check if we got a token already (some sites auto-pass on a11y)
        if (capturedToken) break;
        const pmToken = await page.evaluate(() => window.__hcToken).catch(() => null);
        if (pmToken) { capturedToken = pmToken; break; }

        // Read the text challenge from the DOM
        const cf = page.frames().find(f => f.url().includes('frame=challenge'));
        if (!cf) { this.log('No challenge frame'); continue; }

        const challengeText = await cf.evaluate(() => {
          const prompt = document.querySelector('.prompt-text');
          const body = document.body.innerText || '';
          // The question is usually after the prompt, before the input
          // Extract everything between the prompt header and the input/controls
          return {
            prompt: prompt?.textContent?.trim() || '',
            bodyText: body.slice(0, 500),
          };
        }).catch(() => null);

        if (!challengeText) { this.log('Could not read challenge'); continue; }
        this.log('Prompt:', challengeText.prompt);

        // Extract the actual question from bodyText
        // Format: "Answer using digits only for the question below.\n\nQUESTION TEXT\n\nEN\n..."
        const lines = challengeText.bodyText.split('\n').map(l => l.trim()).filter(Boolean);
        // Find the question line (after prompt, before EN/Skip)
        let question = '';
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].startsWith('Answer') || lines[i].startsWith('Please')) continue;
          if (lines[i] === 'EN' || lines[i] === 'Skip' || lines[i].includes('try again')) break;
          if (lines[i].length > 10) {
            question = lines[i];
            break;
          }
        }

        if (!question) {
          this.log('Could not extract question from:', lines.slice(0, 5));
          continue;
        }

        this.log('Question:', question);

        // Solve it
        const answer = solveTextChallenge(question);
        if (!answer) {
          this.log('Could not solve question — unsupported type');
          continue;
        }

        this.log('Answer:', answer);

        // Type the answer into the input field
        const inputSel = 'input[type="text"], input:not([type]), textarea';
        try {
          await cf.waitForSelector(inputSel, { timeout: 3000 });
          // Clear existing value first
          await cf.evaluate((sel) => {
            const el = document.querySelector(sel);
            if (el) el.value = '';
          }, inputSel);
          await cf.fill(inputSel, answer);
          this.log('Typed answer');
        } catch (e) {
          this.log('Could not find/fill input:', e.message);
          continue;
        }

        // Submit — try clicking verify/submit/next button, fall back to Enter
        await page.waitForTimeout(500);
        
        // Look for submit button in the challenge frame
        const submitClicked = await cf.evaluate(() => {
          // Try various submit button selectors
          const selectors = [
            '.button-submit',
            'button[type="submit"]',
            '[aria-label*="Verify"]',
            '[aria-label*="Submit"]',
            '[title*="Verify"]',
            '[title*="Submit"]',
            '[title*="Next"]',
          ];
          for (const sel of selectors) {
            const btn = document.querySelector(sel);
            if (btn) {
              btn.click();
              return sel;
            }
          }
          return null;
        }).catch(() => null);

        if (submitClicked) {
          this.log('Clicked submit button:', submitClicked);
        } else {
          // Fallback: click the "Skip" area which might now say "Verify" or "Next"
          // The verify button is at bottom-right of iframe (~x=468, y=540)
          this.log('Clicking verify button area...');
          await page.mouse.click(bb.x + 468, bb.y + 540);
        }
        this.log('Submitted');

        // Wait for token
        await page.waitForTimeout(5000);

        if (!capturedToken) {
          const t = await page.evaluate(() => window.__hcToken).catch(() => null);
          if (t) capturedToken = t;
        }

        // Also check textarea value on the parent page
        if (!capturedToken) {
          const textareaVal = await page.evaluate(() => {
            const el = document.querySelector('textarea[name="h-captcha-response"]');
            return el?.value || null;
          }).catch(() => null);
          if (textareaVal && textareaVal.length > 10) capturedToken = textareaVal;
        }

        if (capturedToken) break;
        this.log('No token yet — may need another challenge round');
      }

      if (!capturedToken) {
        throw new Error('Failed to obtain token after 3 attempts');
      }

      return {
        token: capturedToken,
        elapsed: Date.now() - startTime,
        type: 'a11y_text_challenge',
      };

    } finally {
      await ctx.close().catch(() => {});
    }
  }

  async close() {
    if (this._browser) {
      await this._browser.close().catch(() => {});
      this._browser = null;
    }
  }
}

module.exports = { A11yBrowserSolver };
