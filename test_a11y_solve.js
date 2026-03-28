'use strict';

const { A11yBrowserSolver } = require('./src/a11y_browser_solver');

async function main() {
  console.log('=== A11y Text Challenge Solver Test ===\n');

  const solver = new A11yBrowserSolver({ debug: true });

  try {
    // Test with Discord sitekey (has a11y_challenge: true)
    console.log('Sitekey: a9b5fb07-92ff-493f-86fe-352a2803b3df (Discord)');
    console.log('Host: discord.com\n');

    const result = await solver.solve('a9b5fb07-92ff-493f-86fe-352a2803b3df', 'discord.com');
    console.log('\n=== RESULT ===');
    console.log('Token:', result.token.slice(0, 60) + '...');
    console.log('Type:', result.type);
    console.log('Elapsed:', result.elapsed + 'ms');
  } catch (err) {
    console.log('\nFAILED:', err.message);
  } finally {
    await solver.close();
  }
}

main();
