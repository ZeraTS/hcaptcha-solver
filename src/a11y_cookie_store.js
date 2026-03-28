'use strict';

/**
 * a11y_cookie_store.js
 *
 * Persists the hc_accessibility cookie to disk.
 * Tracks expiry — cookie is valid ~30 days from issue.
 * On load, returns null if missing or expired so caller can re-register.
 */

const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, '..', '.a11y_cookie.json');
const COOKIE_TTL_MS = 25 * 24 * 60 * 60 * 1000; // 25 days (conservative, actual is ~30d)

function load() {
  try {
    if (!fs.existsSync(STORE_PATH)) return null;
    const data = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    if (!data.cookie || !data.issuedAt) return null;
    const age = Date.now() - data.issuedAt;
    if (age > COOKIE_TTL_MS) {
      console.log('[a11y-store] Cookie expired (age:', Math.floor(age / 86400000), 'days) — need re-register');
      return null;
    }
    return data.cookie;
  } catch {
    return null;
  }
}

function save(cookie) {
  const data = { cookie, issuedAt: Date.now() };
  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2));
  console.log('[a11y-store] Cookie saved to', STORE_PATH);
}

function clear() {
  try { fs.unlinkSync(STORE_PATH); } catch {}
}

function status() {
  try {
    if (!fs.existsSync(STORE_PATH)) return { valid: false, reason: 'not found' };
    const data = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    if (!data.cookie) return { valid: false, reason: 'empty' };
    const age = Date.now() - data.issuedAt;
    const daysLeft = Math.floor((COOKIE_TTL_MS - age) / 86400000);
    if (age > COOKIE_TTL_MS) return { valid: false, reason: 'expired', daysLeft: 0 };
    return { valid: true, daysLeft, cookie: data.cookie.slice(0, 16) + '...' };
  } catch {
    return { valid: false, reason: 'error' };
  }
}

module.exports = { load, save, clear, status };
