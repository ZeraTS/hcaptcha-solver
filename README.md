hcaptcha-solver
===============

A Node.js hCaptcha solver that runs the real hCaptcha PoW script (hsw.js)
inside a Node.js VM sandbox and performs the full challenge flow over HTTP.

No Playwright, no browser driver. Pure HTTP requests + VM execution.

Architecture
============

The solver implements the full hCaptcha flow:

1. checksiteconfig  - GET the site config and PoW challenge JWT
2. PoW solve        - Download and run hsw.js inside Node.js vm module
3. getcaptcha       - POST to retrieve the challenge session and task list
4. checkcaptcha     - POST answers (true for all image tasks) to get the token
5. Token            - Parse generated_pass_UUID from the response

The PoW system uses hsw.js, a WebAssembly-backed SHA256 hashcash script.
It is fetched from the hCaptcha CDN at runtime and executed in a sandboxed
Node.js VM context with a mocked browser environment.

Files
=====

src/solver.js      - Main HCaptchaSolver class, full solve flow
src/pow.js         - hsw.js downloader and VM runner
src/motion.js      - Fake mouse/keyboard motion data generator
src/tls_client.js  - HTTP client with Chrome-like headers
test_solver.js     - Integration test

Usage
=====

    const { HCaptchaSolver } = require('./src/solver');

    const solver = new HCaptchaSolver({
      sitekey: '4c672d35-0701-42b2-88c3-78380b0db560',
      host: 'democaptcha.com',
      debug: true,
    });

    const result = await solver.solve();
    console.log(result.token);

Requirements
============

Node.js 18+
undici (npm install undici)

Known Limitations
=================

hCaptcha actively detects automation. The VM environment may trigger
bot detection on some configurations. The solver works best with the
demo sitekey and may require additional browser fingerprinting for
production deployments.

The sidecar/ directory may contain a reqflow TLS fingerprinting proxy
for Chrome-like JA3/JA4 fingerprints.
