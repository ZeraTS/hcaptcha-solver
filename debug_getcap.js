'use strict';
const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const TESTS = [
  ['10000000-ffff-ffff-ffff-000000000001', 'hcaptcha.com'],   // test always-pass key
  ['4c672d35-0701-42b2-88c3-78380b0db560', 'recaptcha.net'],
];

async function main() {
  for (const [sk, host] of TESTS) {
    console.log(`\n=== ${sk.substring(0,8)} @ ${host} ===`);
    const motionData = JSON.stringify({
      v: 1,
      topLevel: { st: Date.now(), sc: { availWidth: 1920, availHeight: 1040 }, nv: { userAgent: UA, language: 'en', hardwareConcurrency: 8, maxTouchPoints: 0, vendor: '' }, dr: '', exec: false, wn: [], xy: [], mm: [] },
      st: Date.now(), dct: Date.now(), mm: [], md: [], mu: [],
      session: [], widgetList: ['0hnlmrl0mts'], widgetId: '0hnlmrl0mts',
      href: `https://${host}/`, prev: { escaped: false }
    });

    const r = await fetch(`https://hcaptcha.com/getcaptcha/${sk}`, {
      method: 'POST',
      headers: { 'User-Agent': UA, 'Content-Type': 'application/json', 'Origin': 'https://assets.hcaptcha.com', 'Referer': 'https://assets.hcaptcha.com/' },
      body: JSON.stringify({ v: '1.10.4', sitekey: sk, host, hl: 'en', motionData, pdc: { s: Date.now() } })
    });
    const cap = await r.json();
    console.log('HTTP:', r.status);
    console.log('Keys:', Object.keys(cap));
    console.log('pass:', cap.pass);
    console.log('key:', cap.key);
    console.log('generated_pass_UUID:', cap.generated_pass_UUID);
    if (cap.generated_pass_UUID) console.log('TOKEN FOUND:', cap.generated_pass_UUID);
    console.log('c.type:', cap.c?.type);
  }
}
main().catch(console.error);
