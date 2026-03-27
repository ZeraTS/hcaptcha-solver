// Find the actual endpoint from hcaptcha bundle JS
const https = require('https');

function httpsGet(url, followRedirects = true) {
  return new Promise((resolve, reject) => {
    const makeRequest = (url) => {
      https.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        }
      }, (res) => {
        if (followRedirects && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          makeRequest(res.headers.location);
          return;
        }
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      }).on('error', reject);
    };
    makeRequest(url);
  });
}

async function main() {
  // Get the manifest to find JS files
  const manifest = await httpsGet('https://www.hcaptcha.com/captcha/v1/f4a6f30bb4f2f71cf58fd8dcd483138f9c494c52/static/getcaptcha-manifest.json');
  console.log('Manifest status:', manifest.status);
  console.log('Manifest:', manifest.body.substring(0, 500));
}

main().catch(console.error);
