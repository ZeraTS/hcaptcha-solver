// Check the main captcha challenge JS
const https = require('https');

const CAPTCHA_URL = 'https://hcaptcha.com/captcha/v1/f4a6f30bb4f2f71cf58fd8dcd483138f9c494c52/static/hcaptcha.html';

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://accounts.hcaptcha.com/'
      }
    }, (res) => {
      console.log('Status:', res.statusCode);
      console.log('Redirect:', res.headers['location']);
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
    }).on('error', reject);
  });
}

async function main() {
  // Try to get captcha JS assets list
  const url = 'https://hcaptcha.com/captcha/v1/f4a6f30bb4f2f71cf58fd8dcd483138f9c494c52/static';
  const res = await httpsGet(url);
  console.log('Body preview:', res.body.substring(0, 1000));
  
  // Search for checkcaptcha in the body
  const idx = res.body.indexOf('checkcaptcha');
  if (idx > -1) {
    console.log('Found checkcaptcha at', idx, ':', res.body.substring(idx - 20, idx + 80));
  }
}

main().catch(console.error);
