'use strict';
const fs = require('fs');
const { CLIPSolver } = require('./src/clip_solver');

async function main() {
  const s = new CLIPSolver({ debug: true });
  await s.init();
  console.log('CLIP ready');

  // Test with a real PNG screenshot from existing files
  const pngFiles = fs.readdirSync('/tmp/hcaptcha_types/').filter(f => f.endsWith('.png'));
  if (pngFiles.length === 0) { console.log('No test images'); return; }

  const buf = fs.readFileSync('/tmp/hcaptcha_types/' + pngFiles[0]);
  console.log('Testing with', pngFiles[0], 'size:', buf.length, 'bytes');

  // Test embedding
  const emb = await s.getEmbedding(buf);
  console.log('Embedding dim:', emb.length, 'first vals:', Array.from(emb.slice(0, 5)));

  // Test classify
  const labels = ['an image of a puzzle', 'an image of animals', 'an abstract pattern'];
  const results = await s.classify(buf, labels);
  console.log('Classify results:', results);

  console.log('ALL TESTS PASSED');
  process.exit(0);
}
main().catch(e => { console.error('ERROR:', e.message, e.stack); process.exit(1); });
