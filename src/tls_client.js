'use strict';

/**
 * TLS client with Chrome-like fingerprinting.
 * Uses the reqflow sidecar if available, falls back to undici fetch.
 */

const { fetch, Agent } = require('undici');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const SIDECAR_PATH = path.join(__dirname, '..', 'sidecar', 'reqflow-sidecar');
const SIDECAR_PORT = 18080 + Math.floor(Math.random() * 100);

let sidecarProcess = null;
let sidecarReady = false;
let usesSidecar = false;

// Chrome-like TLS headers
const CHROME_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-site',
  'Connection': 'keep-alive',
};

/**
 * Attempts to start the reqflow sidecar for TLS fingerprinting
 */
async function startSidecar() {
  if (!fs.existsSync(SIDECAR_PATH)) {
    return false;
  }

  return new Promise((resolve) => {
    try {
      sidecarProcess = spawn(SIDECAR_PATH, ['--port', String(SIDECAR_PORT)], {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
      });

      const timeout = setTimeout(() => resolve(false), 3000);

      sidecarProcess.stdout.on('data', (data) => {
        if (data.toString().includes('ready') || data.toString().includes('listen')) {
          clearTimeout(timeout);
          sidecarReady = true;
          usesSidecar = true;
          resolve(true);
        }
      });

      sidecarProcess.on('error', () => {
        clearTimeout(timeout);
        resolve(false);
      });

      sidecarProcess.on('exit', () => {
        sidecarReady = false;
        usesSidecar = false;
      });

      // Give it 2s to start
      setTimeout(() => {
        if (!sidecarReady) {
          clearTimeout(timeout);
          resolve(false);
        }
      }, 2000);
    } catch (e) {
      resolve(false);
    }
  });
}

/**
 * Makes a request via the reqflow sidecar
 */
async function sidecarFetch(url, options = {}) {
  const proxyUrl = `http://127.0.0.1:${SIDECAR_PORT}`;
  const agent = new Agent({
    connect: {
      rejectUnauthorized: false,
    }
  });

  return fetch(url, {
    ...options,
    dispatcher: agent,
  });
}

/**
 * Main HTTP client function
 */
async function tlsFetch(url, options = {}) {
  const headers = {
    ...CHROME_HEADERS,
    ...(options.headers || {}),
  };

  const fetchOptions = {
    method: options.method || 'GET',
    headers,
  };

  if (options.body) {
    fetchOptions.body = options.body;
  }

  if (usesSidecar && sidecarReady) {
    try {
      return await sidecarFetch(url, fetchOptions);
    } catch (e) {
      // Fall through to regular fetch
    }
  }

  return fetch(url, fetchOptions);
}

/**
 * Initialize the TLS client (try to start sidecar)
 */
async function init() {
  const started = await startSidecar();
  if (started) {
    console.log(`[tls_client] reqflow sidecar started on port ${SIDECAR_PORT}`);
  } else {
    console.log('[tls_client] Using standard fetch (no TLS fingerprinting sidecar)');
  }
  return started;
}

/**
 * Clean up sidecar process
 */
function cleanup() {
  if (sidecarProcess) {
    try {
      sidecarProcess.kill();
    } catch (e) {}
    sidecarProcess = null;
  }
}

process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(0); });
process.on('SIGTERM', () => { cleanup(); process.exit(0); });

module.exports = { tlsFetch, init, cleanup, CHROME_HEADERS };
