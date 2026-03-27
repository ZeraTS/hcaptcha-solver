'use strict';

const vm = require('vm');
const { webcrypto } = require('crypto');
const { fetch } = require('undici');

// Cache for downloaded hsw scripts
const scriptCache = new Map();

function atob(str) {
  return Buffer.from(str, 'base64').toString('binary');
}

function btoa(str) {
  return Buffer.from(str, 'binary').toString('base64');
}

/**
 * Downloads the hsw.js script from hcaptcha CDN
 */
async function fetchHswScript(scriptUrl) {
  if (scriptCache.has(scriptUrl)) {
    return scriptCache.get(scriptUrl);
  }

  const resp = await fetch(scriptUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://newassets.hcaptcha.com/',
      'Origin': 'https://newassets.hcaptcha.com',
    }
  });

  if (!resp.ok) {
    throw new Error(`Failed to fetch hsw script: ${resp.status} from ${scriptUrl}`);
  }

  const code = await resp.text();
  scriptCache.set(scriptUrl, code);
  return code;
}

/**
 * Runs hsw.js in a Node.js VM sandbox and calls the solve function
 * @param {string} code - The hsw.js source code
 * @param {string} reqJwt - The PoW challenge JWT from checksiteconfig
 * @returns {Promise<string>} The proof string
 */
async function runHswInVm(code, reqJwt) {
  return new Promise((resolve, reject) => {
    const mockDocument = new Proxy({}, {
      get: (target, prop) => {
        if (prop === 'hidden') return false;
        if (prop === 'cookie') return '';
        if (prop === 'createElement') return (tag) => {
          const el = { style: {}, classList: { add: () => {}, remove: () => {} } };
          return new Proxy(el, {
            get: (t, p) => p in t ? t[p] : undefined,
            set: (t, p, v) => { t[p] = v; return true; }
          });
        };
        if (prop === 'getElementById') return () => null;
        if (prop === 'getElementsByTagName') return () => [];
        if (prop === 'addEventListener') return () => {};
        if (prop === 'removeEventListener') return () => {};
        if (prop === 'querySelector') return () => null;
        if (prop === 'querySelectorAll') return () => [];
        if (prop === 'body') return new Proxy({}, {
          get: (t, p) => p === 'style' ? {} : p === 'classList' ? { add: () => {}, remove: () => {} } : (typeof t[p] !== 'undefined' ? t[p] : () => {}),
          set: (t, p, v) => { t[p] = v; return true; }
        });
        if (prop === 'head') return { appendChild: () => {} };
        if (prop === 'documentElement') return { clientWidth: 1920, clientHeight: 1080, scrollTop: 0 };
        if (prop === 'location') return { href: 'https://newassets.hcaptcha.com/', hostname: 'newassets.hcaptcha.com' };
        return () => {};
      }
    });

    const exportedFns = {};

    const mockWindow = new Proxy({
      postMessage: () => {},
      addEventListener: (evt, fn) => {
        mockWindow._handlers = mockWindow._handlers || {};
        mockWindow._handlers[evt] = fn;
      },
      dispatchEvent: () => {},
      _handlers: {},
      crypto: webcrypto,
      performance: { now: () => Date.now(), timing: { navigationStart: Date.now() } },
      navigator: {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        language: 'en-US',
        platform: 'Win32',
        languages: ['en-US', 'en'],
        hardwareConcurrency: 4,
        onLine: true
      },
      document: mockDocument,
      location: { href: 'https://newassets.hcaptcha.com/', hostname: 'newassets.hcaptcha.com', origin: 'https://newassets.hcaptcha.com', protocol: 'https:' },
      screen: { width: 1920, height: 1080, colorDepth: 24, availWidth: 1920, availHeight: 1040 },
      devicePixelRatio: 1,
      innerWidth: 1920,
      innerHeight: 1080,
      localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
      sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
      fetch: async (url) => {
        // Return empty success for any internal fetch calls
        return {
          ok: true,
          status: 200,
          json: async () => ({}),
          text: async () => '',
          arrayBuffer: async () => new ArrayBuffer(0),
        };
      },
      XMLHttpRequest: function () {
        return { open: () => {}, send: () => {}, setRequestHeader: () => {}, status: 200, responseText: '{}' };
      },
      Worker: function () { return { postMessage: () => {}, addEventListener: () => {} }; },
      WebSocket: function () {},
      HTMLElement: function () {},
      Event: function (type) { return { type, bubbles: false }; },
      CustomEvent: function (type, opts) { return { type, detail: opts && opts.detail }; },
      atob,
      btoa,
      eval: (code) => { try { return vm.runInNewContext(code, sandbox); } catch(e) { return undefined; } },
      Function: Function,
      // Globals accessed via window["Number"], window["String"], etc.
      Number, String, Boolean, Object, Array, RegExp, Date, Symbol,
      Map, Set, WeakMap, WeakSet,
      Error, TypeError, RangeError, SyntaxError, EvalError, URIError,
      Math, JSON, Promise,
      parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent,
      Uint8Array, Int8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array,
      Float32Array, Float64Array, ArrayBuffer, DataView,
      URL, URLSearchParams,
      TextEncoder, TextDecoder,
    }, {
      get: (target, prop) => {
        if (prop in target) return target[prop];
        if (prop in exportedFns) return exportedFns[prop];
        return undefined;
      },
      set: (target, prop, val) => {
        target[prop] = val;
        if (['hsw', 'hsl', 'hsj'].includes(prop) && typeof val === 'function') {
          exportedFns[prop] = val;
        }
        return true;
      }
    });

    const sandbox = {
      self: mockWindow,
      window: mockWindow,
      document: mockDocument,
      navigator: mockWindow.navigator,
      crypto: webcrypto,
      performance: mockWindow.performance,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      Promise,
      console: { log: () => {}, warn: () => {}, error: () => {}, info: () => {} },
      TextEncoder,
      TextDecoder,
      Uint8Array, Int8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array,
      Float32Array, Float64Array, ArrayBuffer, DataView,
      JSON, Math, Date, Error, TypeError, RangeError, SyntaxError, EvalError, URIError,
      Object, Array, Function, RegExp, String, Number, Boolean, Symbol,
      Map, Set, WeakMap, WeakSet,
      atob, btoa,
      location: mockWindow.location,
      screen: mockWindow.screen,
      fetch: mockWindow.fetch,
      XMLHttpRequest: mockWindow.XMLHttpRequest,
      Worker: mockWindow.Worker,
      WebSocket: mockWindow.WebSocket,
      HTMLElement: mockWindow.HTMLElement,
      Event: mockWindow.Event,
      CustomEvent: mockWindow.CustomEvent,
      devicePixelRatio: 1,
      innerWidth: 1920,
      innerHeight: 1080,
      URL,
      URLSearchParams,
      // Pass the real Node.js Function constructor so new Function(...) works inside the VM
      Function: Function,
      eval: (code) => { try { return vm.runInNewContext(code, sandbox); } catch(e) { return undefined; } },
    };

    sandbox.global = sandbox;
    sandbox.globalThis = sandbox;

    try {
      vm.runInNewContext(code, sandbox);
    } catch (e) {
      return reject(new Error(`Failed to run hsw.js in VM: ${e.message}`));
    }

    const hswFn = exportedFns.hsw || mockWindow.hsw || sandbox.hsw;
    if (!hswFn || typeof hswFn !== 'function') {
      return reject(new Error('hsw function not found after VM execution'));
    }

    const timeout = setTimeout(() => {
      reject(new Error('hsw PoW solve timed out after 30s'));
    }, 30000);

    Promise.resolve()
      .then(() => hswFn(reqJwt))
      .then((result) => {
        clearTimeout(timeout);
        resolve(result);
      })
      .catch((err) => {
        clearTimeout(timeout);
        reject(new Error(`hsw solve error: ${err.message || err}`));
      });
  });
}

/**
 * Parses the challenge JWT to extract the script URL
 */
function parseChallengeJwt(reqJwt) {
  const parts = reqJwt.split('.');
  if (parts.length < 2) throw new Error('Invalid JWT format');

  let payload = parts[1];
  // Add padding
  payload += '='.repeat((4 - payload.length % 4) % 4);
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  return data;
}

/**
 * Solves the hcaptcha PoW challenge
 * @param {string} reqJwt - The JWT from checksiteconfig c.req field
 * @param {string} assetDomain - Base domain for assets (default: newassets.hcaptcha.com)
 * @returns {Promise<string>} The proof string to submit
 */
async function solvePoW(reqJwt, assetDomain = 'https://newassets.hcaptcha.com') {
  const payload = parseChallengeJwt(reqJwt);

  if (!payload.n || !['hsw', 'hsl', 'hsj'].includes(payload.n)) {
    throw new Error(`Unsupported PoW type: ${payload.n}`);
  }

  let scriptUrl = payload.l || '';

  // Build full URL
  if (scriptUrl.startsWith('/')) {
    scriptUrl = assetDomain + scriptUrl;
  }

  // Append /hsw.js if no .js extension
  if (!scriptUrl.endsWith('.js')) {
    scriptUrl += `/${payload.n}.js`;
  }

  const code = await fetchHswScript(scriptUrl);
  const proof = await runHswInVm(code, reqJwt);

  if (!proof || typeof proof !== 'string') {
    throw new Error(`PoW solve returned invalid proof: ${JSON.stringify(proof)}`);
  }

  return proof;
}

module.exports = { solvePoW, parseChallengeJwt, fetchHswScript, runHswInVm };
