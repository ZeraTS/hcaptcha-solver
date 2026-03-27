# hcaptcha-solver

HTTP service and library for solving hCaptcha challenges via HSW PoW and Chrome TLS fingerprinting.
Returns valid P1_ tokens without a browser.

---

## Architecture

The solver follows the official hCaptcha widget flow over pure HTTP:

```
Client
  |
  |  POST /solve { sitekey, host }
  v
[server.js]
  |
  |  1. GET /checksiteconfig?v=...&host=...&sitekey=...
  v
[hcaptcha.com]  <-- undici fetch (low-risk CDN call)
  |
  |  returns { pass: true, c: { type: "hsw", req: "<JWT>" } }
  v
[pow.js]  -- downloads hsw.js, runs HSW PoW in Node.js VM sandbox
  |
  |  returns PoW proof token
  v
[sidecar: reqflow-sidecar]  <-- Chrome 133 TLS/JA3 fingerprint
  |
  |  2. POST /getcaptcha/{sitekey}  (form-encoded, PoW proof in n=)
  v
[hcaptcha.com]
  |
  |  returns { generated_pass_UUID } (immediate pass)
  |    OR   { key, tasklist, c: { req: "<JWT>" } } (image challenge)
  v
[pow.js]  -- solve second PoW challenge from getcaptcha response
  |
  v
[sidecar]
  |
  |  3. POST /checkcaptcha/{sitekey}/{key}  (JSON, answers + PoW proof)
  v
[hcaptcha.com]
  |
  |  returns { generated_pass_UUID: "P1_..." }
  v
Client  <-- token
```

---

## Installation

```bash
npm install
```

The `sidecar/reqflow-sidecar` binary (Go) must be present and executable:

```bash
chmod +x sidecar/reqflow-sidecar
```

---

## Usage

### Start the server

```bash
node src/server.js
# or
npm start
```

### Run tests

```bash
# Test sitekey only (always passes)
npm test

# Test sitekey + real production sitekey (exercises PoW VM)
npm run test:real
```

### API

#### GET /health

Returns server status. No authentication required.

**Response:**
```json
{ "status": "ok", "version": "1.0.0" }
```

#### POST /solve

Solve an hCaptcha challenge and return a token.

**Headers:**

| Header      | Value             | Required      |
|-------------|-------------------|---------------|
| X-Api-Key   | your API key      | If key is set |
| Content-Type| application/json  | Yes           |

**Body:**

| Field   | Type   | Required | Description                        |
|---------|--------|----------|------------------------------------|
| sitekey | string | Yes      | hCaptcha sitekey for the target    |
| host    | string | Yes      | Hostname where the captcha appears |
| proxy   | string | No       | Proxy URL (e.g. http://user:pass@host:port) |

**Response:**

```json
{
  "token": "P1_eyJ...",
  "elapsed": 4231,
  "type": "immediate"
}
```

`type` is one of: `immediate` (no image challenge) or `image_solved` (image challenge answered).

#### POST /invalidate

Mark a token as used/invalid for tracking purposes.

**Body:**

| Field | Type   | Required | Description     |
|-------|--------|----------|-----------------|
| token | string | Yes      | Token to invalidate |

---

## Environment Variables

| Variable           | Default | Description                                      |
|--------------------|---------|--------------------------------------------------|
| PORT               | 3000    | HTTP server listen port                          |
| HCAPTCHA_API_KEY   | (none)  | API key for X-Api-Key auth. Leave unset to disable auth |
| DEBUG              | 0       | Set to `1` for verbose solver logs               |
| SIDECAR_PATH       | (auto)  | Override path to reqflow-sidecar binary          |

---

## How It Works

### 1. checksiteconfig

Fetches the PoW challenge JWT from hCaptcha's config endpoint. Uses standard undici fetch — this is a low-risk CDN call that doesn't require TLS fingerprinting.

### 2. HSW PoW (pow.js)

Downloads `hsw.js` from hCaptcha's asset CDN, runs it in a Node.js VM sandbox, and solves the hashcash proof-of-work. This produces the `n=` token required by getcaptcha.

### 3. getcaptcha + checkcaptcha

Submitted via `reqflow-sidecar` (stdin/stdout JSON protocol) which applies Chrome 133 TLS fingerprinting (JA3 + HTTP/2 fingerprint). Without proper TLS fingerprinting, hCaptcha returns bot signals.

- If getcaptcha returns `generated_pass_UUID` immediately, the token is returned without image solving.
- If an image challenge is returned, a second PoW is solved (from the getcaptcha response `c` field), and answers are submitted to checkcaptcha.

### Image solving

Current implementation answers all image tasks with `true` (random). Real image solving via vision model is a planned enhancement.

---

## Project Structure

```
src/
  solver.js       Main HCaptchaSolver class
  pow.js          HSW PoW solver via Node.js VM sandbox
  motion.js       Fake motionData generator
  server.js       HTTP API server
  tls_client.js   Chrome TLS fingerprinting via reqflow-sidecar (stdin/stdout)
sidecar/
  reqflow-sidecar Go binary for Chrome TLS/JA3 fingerprinting
test_solver.js    Test runner
package.json
```

---

## License

MIT
