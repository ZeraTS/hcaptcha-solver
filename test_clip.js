'use strict';
const { CLIPSolver } = require('./src/clip_solver');
console.log('CLIPSolver loaded OK');
const s = new CLIPSolver({ debug: true });
console.log('CLIPSolver instance created, modelName:', s.modelName);
console.log('Testing init (may download model ~340MB)...');
s.init().then(() => {
  console.log('CLIP init SUCCESS');
  process.exit(0);
}).catch(e => {
  console.error('CLIP init FAILED:', e.message);
  console.error(e.stack);
  process.exit(1);
});
