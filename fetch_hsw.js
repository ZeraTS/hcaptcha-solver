// Fetch and analyze the hsw.js content
const https = require('https');

const path = '/c/e0b31f2b8edaeb58169142caa103fef015a25e4056324adee77f1e1f4d88dc87';
const url = 'https://newassets.hcaptcha.com' + path;

https.get(url, {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  }
}, (res) => {
  console.log('Status:', res.statusCode);
  console.log('Content-Type:', res.headers['content-type']);
  let data = Buffer.alloc(0);
  res.on('data', chunk => { data = Buffer.concat([data, chunk]); });
  res.on('end', () => {
    console.log('Length:', data.length);
    // First 500 chars if text
    const text = data.toString('utf8', 0, Math.min(500, data.length));
    console.log('Preview:', text);
  });
}).on('error', err => {
  console.error('Error:', err.message);
});
