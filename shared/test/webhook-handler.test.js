'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { extractComments, handleWebhook } = require('../webhook-handler');
const { PUBLIC_REPLIES } = require('../replies');

const ME = '17841400000000001';
const settings = { igUserId: ME, username: 'my_brand', accessToken: 'tok' };
const rule = { id: '9', mediaId: '555', keyword: 'link', dmText: 'Here you go: https://x.y', enabled: true };

function payload(values, { shape = 'flat', accountId = ME } = {}) {
  return {
    object: 'instagram',
    entry: values.map((value) => (shape === 'flat'
      ? { id: accountId, time: 1, field: 'comments', value }
      : { id: accountId, time: 1, changes: [{ field: 'comments', value }] })),
  };
}
const comment = (over = {}) => ({ id: '1001', from: { id: '42', username: 'fan' }, text: 'LINK', media: { id: '555', media_product_type: 'REELS' }, ...over });

function fakes({ settingsOverride, dmFails = false, replyFails = false, rules = [rule], lastReply = null } = {}) {
  const claimed = new Set();
  const calls = { dm: [], reply: [], updates: [], claims: [] };
  const store = {
    getSettings: async () => (settingsOverride === undefined ? settings : settingsOverride),
    listRulesForMedia: async (mediaId) => rules.filter((r) => r.mediaId === mediaId),
    claimComment: async (row) => {
      calls.claims.push(row);
      if (claimed.has(row.commentId)) return null;
      claimed.add(row.commentId);
      return 'row-' + row.commentId;
    },
    updateProcessed: async (id, patch) => { calls.updates.push({ id, ...patch }); },
    lastReplyText: async () => { calls.lastReplyReads = (calls.lastReplyReads || 0) + 1; return lastReply; },
  };
  const ig = {
    sendPrivateReply: async (igUserId, commentId, text) => {
      if (dmFails) throw new Error('(#10) Outside of allowed window');
      calls.dm.push({ igUserId, commentId, text });
    },
    replyToComment: async (commentId, message) => {
      if (replyFails) throw new Error('rate limited');
      calls.reply.push({ commentId, message });
    },
  };
  return { deps: { store, makeInstagram: () => ig, rand: () => 0 }, calls };
}

test('extractComments reads both the Instagram Login and the changes[] shape', () => {
  const a = extractComments(payload([comment()]));
  const b = extractComments(payload([{ ...comment(), id: undefined, comment_id: '1001', parent_id: '7' }], { shape: 'changes' }));
  assert.deepStrictEqual(a[0], { accountId: ME, commentId: '1001', parentId: null, mediaId: '555', fromId: '42', fromUsername: 'fan', text: 'LINK' });
  assert.strictEqual(b[0].commentId, '1001');
  assert.strictEqual(b[0].parentId, '7');
  assert.deepStrictEqual(extractComments({ object: 'page', entry: [] }), []);
  assert.deepStrictEqual(extractComments(payload([{ ...comment(), id: undefined }])), []);
});

test('a matching comment gets a DM and a public reply, and is logged', async () => {
  const { deps, calls } = fakes();
  const [r] = await handleWebhook(payload([comment()]), deps);
  assert.deepStrictEqual(r, { commentId: '1001', status: 'handled', gated: false, dmStatus: 'sent', replyStatus: 'sent', replyText: PUBLIC_REPLIES[0], error: '' });
  assert.deepStrictEqual(calls.dm, [{ igUserId: ME, commentId: '1001', text: rule.dmText }]);
  assert.deepStrictEqual(calls.reply, [{ commentId: '1001', message: PUBLIC_REPLIES[0] }]);
  assert.strictEqual(calls.claims[0].ruleId, '9');
  assert.strictEqual(calls.claims[0].fromUsername, 'fan');
  assert.deepStrictEqual(calls.updates, [{ id: 'row-1001', dmStatus: 'sent', replyStatus: 'sent', replyText: PUBLIC_REPLIES[0], error: '' }]);
});

test('the public reply differs from the last one stored and from the previous comment in the batch', async () => {
  const { deps, calls } = fakes({ lastReply: PUBLIC_REPLIES[0] });
  await handleWebhook(payload([comment({ id: '5001' }), comment({ id: '5002' }), comment({ id: '5003' })]), deps);
  const sent = calls.reply.map((r) => r.message);
  assert.notStrictEqual(sent[0], PUBLIC_REPLIES[0]);
  assert.notStrictEqual(sent[1], sent[0]);
  assert.notStrictEqual(sent[2], sent[1]);
  sent.forEach((m) => assert.ok(PUBLIC_REPLIES.includes(m)));
  assert.strictEqual(calls.lastReplyReads, 1);
});

test('the last reply is not looked up when nothing can match', async () => {
  const { deps, calls } = fakes({ rules: [] });
  await handleWebhook(payload([comment()]), deps);
  assert.strictEqual(calls.lastReplyReads, undefined);
});

test('a re-sent delivery is handled only once', async () => {
  const { deps, calls } = fakes();
  await handleWebhook(payload([comment()]), deps);
  const [r] = await handleWebhook(payload([comment()]), deps);
  assert.strictEqual(r.reason, 'duplicate');
  assert.strictEqual(calls.dm.length, 1);
  assert.strictEqual(calls.reply.length, 1);
});

test('own comments (by id or username) are skipped, so the bot never answers itself', async () => {
  const { deps, calls } = fakes();
  const res = await handleWebhook(payload([
    comment({ id: '2001', from: { id: ME, username: 'whatever' } }),
    comment({ id: '2002', from: { id: '77', username: 'My_Brand' } }),
  ]), deps);
  assert.deepStrictEqual(res.map((r) => r.reason), ['own comment', 'own comment']);
  assert.strictEqual(calls.claims.length, 0);
});

test('replies to comments, non-matching text and other reels are skipped without logging', async () => {
  const { deps, calls } = fakes();
  const res = await handleWebhook(payload([
    { ...comment({ id: '3001' }), parent_id: '1' },
    comment({ id: '3002', text: 'link please' }),
    comment({ id: '3003', media: { id: '999' } }),
  ]), deps);
  assert.deepStrictEqual(res.map((r) => r.reason), ['reply to a comment', 'no matching rule', 'no matching rule']);
  assert.strictEqual(calls.claims.length, 0);
});

test('a failed DM is logged and the public reply is still posted', async () => {
  const { deps, calls } = fakes({ dmFails: true });
  const [r] = await handleWebhook(payload([comment()]), deps);
  assert.strictEqual(r.dmStatus, 'failed');
  assert.strictEqual(r.replyStatus, 'sent');
  assert.match(r.error, /^DM: \(#10\) Outside of allowed window$/);
  assert.strictEqual(calls.reply.length, 1);
  assert.strictEqual(calls.updates[0].dmStatus, 'failed');
});

test('both failures are recorded together', async () => {
  const { deps } = fakes({ dmFails: true, replyFails: true });
  const [r] = await handleWebhook(payload([comment()]), deps);
  assert.strictEqual(r.error, 'DM: (#10) Outside of allowed window | Reply: rate limited');
});

test('nothing happens until an account is connected', async () => {
  const { deps, calls } = fakes({ settingsOverride: null });
  const [r] = await handleWebhook(payload([comment()]), deps);
  assert.strictEqual(r.reason, 'not connected');
  assert.strictEqual(calls.claims.length, 0);
});

test('events for a different account id are ignored', async () => {
  const { deps, calls } = fakes();
  const [r] = await handleWebhook(payload([comment()], { accountId: '123' }), deps);
  assert.strictEqual(r.reason, 'other account');
  assert.strictEqual(calls.claims.length, 0);
});

test('one bad comment does not stop the rest of the batch', async () => {
  const { deps, calls } = fakes();
  deps.store.claimComment = async (row) => { if (row.commentId === '4001') throw new Error('store down'); return 'row-' + row.commentId; };
  const res = await handleWebhook(payload([comment({ id: '4001' }), comment({ id: '4002' })]), deps);
  assert.deepStrictEqual(res.map((r) => r.status), ['error', 'handled']);
  assert.strictEqual(calls.dm.length, 1);
});
