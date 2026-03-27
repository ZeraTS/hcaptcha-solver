'use strict';

/**
 * Generates plausible fake motion data for hCaptcha submission.
 * hCaptcha collects mouse movement, keyboard events, and screen metrics.
 * The motionData is base64-encoded JSON sent with getcaptcha and checkcaptcha.
 */

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randFloat(min, max, decimals = 4) {
  return parseFloat((Math.random() * (max - min) + min).toFixed(decimals));
}

/**
 * Ease-in-out cubic interpolation
 */
function easeInOut(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Generate a realistic mouse path between two points using easing
 */
function generateMousePath(startX, startY, endX, endY, steps) {
  steps = steps || randInt(14, 25);
  const path = [];
  const now = Date.now();
  const totalDuration = randInt(400, 1200);

  // Add slight curve via control point
  const cpX = (startX + endX) / 2 + randInt(-80, 80);
  const cpY = (startY + endY) / 2 + randInt(-60, 60);

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const easedT = easeInOut(t);

    // Quadratic bezier
    const x = Math.round(
      (1 - easedT) * (1 - easedT) * startX +
      2 * (1 - easedT) * easedT * cpX +
      easedT * easedT * endX +
      randInt(-2, 2)  // micro-jitter
    );
    const y = Math.round(
      (1 - easedT) * (1 - easedT) * startY +
      2 * (1 - easedT) * easedT * cpY +
      easedT * easedT * endY +
      randInt(-2, 2)
    );

    const ts = now - totalDuration + Math.round(easeInOut(t) * totalDuration) + randInt(-10, 10);
    path.push([x, y, ts]);
  }

  // Sort by timestamp
  path.sort((a, b) => a[2] - b[2]);
  return path;
}

/**
 * Generate random floats array for rnd field
 */
function generateRnd(count) {
  count = count || randInt(12, 20);
  const rnd = [];
  for (let i = 0; i < count; i++) {
    rnd.push(randFloat(0, 1, 6));
  }
  return rnd;
}

function generateMotionData() {
  const now = Date.now();
  const startTime = now - randInt(4000, 10000);
  // lpt: last pass timestamp ~5 minutes ago
  const lpt = now - randInt(270000, 360000);

  // Screen and window dimensions (1366x768 viewport matching ct_generator)
  const screenWidth = 1366;
  const screenHeight = 768;
  const windowWidth = 1366;
  const windowHeight = 768;

  // Mouse movements: array of [x, y, timestamp]
  const mm = [];
  let cx = randInt(100, 350);
  let cy = randInt(100, 350);

  // Primary path: move toward captcha widget area
  const targetX = randInt(550, 800);
  const targetY = randInt(280, 520);
  const path1 = generateMousePath(cx, cy, targetX, targetY);
  mm.push(...path1);

  // Secondary micro-movements (hovering/settling)
  let lastX = targetX;
  let lastY = targetY;
  const extraMoves = randInt(4, 9);
  for (let i = 0; i < extraMoves; i++) {
    const nx = lastX + randInt(-30, 30);
    const ny = lastY + randInt(-20, 20);
    const miniPath = generateMousePath(lastX, lastY, nx, ny, randInt(5, 10));
    mm.push(...miniPath);
    lastX = nx;
    lastY = ny;
  }

  // Final hover near checkbox
  const checkX = randInt(680, 750);
  const checkY = randInt(380, 420);
  mm.push(...generateMousePath(lastX, lastY, checkX, checkY));

  // Sort all movements by timestamp
  mm.sort((a, b) => a[2] - b[2]);

  // Mouse clicks: array of [x, y, timestamp]
  const clickTime = now - randInt(300, 900);
  const md = [[checkX + randInt(-3, 3), checkY + randInt(-3, 3), clickTime]];
  const mu = [[checkX + randInt(-2, 2), checkY + randInt(-2, 2), clickTime + randInt(60, 180)]];

  // Touch events (empty for desktop)
  const tch = [];

  // Keyboard events (empty)
  const kd = [];
  const ku = [];

  // Scroll positions: [scrollX, scrollY, dpr, timestamp]
  const xy = [
    [0, 0, 1, startTime],
    [0, randInt(0, 80), 1, startTime + randInt(800, 2500)],
  ];

  // Window size events
  const wn = [
    [windowWidth, windowHeight, 1, startTime],
  ];

  // Proof events array (empty)
  const v = [];

  const motionData = {
    st: startTime,
    dct: startTime,
    mm,
    md,
    mu,
    tch,
    kd,
    ku,
    xy,
    wn,
    v,
    lpt,
    rnd: generateRnd(),
    sc: {
      availWidth: screenWidth,
      availHeight: screenHeight - 40,
      width: screenWidth,
      height: screenHeight,
      colorDepth: 24,
      pixelDepth: 24,
    },
    nv: {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
      language: 'en-US',
      languages: ['en-US', 'en'],
      platform: 'Win32',
      maxTouchPoints: 0,
      vendor: 'Google Inc.',
      appName: 'Netscape',
      doNotTrack: null,
      cookieEnabled: true,
      onLine: true,
      hardwareConcurrency: randInt(4, 8),
      // NOTE: webdriver intentionally omitted (not present = not a bot)
    },
    dr: `https://discord.com/`,
    inv: false,
    exec: false,
    wba: [[screenWidth, screenHeight, 1, startTime]],
    or: 0,
    wi: {
      outerWidth: windowWidth,
      outerHeight: windowHeight,
      innerWidth: windowWidth,
      innerHeight: windowHeight - 60,
    },
  };

  return Buffer.from(JSON.stringify(motionData)).toString('base64');
}

/**
 * Generates motionData for the checkcaptcha submission
 * Includes answer timing events
 */
function generateAnswerMotionData(taskCount = 9) {
  const base = generateMotionData();
  const decoded = JSON.parse(Buffer.from(base, 'base64').toString('utf8'));

  const now = Date.now();

  // Adjust timing for answer submission
  decoded.dct = now - randInt(6000, 16000);
  decoded.st = decoded.dct;

  // Simulate clicking answer tiles in a 3x3 grid
  const answerClicks = [];
  for (let i = 0; i < taskCount; i++) {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = randInt(270 + col * 120, 330 + col * 120);
    const y = randInt(300 + row * 120, 360 + row * 120);
    const ts = decoded.dct + randInt(600 + i * 220, 1100 + i * 450);
    answerClicks.push([x, y, ts]);
  }

  decoded.md.push(...answerClicks);
  decoded.mu.push(
    ...answerClicks.map(([x, y, ts]) => [x, y, ts + randInt(60, 160)])
  );

  return Buffer.from(JSON.stringify(decoded)).toString('base64');
}

module.exports = { generateMotionData, generateAnswerMotionData };
