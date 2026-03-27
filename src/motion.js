'use strict';

/**
 * Generates plausible fake motion data for hCaptcha submission.
 * hCaptcha collects mouse movement, keyboard events, and screen metrics.
 * The motionData is base64-encoded JSON sent with getcaptcha and checkcaptcha.
 */

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randFloat(min, max, decimals = 2) {
  return parseFloat((Math.random() * (max - min) + min).toFixed(decimals));
}

function generateMousePath(startX, startY, endX, endY, steps = 12) {
  const path = [];
  const now = Date.now();

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // Bezier-like curve with slight randomness
    const jitter = randInt(-5, 5);
    const x = Math.round(startX + (endX - startX) * t + jitter);
    const y = Math.round(startY + (endY - startY) * t + jitter);
    const ts = now - (steps - i) * randInt(30, 80);
    path.push([x, y, ts]);
  }
  return path;
}

function generateMotionData() {
  const now = Date.now();
  const startTime = now - randInt(3000, 8000);

  // Screen and window dimensions
  const screenWidth = 1920;
  const screenHeight = 1080;
  const windowWidth = randInt(1200, 1920);
  const windowHeight = randInt(700, 1000);

  // Mouse movements: array of [x, y, timestamp]
  const mm = [];
  let cx = randInt(100, 400);
  let cy = randInt(100, 400);

  // Simulate moving toward the captcha widget area
  const targetX = randInt(600, 900);
  const targetY = randInt(300, 600);
  const path = generateMousePath(cx, cy, targetX, targetY, randInt(10, 20));
  mm.push(...path);

  // Additional idle movements
  for (let i = 0; i < randInt(3, 8); i++) {
    const px = randInt(targetX - 50, targetX + 50);
    const py = randInt(targetY - 50, targetY + 50);
    mm.push([px, py, now - randInt(100, 2000)]);
  }

  mm.sort((a, b) => a[2] - b[2]);

  // Mouse clicks: array of [x, y, timestamp]
  const md = [[targetX, targetY, now - randInt(200, 800)]];
  const mu = [[targetX, targetY, now - randInt(50, 200)]];

  // Touch events (empty for desktop)
  const tch = [];

  // Keyboard events (empty, no typing)
  const kd = [];
  const ku = [];

  // Scroll positions: [scrollX, scrollY, dpr, timestamp]
  const xy = [
    [0, 0, 1, startTime],
    [0, randInt(0, 100), 1, startTime + randInt(500, 2000)],
  ];

  // Window size events: [width, height, dpr, timestamp]
  const wn = [
    [windowWidth, windowHeight, 1, startTime],
  ];

  // Proof events array
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
    sc: {
      availWidth: screenWidth,
      availHeight: screenHeight - 40,
      width: screenWidth,
      height: screenHeight,
      colorDepth: 24,
      pixelDepth: 24,
    },
    nv: {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      language: 'en-US',
      languages: ['en-US', 'en'],
      platform: 'Win32',
      maxTouchPoints: 0,
      vendor: 'Google Inc.',
      appName: 'Netscape',
      doNotTrack: null,
      cookieEnabled: true,
      onLine: true,
      hardwareConcurrency: 4,
    },
    dr: '',
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

  // Add answer-specific events
  decoded.dct = now - randInt(5000, 15000);
  decoded.st = decoded.dct;

  // Simulate clicking answer tiles
  const answerClicks = [];
  for (let i = 0; i < taskCount; i++) {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = randInt(270 + col * 120, 330 + col * 120);
    const y = randInt(300 + row * 120, 360 + row * 120);
    const ts = decoded.dct + randInt(500 + i * 200, 1000 + i * 400);
    answerClicks.push([x, y, ts]);
  }

  decoded.md.push(...answerClicks);
  decoded.mu.push(...answerClicks.map(([x, y, ts]) => [x, y, ts + randInt(50, 150)]));

  return Buffer.from(JSON.stringify(decoded)).toString('base64');
}

module.exports = { generateMotionData, generateAnswerMotionData };
