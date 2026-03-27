const http = require('http');
const { HCaptchaSolver } = require('./solver');

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.HCAPTCHA_API_KEY || '';

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch (e) {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

const solver = new HCaptchaSolver({ debug: process.env.DEBUG === '1' });

const server = http.createServer(async (req, res) => {
  // Health check
  if (req.method === 'GET' && req.url === '/health') {
    return sendJSON(res, 200, { status: 'ok' });
  }

  // Auth check
  if (API_KEY) {
    const key = req.headers['x-api-key'];
    if (key !== API_KEY) {
      return sendJSON(res, 401, { error: 'Unauthorized' });
    }
  }

  // Solve endpoint
  if (req.method === 'POST' && req.url === '/solve') {
    const body = await readBody(req);
    const { sitekey, host } = body;

    if (!sitekey || !host) {
      return sendJSON(res, 400, { error: 'Missing sitekey or host' });
    }

    try {
      const token = await solver.solve(sitekey, host);
      return sendJSON(res, 200, { token });
    } catch (err) {
      console.error('Solver error:', err.message);
      return sendJSON(res, 500, { error: err.message });
    }
  }

  sendJSON(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`hCaptcha solver server running on port ${PORT}`);
  if (API_KEY) {
    console.log('API key authentication enabled');
  } else {
    console.log('WARNING: No API key set. Set HCAPTCHA_API_KEY env var to enable auth.');
  }
});

module.exports = server;
