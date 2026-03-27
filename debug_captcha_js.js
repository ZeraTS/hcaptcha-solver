// Get hcaptcha challenge JS and find endpoints
const https = require('https');

function httpsGet(url, followRedirects = true) {
  return new Promise((resolve, reject) => {
    const makeRequest = (url, depth = 0) => {
      if (depth > 5) { reject(new Error('Too many redirects')); return; }
      https.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
      }, (res) => {
        if (followRedirects && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const loc = res.headers.location;
          const nextUrl = loc.startsWith('http') ? loc : ('https://hcaptcha.com' + loc);
          makeRequest(nextUrl, depth + 1);
          return;
        }
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => resolve({ status: res.statusCode, body: data, url }));
      }).on('error', reject);
    };
    makeRequest(url);
  });
}

async function main() {
  // Get the actual challenge frame HTML to find linked JS files
  const frame = await httpsGet('https://hcaptcha.com/captcha/v1/f4a6f30bb4f2f71cf58fd8dcd483138f9c494c52/static/hcaptcha.html');
  console.log('Frame status:', frame.status, 'URL:', frame.url);
  
  // Look for JS script tags
  const scripts = frame.body.match(/src="([^"]+\.js[^"]*)"/g);
  console.log('Scripts:', scripts);
  
  // Also check for any API endpoints directly
  const api = frame.body.match(/\/checkcaptcha|\/getcaptcha/g);
  console.log('API endpoints found:', api);
  
  // Show first 1000 chars
  console.log('\nBody preview:', frame.body.substring(0, 500));
}

main().catch(console.error);
