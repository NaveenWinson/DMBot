'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { handleWebhook } = require('../webhook-handler');

// Two friends on one DMBot: events must only ever use the account they belong to.
const A = { igUserId: '1001', username: 'alice_travels', accessToken: 'tokA', ownerEmail: 'a@x.co' };
const B = { igUserId: '2002', username: 'bob_eats', accessToken: 'tokB', ownerEmail: 'b@x.co' };
const ruleA = { id: '11', accountId: A.igUserId, mediaId: '500', keyword: 'macau', dmText: 'Alice DM', gateText: '', enabled: true };
const ruleB = { id: '22', accountId: B.igUserId, mediaId: '600', keyword: 'macau', dmText: 'Bob DM', gateText: 'Follow Bob first', enabled: true };

function world() {
  const rows = [];
  const sent = [];
  const rules = [ruleA, ruleB];
  const store = {
    getAccountByIgUserId: async (id) => [A, B].find((a) => a.igUserId === id) || null,
    listRulesForMedia: async (accountId, mediaId) => rules.filter((r) => r.accountId === accountId && r.mediaId === mediaId),
    getRule: async (id) => rules.find((r) => r.id === id) || null,
    lastReplyText: async () => null,
    claimComment: async (row) => { rows.push({ id: 'r' + rows.length, ...row }); return 'r' + (rows.length - 1); },
    updateProcessed: async (id, patch) => Object.assign(rows.find((r) => r.id === id), patch),
    listWaitingByFromId: async (accountId, fromId) => rows.filter((r) => r.accountId === accountId && r.fromId === fromId && r.unlockStatus === 'waiting'),
    listWaitingByUsername: async () => [],
  };
  const makeInstagram = (token) => ({
    sendPrivateReply: async (igUserId, commentId, text) => sent.push({ token, igUserId, kind: 'private', text }),
    replyToComment: async () => {},
    sendMessage: async (igUserId, to, text) => sent.push({ token, igUserId, kind: 'message', text }),
    getUserProfile: async () => ({ username: 'fan', is_user_follow_business: true }),
  });
  return { rows, sent, deps: { store, makeInstagram, rand: () => 0, now: () => 1 } };
}
const comment = (account, mediaId, id) => ({ id: account.igUserId, time: 1, field: 'comments', value: { id, from: { id: '77', username: 'fan' }, text: 'Macau', media: { id: mediaId } } });

test('a batch with comments for two accounts uses each account\'s own token, rules and DM', async () => {
  const { deps, rows, sent } = world();
  await handleWebhook({ object: 'instagram', entry: [comment(A, '500', '9001'), comment(B, '600', '9002')] }, deps);
  assert.deepStrictEqual(sent, [
    { token: 'tokA', igUserId: A.igUserId, kind: 'private', text: 'Alice DM' },
    { token: 'tokB', igUserId: B.igUserId, kind: 'private', text: sent[1].text },
  ]);
  assert.match(sent[1].text, /^Follow Bob first/);
  assert.deepStrictEqual(rows.map((r) => r.accountId), [A.igUserId, B.igUserId]);
});

test('a reel id from one account never matches another account\'s rule', async () => {
  const { deps, sent } = world();
  const [r] = await handleWebhook({ object: 'instagram', entry: [comment(A, '600', '9003')] }, deps);
  assert.strictEqual(r.reason, 'no matching rule');
  assert.strictEqual(sent.length, 0);
});

test('DONE to one account does not unlock a waiting comment on another account', async () => {
  const { deps, sent } = world();
  await handleWebhook({ object: 'instagram', entry: [comment(B, '600', '9004')] }, deps);
  const msg = (acc) => ({ object: 'instagram', entry: [{ id: acc.igUserId, time: 1, messaging: [{ sender: { id: '77' }, recipient: { id: acc.igUserId }, message: { mid: 'm', text: 'done' } }] }] });
  const [wrong] = await handleWebhook(msg(A), deps);
  assert.strictEqual(wrong.reason, 'not waiting');
  const [right] = await handleWebhook(msg(B), deps);
  assert.strictEqual(right.status, 'unlocked');
  assert.deepStrictEqual(sent.slice(-1), [{ token: 'tokB', igUserId: B.igUserId, kind: 'message', text: 'Bob DM' }]);
});

test('events for an account nobody connected are skipped', async () => {
  const { deps, sent } = world();
  const res = await handleWebhook({ object: 'instagram', entry: [comment({ igUserId: '9999' }, '500', '9005'), { id: 'x', field: 'comments', value: { id: '1', text: 'a', media: { id: '1' } } }] }, deps);
  assert.deepStrictEqual(res.map((r) => r.reason), ['unknown account', 'unknown account']);
  assert.strictEqual(sent.length, 0);
});
