'use strict';
const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

const SITEKEY = 'a5f74b19-9e45-40e0-b45d-47ff91b7a6c2';
const HOST = 'accounts.hcaptcha.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

async function main() {
  // Get version
  const apiJs = await (await fetch('https://hcaptcha.com/1/api.js', { headers: { 'User-Agent': UA } })).text();
  const vMatch = apiJs.match(/v=([0-9a-f.]+)/);
  const version = vMatch ? vMatch[1] : '1.10.4';
  console.log('Version:', version);

  // checksiteconfig
  const configUrl = `https://hcaptcha.com/checksiteconfig?v=${version}&host=${HOST}&sitekey=${SITEKEY}&sc=1&swa=1`;
  const config = await (await fetch(configUrl, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/json', 'Origin': 'https://assets.hcaptcha.com' }
  })).json();
  console.log('Config:', JSON.stringify(config).substring(0, 200));

  // getcaptcha  
  const motionData = JSON.stringify({ v: 1, topLevel: { st: Date.now(), sc: { availWidth: 1920, availHeight: 1040 }, nv: { userAgent: UA, language: 'en', hardwareConcurrency: 8, maxTouchPoints: 0 }, dr: '', exec: false, wn: [], xy: [], mm: [] }, st: Date.now(), dct: Date.now(), mm: [], md: [], mu: [], session: [], widgetList: ['0hnlmrl0mts'], widgetId: '0hnlmrl0mts', href: `https://${HOST}/`, prev: { escaped: false } });

  const capRes = await fetch(`https://hcaptcha.com/getcaptcha/${SITEKEY}`, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/json', 'Origin': 'https://assets.hcaptcha.com', 'Referer': 'https://assets.hcaptcha.com/' },
    body: JSON.stringify({ v: version, sitekey: SITEKEY, host: HOST, hl: 'en', motionData, pdc: { s: Date.now() } })
  });
  const cap = await capRes.json();
  console.log('GetCap:', JSON.stringify(cap).substring(0, 300));
  console.log('Key:', cap.key);

  // The checkcaptcha URL - try with key in query params
  if (cap.key) {
    const urls = [
      `https://hcaptcha.com/checkcaptcha/${SITEKEY}?s=${cap.key}`,
      `https://hcaptcha.com/checkcaptcha/${SITEKEY}`,
      `https://hcaptcha.com/checkcaptcha`,
    ];
    for (const url of urls) {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'User-Agent': UA, 'Content-Type': 'application/json', 'Origin': 'https://assets.hcaptcha.com' },
        body: JSON.stringify({ v: version, job_mode: 'hsl', answers: {}, serverdomain: HOST, sitekey: SITEKEY, motionData, n: cap.key, c: 'null' })
      });
      console.log(`${url.substring(0, 60)}: HTTP ${r.status}`);
      if (r.status !== 404) {
        const body = await r.text();
        console.log('Body:', body.substring(0, 300));
        break;
      }
    }
  }
}

main().catch(console.error);
