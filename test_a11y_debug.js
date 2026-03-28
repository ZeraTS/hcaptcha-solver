'use strict';
const { A11yBrowserSolver } = require('./src/a11y_browser_solver');
const solver = new A11yBrowserSolver({ debug: true });
solver.solve('a9b5fb07-92ff-493f-86fe-352a2803b3df', 'discord.com')
  .then(r => { console.log('OK:', r); process.exit(0); })
  .catch(e => { console.error('STACK:', e.stack); process.exit(1); });
