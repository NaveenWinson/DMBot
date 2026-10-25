'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createInstagram } = require('../instagram');

function fakeFetch(responses) {
  const calls = [];
  const impl = async (url, opts) => {
    calls.push({ url, ...opts });
    const r = responses.shift() || { ok: true, body: {} };
    return { ok: r.ok !== false, status: r.status || 200, json: async () => r.body };
  };
  return { impl, calls };
}

test('sendPrivateReply posts recipient.comment_id with a bearer token', async () => {
  const f = fakeFetch([{ body: { message_id: 'm' } }]);
  await createInstagram('TOK', { fetchImpl: f.impl, version: 'v26.0' }).sendPrivateReply('178', '999', 'hi');
  assert.strictEqual(f.calls[0].url, 'https://graph.instagram.com/v26.0/178/messages');
  assert.strictEqual(f.calls[0].method, 'POST');
  assert.strictEqual(f.calls[0].headers.Authorization, 'Bearer TOK');
  assert.deepStrictEqual(JSON.parse(f.calls[0].body), { recipient: { comment_id: '999' }, message: { text: 'hi' } });
});

test('replyToComment posts to /{comment-id}/replies', async () => {
  const f = fakeFetch([{ body: { id: 'c' } }]);
  await createInstagram('TOK', { fetchImpl: f.impl, version: 'v26.0' }).replyToComment('999', 'thanks');
  assert.strictEqual(f.calls[0].url, 'https://graph.instagram.com/v26.0/999/replies');
  assert.deepStrictEqual(JSON.parse(f.calls[0].body), { message: 'thanks' });
});

test('listReels keeps only REELS and follows paging', async () => {
  const f = fakeFetch([
    { body: { data: [{ id: '1', media_product_type: 'REELS' }, { id: '2', media_product_type: 'FEED' }], paging: { next: 'https://graph.instagram.com/next' } } },
    { body: { data: [{ id: '3', media_product_type: 'REELS' }] } },
  ]);
  const reels = await createInstagram('TOK', { fetchImpl: f.impl }).listReels();
  assert.deepStrictEqual(reels.map((r) => r.id), ['1', '3']);
  assert.strictEqual(f.calls[1].url, 'https://graph.instagram.com/next');
});

test('API errors become InstagramError with Meta message and code', async () => {
  const f = fakeFetch([{ ok: false, status: 400, body: { error: { message: 'Invalid OAuth access token', code: 190 } } }]);
  await assert.rejects(createInstagram('TOK', { fetchImpl: f.impl }).me(), (e) => e.message === 'Invalid OAuth access token' && e.code === 190 && e.status === 400);
});

test('subscribe and refresh pass the token as a query parameter', async () => {
  const f = fakeFetch([{ body: { success: true } }, { body: { access_token: 'NEW', expires_in: 5184000 } }]);
  const ig = createInstagram('T K', { fetchImpl: f.impl, version: 'v26.0' });
  await ig.subscribeComments();
  await ig.refreshToken();
  assert.strictEqual(f.calls[0].url, 'https://graph.instagram.com/v26.0/me/subscribed_apps?subscribed_fields=comments,messages&access_token=T%20K');
  assert.strictEqual(f.calls[1].url, 'https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=T%20K');
});
