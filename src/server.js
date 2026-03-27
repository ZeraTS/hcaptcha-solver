'use strict';

const http = require('http');
const { HCaptchaSolver } = require('./solver');

const PORT = parseInt(process.env.PORT || '3000', 10);
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
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function checkAuth(req) {
  if (!API_KEY) return true;
  const key = req.headers['x-api-key'];
  return key === API_KEY;
}

const solver = new HCaptchaSolver({ debug: process.env.DEBUG === '1' });

const server = http.createServer(async (req, res) => {
  // Health check — no auth required
  if (req.method === 'GET' && req.url === '/health') {
    return sendJSON(res, 200, { status: 'ok', version: require('../package.json').version });
  }

  // Auth check for all other endpoints
  if (!checkAuth(req)) {
    return sendJSON(res, 401, { error: 'Unauthorized' });
  }

  // POST /solve — solve a captcha
  if (req.method === 'POST' && req.url === '/solve') {
    const body = await readBody(req);
    const { sitekey, host, proxy } = body;

    if (!sitekey || !host) {
      return sendJSON(res, 400, { error: 'Missing required fields: sitekey, host' });
    }

    try {
      const s = new HCaptchaSolver({
        debug: process.env.DEBUG === '1',
        proxy: proxy || '',
      });
      const result = await s.solve(sitekey, host);
      s.close();
      return sendJSON(res, 200, {
        token: result.token,
        elapsed: result.elapsed,
        type: result.type,
      });
    } catch (err) {
      console.error('[server] Solver error:', err.message);
      return sendJSON(res, 500, { error: err.message });
    }
  }

  // POST /invalidate — placeholder for token invalidation tracking
  if (req.method === 'POST' && req.url === '/invalidate') {
    const body = await readBody(req);
    const { token } = body;
    if (!token) {
      return sendJSON(res, 400, { error: 'Missing token' });
    }
    // Future: track invalidated tokens
    return sendJSON(res, 200, { ok: true });
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

process.on('SIGTERM', () => { solver.close(); server.close(); });
process.on('SIGINT', () => { solver.close(); server.close(); process.exit(0); });

module.exports = server;
