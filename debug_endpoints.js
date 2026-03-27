// Check what endpoints exist in hcaptcha api.js
const https = require('https');

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    }).on('error', reject);
  });
}

async function main() {
  const res = await httpsGet('https://hcaptcha.com/1/api.js');
  const text = res.body;
  
  // Find checkcaptcha endpoint
  const checkMatch = text.match(/checkcaptcha[^"'\s]*/g);
  console.log('checkcaptcha mentions:', checkMatch ? [...new Set(checkMatch)].slice(0, 10) : 'none');
  
  // Find getcaptcha endpoint
  const getMatch = text.match(/getcaptcha[^"'\s]*/g);
  console.log('getcaptcha mentions:', getMatch ? [...new Set(getMatch)].slice(0, 10) : 'none');
  
  // Find api domain
  const domain = text.match(/hcaptcha\.com[^"'\s]*/g);
  console.log('domain mentions:', domain ? [...new Set(domain)].slice(0, 20) : 'none');
  
  // Look for iframe/endpoint patterns
  const iframe = text.match(/"[^"]*\/[a-z]+captcha[^"]*"/g);
  console.log('captcha endpoints:', iframe ? [...new Set(iframe)].slice(0, 20) : 'none');
}

main().catch(console.error);
