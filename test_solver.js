'use strict';

const { HCaptchaSolver } = require('./src/solver');

async function main() {
  console.log('hCaptcha Solver Test');
  console.log('====================');
  console.log('Sitekey: 4c672d35-0701-42b2-88c3-78380b0db560');
  console.log('Host: democaptcha.com');
  console.log('');

  const solver = new HCaptchaSolver({
    sitekey: '4c672d35-0701-42b2-88c3-78380b0db560',
    host: 'democaptcha.com',
    debug: true,
    timeout: 60000,
  });

  try {
    console.log('Starting solve...');
    const result = await solver.solve();
    console.log('\nSUCCESS!');
    console.log('Token:', result.token);
    console.log('Type:', result.type);
    console.log('Elapsed:', result.elapsed + 'ms');

    // Verify token format
    if (result.token.startsWith('P0_') || result.token.startsWith('P1_') || result.token.startsWith('P2_')) {
      console.log('\nToken format verified.');
    } else {
      console.log('\nWarning: Unexpected token format:', result.token.slice(0, 30));
    }

  } catch (err) {
    console.error('\nFAILED:', err.message);
    if (err.stack) {
      console.error(err.stack.split('\n').slice(0, 5).join('\n'));
    }
    process.exit(1);
  }
}

main();
