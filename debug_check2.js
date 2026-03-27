// Debug checkcaptcha endpoint with version param
const https = require('https');

const sitekey = '4c672d35-0701-42b2-88c3-78380b0db560';
const version = '1.10.4';
const body = JSON.stringify({
  v: version,
  job_mode: 'hsl',
  answers: {},
  serverdomain: 'accounts.hcaptcha.com',
  sitekey,
  motionData: '{}',
  n: 'test',
  c: 'null'
});

const options = {
  hostname: 'hcaptcha.com',
  path: `/checkcaptcha/${sitekey}?v=${version}`,
  method: 'POST',
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Origin': 'https://assets.hcaptcha.com',
    'Referer': 'https://assets.hcaptcha.com/'
  }
};

console.log('Sending request to:', options.hostname + options.path);
const req = https.request(options, (res) => {
  console.log('Status:', res.statusCode);
  let data = '';
  res.on('data', chunk => { data += chunk; });
  res.on('end', () => {
    console.log('Response:', data.substring(0, 500));
  });
});
req.on('error', err => console.error('Error:', err));
req.write(body);
req.end();
