'use strict';
const { A11yFastSolver } = require('./src/a11y_fast_solver');

async function main() {
  const solver = new A11yFastSolver({ debug: true });
  await solver.warmup();
  console.log('Warm, solving...\n');

  try {
    const r = await solver.solve('a9b5fb07-92ff-493f-86fe-352a2803b3df', 'discord.com');
    console.log('\nTOKEN:', r.token.slice(0, 50) + '...');
    console.log('TIME:', r.elapsed + 'ms');
  } catch (e) {
    console.log('\nFAIL:', e.message);
  }
  await solver.close();
}
main();
