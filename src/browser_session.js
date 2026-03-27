'use strict';

/**
 * BrowserSession — Playwright + stealth for hCaptcha.
 * Uses CLIP (@xenova/transformers) for all image classification.
 * No Claude/Anthropic API required.
 *
 * Challenge types handled:
 *   1. drag_half       — drag piece to matching half in 2x2 grid
 *   2. drag_similarity — drag bottom element to most similar in 2x2 grid
 *   3. puzzle_piece    — drag piece to correct slot among 2 targets
 *   4. grid_selection  — click cells matching size/context criteria (3x3 grid)
 *   5. grid_identify   — click cells most similar to example (3x3 grid)
 *   6. Auto-solve      — token captured from network/postMessage without vision
 */

const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
const { getSolver } = require('./clip_solver');

chromium.use(stealth());

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';
const SOLVE_TIMEOUT_MS = 60000;

function getPageUrl(sitekey) {
  return `https://accounts.hcaptcha.com/demo?sitekey=${encodeURIComponent(sitekey)}`;
}

/**
 * Screenshot a sub-region of the page defined as percentages of the iframe bounding box.
 */
async function cropRegion(page, iframeEl, xPct, yPct, wPct, hPct) {
  const bb = await iframeEl.boundingBox();
  if (!bb) return null;
  return page.screenshot({
    clip: {
      x: bb.x + bb.width * xPct,
      y: bb.y + bb.height * yPct,
      width: bb.width * wPct,
      height: bb.height * hPct,
    },
  });
}

/**
 * Detect challenge type from prompt text.
 */
function detectChallengeType(prompt) {
  const p = prompt.toLowerCase();
  if (p.includes('drag') && p.includes('half')) return 'drag_half';
  if (p.includes('drag') && (p.includes('similar') || p.includes('element'))) return 'drag_similarity';
  if (p.includes('puzzle') || p.includes('slot') || (p.includes('basket') && p.includes('piece'))) return 'puzzle_piece';
  if (p.includes('identify') || p.includes('see in the example')) return 'grid_identify';
  if (p.includes('smaller') || p.includes('live or work') || p.includes('belongs') || p.includes('place shown') || p.includes('tap on') || p.includes('found')) return 'grid_selection';
  // Basket/arrow/direction challenges
  if (p.includes('basket') || p.includes('moving towards') || p.includes('will go into')) return 'puzzle_piece';
  // default — treat as grid_selection
  return 'grid_selection';
}

// Context labels for zero-shot classification
const CONTEXT_LABELS = [
  'ocean water sea beach',
  'forest trees nature outdoor',
  'kitchen cooking food indoor',
  'city street urban building',
  'farm animals grass outdoor',
  'sky clouds flying outdoor',
  'desert sand dry outdoor',
  'snow ice cold outdoor',
  'indoor room house furniture',
  'bathroom toilet sink',
  'bedroom sleeping bed',
  'office desk computer',
];

// Size labels for zero-shot classification
const SIZE_LABELS = [
  'a very tiny miniature small object',
  'a small object smaller than a washing machine',
  'a medium sized household object',
  'a large heavy object like a car or truck',
  'a very large massive object like a building or elephant',
];

class BrowserSession {
  constructor(opts = {}) {
    this.debug = opts.debug || false;
    this.proxy = opts.proxy || null;
    this._browser = null;
    this._clip = null;
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

  async _ensureCLIP() {
    if (this._clip) return this._clip;
    this.log('Initializing CLIP model...');
    this._clip = await getSolver({ debug: this.debug });
    this.log('CLIP model ready');
    return this._clip;
  }

  /**
   * Solve hCaptcha for a given sitekey.
   * Returns: { token: string, elapsed: number, type: string, challengeType: string }
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

    // Intercept plain JSON getcaptcha/checkcaptcha responses
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

    let challengeType = 'auto';

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
            this.log('Challenge loaded, prompt:', prompt);
            challengeType = detectChallengeType(prompt);
            this.log('Challenge type:', challengeType);

            try {
              const token = await this._solveChallenge(page, cf, prompt, challengeType);
              if (token) {
                capturedToken = token;
                this.log('Challenge solved, token:', capturedToken.slice(0, 40));
              }
            } catch (e) {
              this.log('Challenge solve error:', e.message);
            }
            break;
          }
        }
      }

      // After solving, wait a bit more for token if not captured yet
      if (!capturedToken) {
        const extra = Date.now() + 8000;
        while (Date.now() < extra) {
          await page.waitForTimeout(500);
          const t = await page.evaluate(() => window.__hcToken).catch(() => null);
          if (t && t.length > 10) { capturedToken = t; break; }
          const textarea = await page.evaluate(() => {
            const el = document.querySelector('textarea[name="h-captcha-response"]');
            return el ? el.value : null;
          }).catch(() => null);
          if (textarea && textarea.length > 10) { capturedToken = textarea; break; }
          if (capturedToken) break;
        }
      }

      const cookieList = await ctx.cookies();
      const cookies = {};
      for (const c of cookieList) cookies[c.name] = c.value;

      return {
        token: capturedToken,
        elapsed: Date.now() - startTime,
        cookies,
        type: challengeType !== 'auto' ? 'challenge_solved' : 'auto_solved',
        challengeType,
      };

    } finally {
      await ctx.close().catch(() => {});
    }
  }

  /**
   * Dispatch to the correct challenge solver based on type.
   */
  async _solveChallenge(page, challengeFrame, prompt, challengeType) {
    // Pre-load CLIP model (downloads on first run)
    await this._ensureCLIP();

    // Wait for challenge to fully render
    await page.waitForTimeout(2000);

    const iframeEl = await page.$('iframe[src*="frame=challenge"]').catch(() => null);
    if (!iframeEl) { this.log('Challenge iframe element not found'); return null; }

    // Check if this is an img-based grid (task-grid layout with real <img> tags)
    const hasTaskGrid = await challengeFrame.evaluate(() => {
      return !!document.querySelector('.task-grid');
    }).catch(() => false);
    if (hasTaskGrid && (challengeType === 'grid_selection' || challengeType === 'grid_identify')) {
      this.log('Detected img-based task-grid layout');
      return this._solveImgGrid(page, challengeFrame, iframeEl, prompt, challengeType);
    }

    switch (challengeType) {
      case 'drag_half':
        return this._solveDragHalf(page, challengeFrame, iframeEl);
      case 'drag_similarity':
        return this._solveDragSimilarity(page, challengeFrame, iframeEl);
      case 'puzzle_piece':
        return this._solvePuzzlePiece(page, challengeFrame, iframeEl);
      case 'grid_identify':
        return this._solveGridIdentify(page, challengeFrame, iframeEl, prompt);
      case 'grid_selection':
      default:
        return this._solveGridSelection(page, challengeFrame, iframeEl, prompt);
    }
  }

  /**
   * Perform a human-like drag from (sx, sy) to (tx, ty) in page coordinates.
   */
  async _drag(page, sx, sy, tx, ty) {
    await page.mouse.move(sx, sy);
    await page.waitForTimeout(150 + Math.floor(Math.random() * 100));
    await page.mouse.down();
    await page.waitForTimeout(80);

    const steps = 12;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      // Ease in-out
      const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      const x = sx + (tx - sx) * ease + (Math.random() - 0.5) * 2;
      const y = sy + (ty - sy) * ease + (Math.random() - 0.5) * 2;
      await page.mouse.move(x, y);
      await page.waitForTimeout(15 + Math.floor(Math.random() * 15));
    }

    await page.mouse.move(tx, ty);
    await page.waitForTimeout(100);
    await page.mouse.up();
  }

  /**
   * Wait for token after an interaction.
   */
  async _waitForToken(page, timeoutMs = 12000) {
    const deadline = Date.now() + timeoutMs;
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

  // ─────────────────────────────────────────────────────────────────
  // IMG GRID: handle challenges with real <img> task elements
  // ─────────────────────────────────────────────────────────────────
  async _solveImgGrid(page, challengeFrame, iframeEl, prompt, challengeType) {
    this.log('Solving img-based grid');
    const clip = this._clip;

    // Wait for images to load
    await challengeFrame.waitForFunction(() => {
      const imgs = document.querySelectorAll('.task-image img, .task img');
      return imgs.length > 0 && Array.from(imgs).every(i => i.complete && i.naturalWidth > 0);
    }, { timeout: 10000 }).catch(() => {});

    // Get example image URL
    const exampleUrl = await challengeFrame.evaluate(() => {
      const ex = document.querySelector('.challenge-example img, .example img');
      if (ex) return ex.src;
      // Sometimes example is a background image or canvas
      return null;
    }).catch(() => null);

    // Get all task image cells with their positions
    const taskData = await challengeFrame.evaluate(() => {
      const tasks = document.querySelectorAll('.task');
      return Array.from(tasks).map((task, i) => {
        const img = task.querySelector('img');
        const bb = task.getBoundingClientRect();
        return {
          idx: i,
          src: img ? img.src : null,
          x: bb.x + bb.width / 2,
          y: bb.y + bb.height / 2,
        };
      });
    }).catch(() => []);

    this.log(`Found ${taskData.length} task images, example: ${exampleUrl ? 'yes' : 'no'}`);

    if (taskData.length === 0) {
      this.log('No task images found, falling back to canvas grid');
      return challengeType === 'grid_identify'
        ? this._solveGridIdentify(page, challengeFrame, iframeEl, prompt)
        : this._solveGridSelection(page, challengeFrame, iframeEl, prompt);
    }

    // Fetch all images as buffers
    const fetch = (...args) => import('node-fetch').then(m => m.default(...args));
    const fetchBuf = async (url) => {
      if (!url) return null;
      try {
        const r = await fetch(url);
        return Buffer.from(await r.arrayBuffer());
      } catch (e) {
        this.log('Failed to fetch image:', url, e.message);
        return null;
      }
    };

    const taskBuffers = await Promise.all(taskData.map(t => fetchBuf(t.src)));
    const validTasks = taskData.filter((t, i) => taskBuffers[i] !== null);
    const validBuffers = taskBuffers.filter(Boolean);

    let selectedTasks = [];

    if (challengeType === 'grid_identify' && exampleUrl) {
      const exampleBuf = await fetchBuf(exampleUrl);
      if (exampleBuf) {
        const topIndices = await clip.findTopSimilar(exampleBuf, validBuffers, 4);
        selectedTasks = topIndices.map(i => validTasks[i]);
      } else {
        selectedTasks = validTasks.slice(0, 3);
      }
    } else if (exampleUrl) {
      const exampleBuf = await fetchBuf(exampleUrl);
      if (exampleBuf) {
        const topIndices = await clip.findTopSimilar(exampleBuf, validBuffers, 3);
        selectedTasks = topIndices.map(i => validTasks[i]);
      } else {
        selectedTasks = validTasks.slice(0, 3);
      }
    } else {
      selectedTasks = validTasks.slice(0, 3);
    }

    this.log('Selected task indices:', selectedTasks.map(t => t.idx));

    // Click selected tasks using their bounding box coordinates (in iframe frame)
    const iframeBB = await iframeEl.boundingBox();
    if (!iframeBB) return null;

    for (const task of selectedTasks) {
      // task.x/y are relative to the iframe document, add iframe's page position
      const pageX = iframeBB.x + task.x;
      const pageY = iframeBB.y + task.y;
      this.log(`Clicking task ${task.idx} at page (${Math.round(pageX)}, ${Math.round(pageY)})`);
      await page.mouse.click(pageX, pageY);
      await page.waitForTimeout(250 + Math.floor(Math.random() * 200));
    }

    await this._submitGrid(page, challengeFrame);
    return this._waitForToken(page, 12000);
  }

  // ─────────────────────────────────────────────────────────────────
  // DRAG_HALF: drag piece to matching half in 2x2 grid
  // ─────────────────────────────────────────────────────────────────
  async _solveDragHalf(page, challengeFrame, iframeEl) {
    this.log('Solving drag_half');
    const clip = this._clip;

    // Calibrated coords (520x570 iframe, confirmed via vision analysis):
    // Source piece is in the right panel at ~(445, 205) in iframe coords
    // Grid cells (2x2) are on the left side of the canvas
    //   TL:(105,215) TR:(265,215) BL:(105,375) BR:(265,375)

    // Crop draggable piece from right panel (x=72-100%, y=13-47%)
    const draggable = await cropRegion(page, iframeEl, 0.72, 0.13, 0.26, 0.34);
    if (!draggable) { this.log('Could not crop draggable'); return null; }

    // Crop 4 grid cells from the left/center canvas area
    const cells = [
      await cropRegion(page, iframeEl, 0.02, 0.27, 0.32, 0.26), // TL
      await cropRegion(page, iframeEl, 0.34, 0.27, 0.32, 0.26), // TR
      await cropRegion(page, iframeEl, 0.02, 0.54, 0.32, 0.26), // BL
      await cropRegion(page, iframeEl, 0.34, 0.54, 0.32, 0.26), // BR
    ];

    const validCells = cells.filter(Boolean);
    if (validCells.length < 4) { this.log('Could not crop all cells'); }

    const bestIdx = await clip.findMostSimilar(draggable, validCells);
    this.log(`Best matching cell: ${bestIdx} (0=TL,1=TR,2=BL,3=BR)`);

    const bb = await iframeEl.boundingBox();
    if (!bb) return null;

    // Source: right panel draggable piece center (445/520=0.856, 205/570=0.360)
    const sourceX = bb.x + bb.width * 0.856;
    const sourceY = bb.y + bb.height * 0.360;

    // Target centers (pixel coords / iframe dims)
    // TL:(105/520, 215/570) TR:(265/520, 215/570) BL:(105/520, 375/570) BR:(265/520, 375/570)
    const targetPcts = [
      [0.202, 0.377], // TL
      [0.510, 0.377], // TR
      [0.202, 0.658], // BL
      [0.510, 0.658], // BR
    ];
    const [txPct, tyPct] = targetPcts[bestIdx] || targetPcts[0];
    const targetX = bb.x + bb.width * txPct;
    const targetY = bb.y + bb.height * tyPct;

    this.log(`Dragging from (${Math.round(sourceX)},${Math.round(sourceY)}) to (${Math.round(targetX)},${Math.round(targetY)})`);
    await this._drag(page, sourceX, sourceY, targetX, targetY);

    return this._waitForToken(page, 12000);
  }

  // ─────────────────────────────────────────────────────────────────
  // DRAG_SIMILARITY: drag bottom element to most similar in 2x2 grid
  // ─────────────────────────────────────────────────────────────────
  async _solveDragSimilarity(page, challengeFrame, iframeEl) {
    this.log('Solving drag_similarity');
    const clip = this._clip;

    // Crop bottom draggable element
    const draggable = await cropRegion(page, iframeEl, 0.30, 0.80, 0.40, 0.18);
    if (!draggable) { this.log('Could not crop draggable'); return null; }

    // Crop 4 option cells in 2x2 grid
    const cells = [
      await cropRegion(page, iframeEl, 0.05, 0.22, 0.42, 0.35), // TL
      await cropRegion(page, iframeEl, 0.52, 0.22, 0.42, 0.35), // TR
      await cropRegion(page, iframeEl, 0.05, 0.55, 0.42, 0.35), // BL
      await cropRegion(page, iframeEl, 0.52, 0.55, 0.42, 0.35), // BR
    ];

    const validCells = cells.filter(Boolean);
    const bestIdx = await clip.findMostSimilar(draggable, validCells);
    this.log(`Best matching cell: ${bestIdx}`);

    const bb = await iframeEl.boundingBox();
    if (!bb) return null;

    const sourceX = bb.x + bb.width * 0.50;
    const sourceY = bb.y + bb.height * 0.88;

    const targetPcts = [
      [0.25, 0.40], // TL
      [0.75, 0.40], // TR
      [0.25, 0.70], // BL
      [0.75, 0.70], // BR
    ];
    const [txPct, tyPct] = targetPcts[bestIdx] || targetPcts[0];
    const targetX = bb.x + bb.width * txPct;
    const targetY = bb.y + bb.height * tyPct;

    this.log(`Dragging from (${Math.round(sourceX)},${Math.round(sourceY)}) to (${Math.round(targetX)},${Math.round(targetY)})`);
    await this._drag(page, sourceX, sourceY, targetX, targetY);

    return this._waitForToken(page, 12000);
  }

  // ─────────────────────────────────────────────────────────────────
  // PUZZLE_PIECE: "Find which basket the BALL is moving towards"
  // This is a CLICK task — click the basket the ball is aimed at.
  // Calibrated coords (520x570 iframe):
  //   Ball: (245, 195)  Upper basket: (175, 210)  Lower basket: (105, 405)
  // Strategy: screenshot full challenge, crop each basket + ball region,
  // use CLIP to find which basket is in the ball's visual trajectory direction,
  // then click that basket.
  // ─────────────────────────────────────────────────────────────────
  async _solvePuzzlePiece(page, challengeFrame, iframeEl) {
    this.log('Solving puzzle_piece (click the target basket)');
    const clip = this._clip;

    const bb = await iframeEl.boundingBox();
    if (!bb) return null;

    // Crop regions around each basket to understand their visual state
    // Upper basket: centered at (175, 210) → crop area around it
    // Lower basket: centered at (105, 405) → crop area around it
    // Ball: centered at (245, 195) → crop area around it
    const ballRegion   = await cropRegion(page, iframeEl, 0.37, 0.23, 0.26, 0.26); // ball area
    const upperBasket  = await cropRegion(page, iframeEl, 0.17, 0.24, 0.26, 0.26); // upper-left basket
    const lowerBasket  = await cropRegion(page, iframeEl, 0.05, 0.57, 0.26, 0.26); // lower-left basket

    let clickIdx = 0; // default upper basket

    // Screenshot the full challenge for zero-shot trajectory classification
    const fullShot = await cropRegion(page, iframeEl, 0.0, 0.05, 1.0, 0.88);
    if (fullShot) {
      // Use CLIP zero-shot: classify which basket the ball trajectory arrow points to
      const labels = [
        'ball moving to upper basket on the left',
        'ball moving to lower basket on the left',
        'basketball trajectory pointing upward',
        'basketball trajectory pointing downward',
      ];
      const results = await clip.classify(fullShot, labels);
      this.log('CLIP zero-shot trajectory results:', results.map(r => `${r.label.slice(0,30)}:${r.score.toFixed(3)}`).join(' | '));

      // Score: upper = labels 0+2, lower = labels 1+3
      const upperScore = (results[0]?.score || 0) + (results[2]?.score || 0);
      const lowerScore = (results[1]?.score || 0) + (results[3]?.score || 0);
      clickIdx = lowerScore > upperScore ? 1 : 0;
      this.log(`Trajectory: upper=${upperScore.toFixed(3)} lower=${lowerScore.toFixed(3)} → basket ${clickIdx}`);
    } else {
      this.log('Could not crop full frame, defaulting to lower basket');
      clickIdx = 1; // lower is more common based on testing
    }

    // Click coords in page space
    // Upper basket: (175/520=0.337, 210/570=0.368)
    // Lower basket: (105/520=0.202, 405/570=0.711)
    const basketCoords = [
      { xPct: 0.337, yPct: 0.368 }, // upper basket
      { xPct: 0.202, yPct: 0.711 }, // lower basket
    ];

    const { xPct, yPct } = basketCoords[clickIdx] || basketCoords[0];
    const clickX = bb.x + bb.width * xPct;
    const clickY = bb.y + bb.height * yPct;

    this.log(`Clicking basket ${clickIdx} at page (${Math.round(clickX)}, ${Math.round(clickY)})`);
    await page.mouse.click(clickX, clickY);
    await page.waitForTimeout(500);

    // Click the Next button to submit answer (at ~90% x, ~94.7% y of iframe)
    const nextX = bb.x + bb.width * 0.900;
    const nextY = bb.y + bb.height * 0.947;
    this.log(`Clicking Next at page (${Math.round(nextX)}, ${Math.round(nextY)})`);
    await page.mouse.click(nextX, nextY);
    await page.waitForTimeout(300);

    // Check for token — may take a few more challenge rounds
    const token = await this._waitForToken(page, 8000);
    if (token) return token;

    // If still no token, may be multi-round — click other basket and Next again
    this.log('No token, trying other basket + Next again');
    const altIdx = clickIdx === 0 ? 1 : 0;
    const alt = basketCoords[altIdx];
    const altX = bb.x + bb.width * alt.xPct;
    const altY = bb.y + bb.height * alt.yPct;
    await page.mouse.click(altX, altY);
    await page.waitForTimeout(400);
    await page.mouse.click(nextX, nextY);

    return this._waitForToken(page, 10000);
  }

  // ─────────────────────────────────────────────────────────────────
  // GRID_IDENTIFY: click cells most similar to example image
  // ─────────────────────────────────────────────────────────────────
  async _solveGridIdentify(page, challengeFrame, iframeEl, prompt) {
    this.log('Solving grid_identify');
    const clip = this._clip;

    // Crop example image from header (top-right)
    const exampleImg = await cropRegion(page, iframeEl, 0.75, 0.00, 0.25, 0.22);
    if (!exampleImg) { this.log('Could not crop example'); return null; }

    const cells = await this._crop3x3Grid(page, iframeEl);
    const topIndices = await clip.findTopSimilar(exampleImg, cells, 4);
    this.log('Top similar cells:', topIndices);

    await this._clickGridCells(page, iframeEl, topIndices);
    await this._submitGrid(page, challengeFrame);

    return this._waitForToken(page, 12000);
  }

  // ─────────────────────────────────────────────────────────────────
  // GRID_SELECTION: click cells matching size/context criteria
  // ─────────────────────────────────────────────────────────────────
  async _solveGridSelection(page, challengeFrame, iframeEl, prompt) {
    this.log('Solving grid_selection, prompt:', prompt);
    const clip = this._clip;
    const p = prompt.toLowerCase();

    const cells = await this._crop3x3Grid(page, iframeEl);

    let selectedIndices = [];

    if (p.includes('smaller') || p.includes('small')) {
      // Size comparison: get example, classify all cells by size
      const exampleImg = await cropRegion(page, iframeEl, 0.75, 0.00, 0.25, 0.22);
      if (exampleImg) {
        // Get example's size category
        const exampleSizeResult = await clip.classify(exampleImg, SIZE_LABELS);
        const exampleSizeIdx = SIZE_LABELS.indexOf(exampleSizeResult[0].label);
        this.log('Example size:', exampleSizeResult[0].label, 'idx:', exampleSizeIdx);

        // Classify each cell and select those smaller than example
        for (let i = 0; i < cells.length; i++) {
          const cellResult = await clip.classify(cells[i], SIZE_LABELS);
          const cellSizeIdx = SIZE_LABELS.indexOf(cellResult[0].label);
          this.log(`  cell[${i}] size: ${cellResult[0].label} (idx=${cellSizeIdx})`);
          if (cellSizeIdx < exampleSizeIdx) {
            selectedIndices.push(i);
          }
        }
        // If nothing selected, pick the ones with smallest size
        if (selectedIndices.length === 0) {
          const sizeScores = cells.map((_, i) => ({
            i,
            result: null,
          }));
          for (let i = 0; i < cells.length; i++) {
            const r = await clip.classify(cells[i], SIZE_LABELS);
            sizeScores[i].result = r;
          }
          // Pick cells scoring highest on the 2 smallest size labels
          const smallLabels = SIZE_LABELS.slice(0, 2);
          sizeScores.sort((a, b) => {
            const aScore = a.result.filter(x => smallLabels.includes(x.label)).reduce((s, x) => s + x.score, 0);
            const bScore = b.result.filter(x => smallLabels.includes(x.label)).reduce((s, x) => s + x.score, 0);
            return bScore - aScore;
          });
          selectedIndices = sizeScores.slice(0, 3).map(x => x.i);
        }
      } else {
        // No example found — pick top 3 with smallest size labels
        selectedIndices = [0, 1, 2];
      }

    } else if (p.includes('live or work') || p.includes('belongs') || p.includes('place shown') || p.includes('tap on') || p.includes('found')) {
      // Context matching: classify example → determine context → match cells
      const exampleImg = await cropRegion(page, iframeEl, 0.75, 0.00, 0.25, 0.22);
      if (exampleImg) {
        const contextResult = await clip.classify(exampleImg, CONTEXT_LABELS);
        const topContext = contextResult[0].label;
        this.log('Detected context:', topContext);

        // Classify each cell against top context vs "something else"
        const matchLabels = [topContext, 'something else unrelated'];
        for (let i = 0; i < cells.length; i++) {
          const r = await clip.classify(cells[i], matchLabels);
          const topLabel = r[0].label;
          const topScore = r[0].score;
          this.log(`  cell[${i}]: ${topLabel} (${topScore.toFixed(3)})`);
          if (topLabel === topContext && topScore > 0.4) {
            selectedIndices.push(i);
          }
        }
        if (selectedIndices.length === 0) {
          // Lower threshold — take top 3 by context score
          const scores = [];
          for (let i = 0; i < cells.length; i++) {
            const r = await clip.classify(cells[i], matchLabels);
            const s = r.find(x => x.label === topContext);
            scores.push({ i, score: s ? s.score : 0 });
          }
          scores.sort((a, b) => b.score - a.score);
          selectedIndices = scores.slice(0, 3).map(x => x.i);
        }
      } else {
        selectedIndices = [0, 1, 2];
      }

    } else {
      // Generic: find most similar to example
      const exampleImg = await cropRegion(page, iframeEl, 0.75, 0.00, 0.25, 0.22);
      if (exampleImg) {
        selectedIndices = await clip.findTopSimilar(exampleImg, cells, 3);
      } else {
        selectedIndices = [0, 1, 2];
      }
    }

    this.log('Selected cells:', selectedIndices);
    await this._clickGridCells(page, iframeEl, selectedIndices);
    await this._submitGrid(page, challengeFrame);

    return this._waitForToken(page, 12000);
  }

  // ─────────────────────────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────────────────────────

  /**
   * Crop 9 cells from the 3x3 grid in the challenge iframe.
   * Cell centers (% of 520w x 570h iframe):
   *   R1: (17%,38%), (50%,38%), (83%,38%)
   *   R2: (17%,55%), (50%,55%), (83%,55%)
   *   R3: (17%,72%), (50%,72%), (83%,72%)
   * Each cell is ~130x130px → ~25% wide, ~23% tall
   */
  async _crop3x3Grid(page, iframeEl) {
    const cellPcts = [
      // Row 1
      [0.04, 0.27, 0.26, 0.22],
      [0.37, 0.27, 0.26, 0.22],
      [0.70, 0.27, 0.26, 0.22],
      // Row 2
      [0.04, 0.44, 0.26, 0.22],
      [0.37, 0.44, 0.26, 0.22],
      [0.70, 0.44, 0.26, 0.22],
      // Row 3
      [0.04, 0.61, 0.26, 0.22],
      [0.37, 0.61, 0.26, 0.22],
      [0.70, 0.61, 0.26, 0.22],
    ];

    const cells = [];
    for (const [x, y, w, h] of cellPcts) {
      const cell = await cropRegion(page, iframeEl, x, y, w, h);
      cells.push(cell || Buffer.alloc(0));
    }
    return cells;
  }

  /**
   * Click selected cells (0-based indices) in the 3x3 grid.
   * Cell centers as % of iframe:
   *   (17%,38%), (50%,38%), (83%,38%)
   *   (17%,55%), (50%,55%), (83%,55%)
   *   (17%,72%), (50%,72%), (83%,72%)
   */
  async _clickGridCells(page, iframeEl, indices) {
    const bb = await iframeEl.boundingBox();
    if (!bb) return;

    const cellCentersPct = [
      [0.17, 0.38], [0.50, 0.38], [0.83, 0.38],
      [0.17, 0.55], [0.50, 0.55], [0.83, 0.55],
      [0.17, 0.72], [0.50, 0.72], [0.83, 0.72],
    ];

    for (const idx of indices) {
      if (idx < 0 || idx >= cellCentersPct.length) continue;
      const [xPct, yPct] = cellCentersPct[idx];
      const x = bb.x + bb.width * xPct;
      const y = bb.y + bb.height * yPct;
      this.log(`Clicking cell ${idx} at (${Math.round(x)}, ${Math.round(y)})`);
      await page.mouse.click(x, y);
      await page.waitForTimeout(200 + Math.floor(Math.random() * 200));
    }
  }

  /**
   * Click submit button in the challenge frame.
   */
  async _submitGrid(page, challengeFrame) {
    await page.waitForTimeout(300);
    try {
      await challengeFrame.click('.button-submit', { timeout: 3000 });
      this.log('Clicked .button-submit');
    } catch (e) {
      try {
        await challengeFrame.click('[class*="submit"]', { timeout: 1500 });
        this.log('Clicked [class*=submit]');
      } catch (e2) {
        try {
          await challengeFrame.click('.button.primary', { timeout: 1500 });
          this.log('Clicked .button.primary');
        } catch (e3) {
          this.log('Could not find submit button');
        }
      }
    }
  }

  async close() {
    if (this._browser) {
      await this._browser.close().catch(() => {});
      this._browser = null;
    }
  }
}

module.exports = { BrowserSession };
