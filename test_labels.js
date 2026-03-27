'use strict';
const { getSolver } = require('./src/clip_solver');
const fs = require('fs');

// after_select.png has the ball with lower basket being correct
getSolver({ debug: false }).then(async clip => {
  const img = fs.readFileSync('/tmp/after_select.png');
  // lower basket = correct, upper = wrong

  const sets = [
    ['upper hoop', 'lower hoop'],
    ['top basket', 'bottom basket'],
    ['ball going up', 'ball going down'],
    ['moving upward', 'moving downward'],
    ['basketball scoring top', 'basketball scoring bottom'],
    ['basketball going into top basket', 'basketball going into bottom basket'],
    ['scoring upper goal', 'scoring lower goal'],
    ['yellow circle arrow up', 'yellow circle arrow down'],
    ['circular arrow pointing up', 'circular arrow pointing down'],
    ['rotate up', 'rotate down'],
  ];

  console.log('Correct answer: LOWER basket (index 1)\n');
  for (const labels of sets) {
    const r = await clip.classify(img, labels);
    const pred = r[0].score > r[1].score ? 0 : 1;
    const correct = pred === 1 ? '✓' : '✗';
    console.log(`${correct} [${labels[0].slice(0,20)}] vs [${labels[1].slice(0,20)}]: ${r[0]?.score?.toFixed(3)} vs ${r[1]?.score?.toFixed(3)} → pred=${pred}`);
  }
  process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); });
