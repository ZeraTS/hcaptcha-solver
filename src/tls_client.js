'use strict';

const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const path = require('path');
const fs = require('fs');

const SIDECAR_BIN = process.env.SIDECAR_PATH ||
  path.resolve(__dirname, '../sidecar/reqflow-sidecar');

// Chrome 133 TLS/JA3
const CHROME_JA3 = '772,4865-4866-4867-49195-49199-49196-49200-52393-52392-49171-49172-156-157-47-53,0-23-65281-10-11-35-16-5-13-18-51-45-43-27-17513-21,29-23-24,0';
const CHROME_H2FP = '1:65536,2:0,3:1000,4:6291456,6:262144|15663105|0|m,a,s,p';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';

/**
 * Convert a headers object or array-of-pairs to array-of-pairs.
 * The reqflow-sidecar binary requires headers as [[key, val], ...].
 */
function normalizeHeaders(headers) {
  if (Array.isArray(headers)) return headers;
  if (!headers || typeof headers !== 'object') return [];
  return Object.entries(headers);
}

class HCaptchaClient {
  constructor(opts = {}) {
    this.proc = null;
    this.pending = new Map();
    this.buffer = '';
    this.proxy = opts.proxy || '';
  }

  start() {
    if (this.proc) return;
    if (!fs.existsSync(SIDECAR_BIN)) {
      throw new Error(`reqflow-sidecar not found at ${SIDECAR_BIN}`);
    }
    this.proc = spawn(SIDECAR_BIN, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc.stdout.on('data', chunk => {
      this.buffer += chunk.toString();
      const lines = this.buffer.split('\n');
      this.buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const resp = JSON.parse(line);
          const p = this.pending.get(resp.id);
          if (p) { this.pending.delete(resp.id); p.resolve(resp); }
        } catch (e) {}
      }
    });
    this.proc.stderr.on('data', d => {
      const s = d.toString().trim();
      if (s) process.stderr.write('[hcaptcha-sidecar] ' + s + '\n');
    });
    this.proc.on('exit', code => {
      for (const [, p] of this.pending) p.reject(new Error('sidecar exited: ' + code));
      this.pending.clear();
      this.proc = null;
    });
  }

  stop() {
    if (this.proc) { try { this.proc.kill(); } catch(e) {} this.proc = null; }
  }

  _request(opts, timeoutMs = 30000) {
    if (!this.proc) this.start();
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('sidecar request timeout'));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (r) => { clearTimeout(timer); resolve(r); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      const req = {
        id,
        action: 'request',
        method: opts.method || 'GET',
        url: opts.url,
        headers: normalizeHeaders(opts.headers),
        body: opts.body || '',
        proxy: opts.proxy || this.proxy || '',
        browser: 'chrome',
        ja3: CHROME_JA3,
        http2fp: CHROME_H2FP,
        disable_http3: false,
        follow_redirects: true,
        max_redirects: 10,
        timeout: timeoutMs,
      };
      this.proc.stdin.write(JSON.stringify(req) + '\n');
    });
  }

  async get(url, headers = {}, proxy = '') {
    return this._request({ method: 'GET', url, headers, body: '', proxy });
  }

  async post(url, body, headers = {}, proxy = '') {
    // body should be a string (URL-encoded)
    const bodyStr = typeof body === 'string' ? body :
      (Buffer.isBuffer(body) ? body.toString('utf8') : String(body));
    const mergedHeaders = { 'Content-Type': 'application/x-www-form-urlencoded', ...headers };
    return this._request({ method: 'POST', url, headers: mergedHeaders, body: bodyStr, proxy });
  }

  async postJson(url, body, headers = {}, proxy = '') {
    const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
    const mergedHeaders = { 'Content-Type': 'application/json', ...headers };
    return this._request({ method: 'POST', url, headers: mergedHeaders, body: bodyStr, proxy });
  }

  /**
   * Parse body from sidecar response.
   * The sidecar returns body as a plain string (not base64).
   */
  static decodeBody(r) {
    if (r.error) throw new Error('sidecar error: ' + r.error);
    return r.body || '';
  }
}

module.exports = { HCaptchaClient, USER_AGENT };
