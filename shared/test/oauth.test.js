'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { signState, verifyState, authorizeUrl, exchangeCode, cleanCode, STATE_TTL_MS } = require('../oauth');

const SECRET = 'app-secret';
const NOW = 1_800_000_000_000;

test('state round-trips the email and expires after 10 minutes', () => {
  const s = signState('Friend@Mail.com', SECRET, NOW);
  assert.strictEqual(verifyState(s, SECRET, NOW + 1000), 'friend@mail.com');
  assert.strictEqual(verifyState(s, SECRET, NOW + STATE_TTL_MS + 1), null);
});

test('state rejects tampering, the wrong secret and junk', () => {
  const s = signState('a@b.co', SECRET, NOW);
  const forged = Buffer.from('evil@x.co|' + (NOW + STATE_TTL_MS)).toString('base64url') + '.' + s.split('.')[1];
  assert.strictEqual(verifyState(forged, SECRET, NOW), null);
  assert.strictEqual(verifyState(s, 'other', NOW), null);
  for (const junk of ['', 'abc', '.', undefined, 'a.b.c']) assert.strictEqual(verifyState(junk, SECRET, NOW), null);
});

test('authorizeUrl asks for exactly the three permissions DMBot uses', () => {
  const u = new URL(authorizeUrl({ appId: '108', redirectUri: 'https://x.y/server/admin/oauth/callback', state: 'st' }));
  assert.strictEqual(u.origin + u.pathname, 'https://www.instagram.com/oauth/authorize');
  assert.deepStrictEqual(Object.fromEntries(u.searchParams), {
    client_id: '108', redirect_uri: 'https://x.y/server/admin/oauth/callback', response_type: 'code',
    scope: 'instagram_business_basic,instagram_business_manage_comments,instagram_business_manage_messages', state: 'st',
  });
});

test('cleanCode strips the "#_" Instagram appends', () => {
  assert.strictEqual(cleanCode('AQBx#_'), 'AQBx');
  assert.strictEqual(cleanCode('AQBx'), 'AQBx');
});

test('exchangeCode swaps the code for a short-lived and then a long-lived token', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, ...opts });
    const body = calls.length === 1 ? { data: [{ access_token: 'SHORT', user_id: '17', permissions: 'x' }] } : { access_token: 'LONG', expires_in: 5184000 };
    return { ok: true, status: 200, json: async () => body };
  };
  const out = await exchangeCode({ appId: '108', appSecret: SECRET, redirectUri: 'https://x.y/cb', code: 'CODE#_', fetchImpl });
  assert.deepStrictEqual(out, { accessToken: 'LONG', expiresIn: 5184000 });
  assert.strictEqual(calls[0].url, 'https://api.instagram.com/oauth/access_token');
  assert.deepStrictEqual(Object.fromEntries(new URLSearchParams(calls[0].body)), { client_id: '108', client_secret: SECRET, grant_type: 'authorization_code', redirect_uri: 'https://x.y/cb', code: 'CODE' });
  const second = new URL(calls[1].url);
  assert.strictEqual(second.origin + second.pathname, 'https://graph.instagram.com/access_token');
  assert.deepStrictEqual(Object.fromEntries(second.searchParams), { grant_type: 'ig_exchange_token', client_secret: SECRET, access_token: 'SHORT' });
});

test('exchangeCode surfaces Instagram errors', async () => {
  const fetchImpl = async () => ({ ok: false, status: 400, json: async () => ({ error_type: 'OAuthException', code: 400, error_message: 'Invalid authorization code' }) });
  await assert.rejects(exchangeCode({ appId: '1', appSecret: 's', redirectUri: 'r', code: 'c', fetchImpl }), /Invalid authorization code/);
});
