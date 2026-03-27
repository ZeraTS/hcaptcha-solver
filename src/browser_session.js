'use strict';

/**
 * BrowserSession — Playwright + stealth for hCaptcha.
 *
 * Handles three challenge types:
 *   1. Auto-solve (test/easy sitekeys): token captured from network response
 *   2. image_label_binary: extracts task images, classifies with vision AI, submits
 *   3. image_drag_drop / shape puzzle: screenshots challenge, uses vision AI to
 *      identify target position, performs Playwright drag operation
 *
 * Uses accounts.hcaptcha.com/demo?sitekey=XXX as the host page for any sitekey.
 */

const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
const path = require('path');
const fs = require('fs');
const https = require('https');

chromium.use(stealth());

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';
const SOLVE_TIMEOUT_MS = 45000;

function getPageUrl(sitekey) {
  return `https://accounts.hcaptcha.com/demo?sitekey=${encodeURIComponent(sitekey)}`;
}

/**
 * Ask Claude vision to identify the correct drag target position.
 * Returns: { position: 1|2|3|4, confidence: number }
 * Positions: 1=top-left, 2=top-right, 3=bottom-left, 4=bottom-right
 */
async function askVisionForDragPosition(screenshotBuffer, apiKey) {
  const base64 = screenshotBuffer.toString('base64');

  const body = JSON.stringify({
    model: 'claude-haiku-4-5',
    max_tokens: 256,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: 'image/png', data: base64 },
        },
        {
          type: 'text',
          text: `This is an hCaptcha drag-to-match puzzle. There is a piece on the right side labeled "Move" that needs to be dragged to its matching position in the grid on the left.

The grid has 4 positions:
- Position 1: top-left
- Position 2: top-right  
- Position 3: bottom-left
- Position 4: bottom-right

Identify which grid position the draggable piece (on the right) matches based on color, shape, and texture. Respond with ONLY a JSON object: {"position": <1|2|3|4>, "confidence": <0-1>}`,
        },
      ],
    }],
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const resp = JSON.parse(data);
          if (resp.error) return reject(new Error('Claude: ' + resp.error.message));
          const text = resp.content[0].text.trim();
          const match = text.match(/\{[^}]+\}/);
          if (!match) return reject(new Error('No JSON in Claude response: ' + text));
          const result = JSON.parse(match[0]);
          resolve({ position: result.position || 1, confidence: result.confidence || 0 });
        } catch (e) {
          reject(new Error('Claude parse error: ' + e.message));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Ask Claude vision to classify binary image tasks.
 * Returns array of 'true'/'false' answers.
 */
async function askVisionForBinaryTasks(screenshots, question, apiKey) {
  const content = [
    {
      type: 'text',
      text: `hCaptcha task: "${question}"\n\nFor each image (1-${screenshots.length}), answer "true" if it matches the description, "false" if not.\nRespond ONLY with a JSON array: ["true","false","true",...]`,
    },
  ];

  for (let i = 0; i < screenshots.length; i++) {
    const base64 = screenshots[i].toString('base64');
    content.push({ type: 'text', text: `Image ${i + 1}:` });
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: base64 } });
  }

  const body = JSON.stringify({
    model: 'claude-haiku-4-5',
    max_tokens: 256,
    messages: [{ role: 'user', content }],
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const resp = JSON.parse(data);
          if (resp.error) return reject(new Error('Claude: ' + resp.error.message));
          const text = resp.content[0].text.trim();
          const match = text.match(/\[[\s\S]*\]/);
          if (!match) return reject(new Error('No array in Claude response: ' + text));
          const arr = JSON.parse(match[0]);
          resolve(arr.map(a => String(a).toLowerCase() === 'true' ? 'true' : 'false'));
        } catch (e) {
          reject(new Error('Claude parse error: ' + e.message));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

class BrowserSession {
  constructor(opts = {}) {
    this.debug = opts.debug || false;
    this.proxy = opts.proxy || null;
    this.anthropicApiKey = opts.anthropicApiKey || process.env.ANTHROPIC_API_KEY || '';
    this._browser = null;
  }

  log(...args) {
    if (this.debug) console.log('[browser-session]', ...args);
  }

  async _ensureBrowser() {
    if (this._browser) return;
    const launchOpts = {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--window-size=1366,768'],
    };
    if (this.proxy) {
      launchOpts.proxy = { server: this.proxy, bypass: '127.0.0.1,localhost' };
    }
    this._browser = await chromium.launch(launchOpts);
    this.log('Browser launched');
  }

  /**
   * Solve hCaptcha for a given sitekey.
   * Returns: { token: string, elapsed: number, type: string }
   */
  async solve(sitekey, host, opts = {}) {
    const startTime = Date.now();
    await this._ensureBrowser();

    const pageUrl = opts.pageUrl || getPageUrl(sitekey);
    this.log(`Solving sitekey=${sitekey} url=${pageUrl}`);

    const ctx = await this._browser.newContext({
      userAgent: USER_AGENT,
      viewport: { width: 1366, height: 768 },
      locale: 'en-US',
      timezoneId: 'America/New_York',
      extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
    });

    const page = await ctx.newPage();
    let capturedToken = null;

    // Intercept plain JSON getcaptcha/checkcaptcha responses (non-encrypted)
    page.on('response', async resp => {
      const url = resp.url();
      if (!url.includes('/getcaptcha/') && !url.includes('/checkcaptcha/')) return;
      try {
        const body = await resp.body().catch(() => Buffer.alloc(0));
        if (body[0] === 0x7b) {
          const data = JSON.parse(body.toString());
          if (data.generated_pass_UUID && !capturedToken) {
            capturedToken = data.generated_pass_UUID;
            this.log('Token from network response:', capturedToken.slice(0, 40));
          }
        }
      } catch (e) {}
    });

    try {
      await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });

      // Wait for and click checkbox
      this.log('Waiting for checkbox...');
      let checkboxFrame = null;
      for (let i = 0; i < 20; i++) {
        await page.waitForTimeout(400);
        checkboxFrame = page.frames().find(f => f.url().includes('frame=checkbox'));
        if (checkboxFrame) break;
      }
      if (!checkboxFrame) throw new Error('Checkbox frame not found');

      await checkboxFrame.waitForSelector('#checkbox', { timeout: 6000 });
      this.log('Clicking checkbox');
      await page.waitForTimeout(400 + Math.floor(Math.random() * 400));
      await checkboxFrame.click('#checkbox');

      // Inject postMessage token capture
      await page.evaluate(() => {
        window.__hcToken = null;
        window.addEventListener('message', (e) => {
          try {
            const d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
            if (!d || d.source !== 'hcaptcha') return;
            if (d.label === 'challenge-passed') {
              const tok = (d.contents && d.contents.response) || d.response;
              if (tok && tok.length > 10) window.__hcToken = tok;
            }
          } catch (_) {}
        });
      });

      // Wait for auto-solve or challenge
      this.log('Waiting for auto-solve or challenge...');
      let challengeLoaded = false;

      const deadline = Date.now() + SOLVE_TIMEOUT_MS;
      while (Date.now() < deadline) {
        await page.waitForTimeout(600);

        // Check auto-solve
        if (!capturedToken) {
          const t = await page.evaluate(() => window.__hcToken).catch(() => null);
          if (t && t.length > 10) capturedToken = t;
        }
        if (capturedToken) break;

        // Check if challenge is ready
        const cf = page.frames().find(f => f.url().includes('frame=challenge'));
        if (cf) {
          const prompt = await cf.evaluate(() => {
            const el = document.querySelector('.prompt-text');
            return el ? el.textContent.trim() : null;
          }).catch(() => null);

          if (prompt) {
            this.log('Challenge loaded, type:', prompt);
            challengeLoaded = true;

            // Determine challenge type and solve
            const token = await this._solveChallenge(page, cf, prompt);
            if (token) {
              capturedToken = token;
              this.log('Challenge solved, token:', capturedToken.slice(0, 40));
            }
            break;
          }
        }
      }

      const cookieList = await ctx.cookies();
      const cookies = {};
      for (const c of cookieList) cookies[c.name] = c.value;

      return {
        token: capturedToken,
        elapsed: Date.now() - startTime,
        cookies,
        type: challengeLoaded ? 'challenge_solved' : 'auto_solved',
      };

    } finally {
      await ctx.close().catch(() => {});
    }
  }

  /**
   * Solve the visual challenge in the iframe.
   */
  async _solveChallenge(page, challengeFrame, prompt) {
    // Determine challenge type from prompt text
    const isDrag = prompt.toLowerCase().includes('drag');
    const isBinary = !isDrag;

    if (isDrag) {
      return this._solveDragChallenge(page, challengeFrame, prompt);
    } else {
      return this._solveBinaryChallenge(page, challengeFrame, prompt);
    }
  }

  /**
   * Solve drag/puzzle challenge.
   * Takes screenshot, asks vision AI for target position, performs drag.
   * Then waits for token.
   */
  async _solveDragChallenge(page, challengeFrame, prompt) {
    if (!this.anthropicApiKey) {
      this.log('No API key for vision — cannot solve drag challenge');
      return null;
    }

    this.log('Solving drag challenge:', prompt);

    // Wait for challenge to fully render
    await page.waitForTimeout(1500);

    // Screenshot the challenge iframe
    const iframeEl = await page.$('iframe[src*="frame=challenge"]').catch(() => null);
    if (!iframeEl) { this.log('Challenge iframe element not found'); return null; }

    const screenshotBuf = await iframeEl.screenshot({ type: 'png' }).catch(() => null);
    if (!screenshotBuf) { this.log('Screenshot failed'); return null; }

    this.log('Asking vision AI for drag target...');
    let visionResult;
    try {
      visionResult = await askVisionForDragPosition(screenshotBuf, this.anthropicApiKey);
    } catch (e) {
      this.log('Vision AI error:', e.message);
      return null;
    }

    this.log('Vision says position:', visionResult.position, 'confidence:', visionResult.confidence);

    // Get iframe bounding box and challenge frame dimensions
    const iframeBB = await iframeEl.boundingBox();
    if (!iframeBB) { this.log('No iframe bounding box'); return null; }

    // Challenge iframe is typically 520x570px (from DOM inspection: width:520, height:570)
    // Layout:
    // - Drag source ("Move" box) is on the right side, roughly at x=400-460, y=80-130 (center of move panel)
    // - Grid targets are on the left:
    //   1=top-left: ~(90, 180), 2=top-right: ~(220, 180)
    //   3=bottom-left: ~(90, 320), 4=bottom-right: ~(220, 320)
    // These are relative to the challenge iframe

    // Map position to coordinates within iframe (adjust for scale)
    const iframeWidth = iframeBB.width;
    const iframeHeight = iframeBB.height;

    // Source: the draggable piece — right side panel
    const sourceX = iframeBB.x + iframeWidth * 0.78;
    const sourceY = iframeBB.y + iframeHeight * 0.25;

    // Grid targets (2x2 grid on left half of iframe)
    const targetCoords = {
      1: { x: iframeBB.x + iframeWidth * 0.18, y: iframeBB.y + iframeHeight * 0.38 },  // top-left
      2: { x: iframeBB.x + iframeWidth * 0.38, y: iframeBB.y + iframeHeight * 0.38 },  // top-right
      3: { x: iframeBB.x + iframeWidth * 0.18, y: iframeBB.y + iframeHeight * 0.62 },  // bottom-left
      4: { x: iframeBB.x + iframeWidth * 0.38, y: iframeBB.y + iframeHeight * 0.62 },  // bottom-right
    };

    const target = targetCoords[visionResult.position] || targetCoords[1];
    this.log(`Dragging from (${Math.round(sourceX)}, ${Math.round(sourceY)}) to (${Math.round(target.x)}, ${Math.round(target.y)})`);

    // Perform the drag with human-like motion
    await page.mouse.move(sourceX, sourceY);
    await page.waitForTimeout(200);
    await page.mouse.down();
    await page.waitForTimeout(100);

    // Move in steps
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = sourceX + (target.x - sourceX) * t + (Math.random() - 0.5) * 3;
      const y = sourceY + (target.y - sourceY) * t + (Math.random() - 0.5) * 3;
      await page.mouse.move(x, y);
      await page.waitForTimeout(20 + Math.floor(Math.random() * 20));
    }

    await page.mouse.move(target.x, target.y);
    await page.waitForTimeout(150);
    await page.mouse.up();
    this.log('Drag complete');

    // Wait for token after drag
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      await page.waitForTimeout(500);

      // Check postMessage token
      const t = await page.evaluate(() => window.__hcToken).catch(() => null);
      if (t && t.length > 10) return t;

      // Check if checkbox frame shows checkmark (pass)
      const passed = await page.evaluate(() => {
        const el = document.querySelector('.h-captcha');
        const textarea = document.querySelector('textarea[name="h-captcha-response"]');
        return textarea ? textarea.value : null;
      }).catch(() => null);
      if (passed && passed.length > 10) return passed;
    }

    this.log('No token after drag — wrong position or drag failed');
    return null;
  }

  /**
   * Solve binary image classification challenge.
   * Screenshots each task cell, asks vision AI, clicks correct ones.
   */
  async _solveBinaryChallenge(page, challengeFrame, prompt) {
    if (!this.anthropicApiKey) {
      this.log('No API key for vision — cannot solve binary challenge');
      return null;
    }

    this.log('Solving binary challenge:', prompt);
    await page.waitForTimeout(2000);

    // Get task cells from the challenge iframe
    const iframeEl = await page.$('iframe[src*="frame=challenge"]').catch(() => null);
    if (!iframeEl) return null;

    // Screenshot entire challenge iframe and send to vision
    const screenshotBuf = await iframeEl.screenshot({ type: 'png' }).catch(() => null);
    if (!screenshotBuf) return null;

    // Ask vision AI which cells to select
    let answers;
    try {
      const base64 = screenshotBuf.toString('base64');
      const body = JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 512,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: base64 } },
            {
              type: 'text',
              text: `hCaptcha task: "${prompt}"\n\nThis is a grid of images. Identify which images match the description. The grid typically has 9 cells (3x3) numbered left-to-right, top-to-bottom (1-9). Return ONLY a JSON array of cell numbers that match, e.g.: [1,4,7]`,
            },
          ],
        }],
      });

      const claudeResponse = await new Promise((resolve, reject) => {
        const req = https.request({
          hostname: 'api.anthropic.com',
          path: '/v1/messages',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.anthropicApiKey,
            'anthropic-version': '2023-06-01',
            'Content-Length': Buffer.byteLength(body),
          },
        }, res => {
          let data = '';
          res.on('data', c => { data += c; });
          res.on('end', () => {
            try {
              const resp = JSON.parse(data);
              if (resp.error) return reject(new Error(resp.error.message));
              resolve(resp.content[0].text.trim());
            } catch (e) { reject(e); }
          });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
      });

      const match = claudeResponse.match(/\[[\d,\s]*\]/);
      answers = match ? JSON.parse(match[0]) : [];
      this.log('Vision says click cells:', answers);
    } catch (e) {
      this.log('Vision error:', e.message);
      return null;
    }

    // Click the identified cells in the challenge iframe
    // 3x3 grid layout within challenge iframe
    const iframeBB = await iframeEl.boundingBox();
    if (!iframeBB) return null;

    // Grid area: roughly top 60% of iframe height, left 70% of width
    const gridLeft = iframeBB.x + iframeBB.width * 0.02;
    const gridTop = iframeBB.y + iframeBB.height * 0.20;
    const cellWidth = (iframeBB.width * 0.65) / 3;
    const cellHeight = (iframeBB.height * 0.55) / 3;

    for (const cellNum of answers) {
      if (cellNum < 1 || cellNum > 9) continue;
      const row = Math.floor((cellNum - 1) / 3);
      const col = (cellNum - 1) % 3;
      const x = gridLeft + col * cellWidth + cellWidth / 2;
      const y = gridTop + row * cellHeight + cellHeight / 2;
      this.log(`Clicking cell ${cellNum} at (${Math.round(x)}, ${Math.round(y)})`);
      await page.mouse.click(x, y);
      await page.waitForTimeout(200 + Math.floor(Math.random() * 200));
    }

    // Look for a submit/verify button in the challenge frame and click it
    try {
      await challengeFrame.click('.button.primary, [class*="submit"], .verify-btn', { timeout: 3000 });
      this.log('Clicked submit button');
    } catch (e) {
      this.log('No submit button found');
    }

    // Wait for token
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
      await page.waitForTimeout(500);
      const t = await page.evaluate(() => window.__hcToken).catch(() => null);
      if (t && t.length > 10) return t;
      const textarea = await page.evaluate(() => {
        const el = document.querySelector('textarea[name="h-captcha-response"]');
        return el ? el.value : null;
      }).catch(() => null);
      if (textarea && textarea.length > 10) return textarea;
    }

    return null;
  }

  async close() {
    if (this._browser) {
      await this._browser.close().catch(() => {});
      this._browser = null;
    }
  }
}

module.exports = { BrowserSession };
