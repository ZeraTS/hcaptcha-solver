'use strict';
const { fetch } = require('undici');
const { solvePoW } = require('./src/pow');

async function test() {
  const sitekey = '4c672d35-0701-42b2-88c3-78380b0db560';
  const host = 'accounts.hcaptcha.com';
  
  // Get version
  const apiResp = await fetch('https://js.hcaptcha.com/1/api.js', { headers: { 'User-Agent': 'Mozilla/5.0 Chrome/120' } });
  const apiText = await apiResp.text();
  const vMatch = apiText.match(/captcha\/v1\/([a-f0-9]+)/);
  const version = vMatch[1];
  console.log('version:', version);

  // checksiteconfig
  const cfgResp = await fetch('https://hcaptcha.com/checksiteconfig?v=' + version + '&host=' + host + '&sitekey=' + sitekey + '&sc=1&swa=1&spst=0', {
    headers: { 'User-Agent': 'Mozilla/5.0 Chrome/120', 'Origin': 'https://' + host }
  });
  const cfg = await cfgResp.json();
  console.log('Config:', JSON.stringify(cfg).slice(0, 300));
  
  // Solve PoW
  const proof = await solvePoW(cfg.c.req, 'https://newassets.hcaptcha.com');
  console.log('PoW proof:', proof.slice(0, 80));
  
  // getcaptcha
  const motionData = Buffer.from(JSON.stringify({
    st: Date.now(), dct: Date.now(),
    mm: [[100, 200, Date.now()-500], [300, 400, Date.now()-200]],
    md: [[300, 400, Date.now()-100]], mu: [[300, 400, Date.now()-50]],
    v: 1,
    topLevel: {
      st: Date.now(),
      sc: { availWidth: 1920, availHeight: 1040 },
      nv: { userAgent: 'Mozilla/5.0 Chrome/120', language: 'en-US', hardwareConcurrency: 8, maxTouchPoints: 0, vendor: 'Google Inc.' },
      dr: '', exec: false, wn: [], xy: [], mm: []
    },
    session: [], widgetList: ['0hnlmrl0mts'], widgetId: '0hnlmrl0mts',
    href: 'https://' + host + '/', prev: { escaped: false }
  })).toString('base64');
  
  const body = new URLSearchParams({
    v: version, sitekey, host, hl: 'en', motionData, n: proof,
    c: JSON.stringify(cfg.c),
    pdc: JSON.stringify({ s: Date.now(), n: 0, p: 0, gcs: 10 })
  });

  console.log('\nSending getcaptcha to:', 'https://hcaptcha.com/getcaptcha/' + sitekey);
  const capResp = await fetch('https://hcaptcha.com/getcaptcha/' + sitekey, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120',
      'Origin': 'https://' + host,
      'Referer': 'https://' + host + '/',
    },
    body: body.toString()
  });
  const cap = await capResp.json();
  console.log('getcaptcha status:', capResp.status);
  console.log('getcaptcha keys:', Object.keys(cap));
  console.log('getcaptcha.key:', cap.key);
  console.log('getcaptcha.pass:', cap.pass);
  console.log('getcaptcha.generated_pass_UUID:', cap.generated_pass_UUID);
  console.log('getcaptcha.c.type:', cap.c?.type);
  console.log('getcaptcha.tasklist length:', cap.tasklist?.length);
  console.log('Full getcaptcha response:', JSON.stringify(cap).slice(0, 1000));
}
test().catch(console.error);
