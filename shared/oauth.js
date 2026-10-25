'use strict';
// Business Login for Instagram: friends connect their own account without sharing any secret.
// Docs: developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login
const crypto = require('crypto');

const SCOPES = ['instagram_business_basic', 'instagram_business_manage_comments', 'instagram_business_manage_messages'];
const STATE_TTL_MS = 10 * 60 * 1000;

const b64 = (s) => Buffer.from(s).toString('base64url');
const hmac = (data, secret) => crypto.createHmac('sha256', secret).update(data).digest('base64url');

// state = base64url(email|expiresAt).signature, so the callback knows who started the login and that it is recent.
function signState(email, secret, nowMs = Date.now()) {
  const body = b64(`${String(email).toLowerCase()}|${nowMs + STATE_TTL_MS}`);
  return `${body}.${hmac(body, secret)}`;
}

// Returns the email, or null if the state is forged, malformed or expired.
function verifyState(state, secret, nowMs = Date.now()) {
  const [body, sig] = String(state || '').split('.');
  if (!body || !sig || !secret) return null;
  const expected = Buffer.from(hmac(body, secret));
  const given = Buffer.from(sig);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  const [email, exp] = Buffer.from(body, 'base64url').toString().split('|');
  if (!email || !(Number(exp) > nowMs)) return null;
  return email;
}

function authorizeUrl({ appId, redirectUri, state }) {
  const q = new URLSearchParams({ client_id: appId, redirect_uri: redirectUri, response_type: 'code', scope: SCOPES.join(','), state });
  return `https://www.instagram.com/oauth/authorize?${q}`;
}

// Instagram appends "#_" to the code on redirect; it is not part of the code.
const cleanCode = (code) => String(code || '').replace(/#_$/, '');

async function readJson(res) {
  let data = {};
  try { data = await res.json(); } catch (_) { /* non-JSON body */ }
  if (!res.ok || data.error || data.error_type) {
    const msg = (data.error && data.error.message) || data.error_message || `Instagram login failed (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

// code -> short-lived token -> long-lived (60-day) token. Server side only: it needs the app secret.
async function exchangeCode({ appId, appSecret, redirectUri, code, fetchImpl = fetch }) {
  const form = new URLSearchParams({ client_id: appId, client_secret: appSecret, grant_type: 'authorization_code', redirect_uri: redirectUri, code: cleanCode(code) });
  const short = await readJson(await fetchImpl('https://api.instagram.com/oauth/access_token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString(),
  }));
  const first = Array.isArray(short.data) ? short.data[0] : short;
  if (!first || !first.access_token) throw new Error('Instagram did not return a token');
  const q = new URLSearchParams({ grant_type: 'ig_exchange_token', client_secret: appSecret, access_token: first.access_token });
  const long = await readJson(await fetchImpl(`https://graph.instagram.com/access_token?${q}`, { method: 'GET' }));
  return { accessToken: long.access_token, expiresIn: Number(long.expires_in) || null };
}

module.exports = { signState, verifyState, authorizeUrl, exchangeCode, cleanCode, SCOPES, STATE_TTL_MS };
