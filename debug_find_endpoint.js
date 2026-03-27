'use strict';
const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

async function main() {
  // Get the main hcaptcha JS bundle URLs
  const apiJs = await (await fetch('https://hcaptcha.com/1/api.js', { headers: { 'User-Agent': UA } })).text();
  
  // Find all JS URLs in api.js
  const urlMatches = [...apiJs.matchAll(/https:\/\/[a-z0-9._/-]+\.js/g)].map(m => m[0]);
  console.log('JS URLs found:', urlMatches.slice(0, 5));

  // Try to get the captcha bundle
  const captchaBundle = 'https://newassets.hcaptcha.com/c/main.js';
  
  // Search api.js itself for checkcaptcha
  const idx = apiJs.indexOf('checkcaptcha');
  if (idx >= 0) {
    console.log('Found in api.js at', idx, ':', apiJs.substring(Math.max(0, idx-50), idx+100));
  } else {
    console.log('checkcaptcha not directly in api.js');
    // Look for the bundle reference
    const bundleMatch = apiJs.match(/src="([^"]+)"/g);
    console.log('src refs:', bundleMatch?.slice(0, 3));
  }

  // Try the hsw bundle approach - get the WASM module URL
  const hswMatch = apiJs.match(/"(https:\/\/[^"]*hsw[^"]*\.js)"/);
  console.log('HSW URL:', hswMatch?.[1]);

  // What about the captcha check endpoint - try v3 format  
  const endpoints = [
    'https://hcaptcha.com/checkcaptcha/enterprise',
    'https://hcaptcha.com/checkcaptcha?s=test',
    'https://hcaptcha.com/checkverify',
    'https://api2.hcaptcha.com/checkcaptcha',
    'https://hcaptcha.com/siteverify',
  ];
  
  for (const ep of endpoints) {
    const r = await fetch(ep, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    console.log(`${ep.replace('https://hcaptcha.com','')}: ${r.status}`);
  }
}
main().catch(console.error);
