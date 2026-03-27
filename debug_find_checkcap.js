'use strict';
const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

async function main() {
  // Get the hcaptcha api.js and look for checkcaptcha endpoint
  const js = await (await fetch('https://hcaptcha.com/1/api.js', { headers: { 'User-Agent': UA } })).text();
  const checkMatch = js.match(/checkcaptcha[^'"]*['"]/g);
  console.log('checkcaptcha patterns in api.js:', checkMatch?.slice(0, 5));

  // Fetch the main hcaptcha bundle to find the real endpoint
  const bundleUrl = js.match(/(https:\/\/[^"']+\.js)['"]/)?.[1];
  console.log('Bundle URL:', bundleUrl);
  
  if (bundleUrl) {
    const bundle = await (await fetch(bundleUrl, { headers: { 'User-Agent': UA } })).text();
    // Search for checkcaptcha endpoint
    const patterns = bundle.match(/["'][^"']*checkcaptcha[^"']*["']/g);
    console.log('checkcaptcha in bundle:', patterns?.slice(0, 10));
    
    // Also look for the check endpoint pattern
    const apiPatterns = bundle.match(/["']\/(check|submit)[^"']*["']/g);
    console.log('check/submit patterns:', apiPatterns?.slice(0, 5));
  }

  // Direct test: try the getcaptcha with hsl challenge site
  const sk = '00000000-0000-0000-0000-000000000000';
  const host = 'dummy-hcaptcha-bypass.com';
  
  // Try various checkcaptcha URL formats with a real captcha key
  // First get a real key from getcaptcha
  const motionData = JSON.stringify({ v: 1, topLevel: { st: Date.now() }, st: Date.now(), dct: Date.now(), mm: [], md: [], mu: [] });
  
  // Use a sitekey known to use hsl (simpler algo)
  const HSL_SITEKEY = 'b4c45857-0e23-48e6-9018-797b71f9c5e1';
  const r = await fetch(`https://hcaptcha.com/getcaptcha/${HSL_SITEKEY}`, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/json', 'Origin': 'https://assets.hcaptcha.com' },
    body: JSON.stringify({ v: '1.10.4', sitekey: HSL_SITEKEY, host: 'www.nintendo.com', hl: 'en', motionData, pdc: { s: Date.now() } })
  });
  const cap = await r.json();
  console.log('\nGetcaptcha response type:', cap.c?.type);
  console.log('pass:', cap.pass);
  console.log('keys:', Object.keys(cap));
}
main().catch(console.error);
