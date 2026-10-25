'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { handleWebhook } = require('../webhook-handler');
const { gateText, EXPIRED_TEXT, BUTTON_TITLE } = require('../unlock');

const ME = '17841400000000001';
const FAN = '900';
const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const settings = { igUserId: ME, username: 'my_brand', accessToken: 'tok' };
const gated = { id: '9', mediaId: '555', keyword: 'macau', dmText: 'Real details: https://x.y', gateText: 'Follow us to unlock the Macau guide!', enabled: true };

const commentPayload = (over = {}) => ({ object: 'instagram', entry: [{ id: ME, time: 1, field: 'comments', value: { id: '1001', from: { id: FAN, username: 'Fan.One' }, text: 'Macau', media: { id: '555' }, ...over } }] });
const msgPayload = (message, sender = FAN) => ({ object: 'instagram', entry: [{ id: ME, time: 1, messaging: [{ sender: { id: sender }, recipient: { id: ME }, timestamp: 1, message: { mid: 'm1', ...message } }] }] });

function world({ follows = false, buttonRejected = false, usernames = { [FAN]: 'fan.one' } } = {}) {
  const rows = [];
  const calls = { pr: [], msg: [], profile: 0 };
  const store = {
    getSettings: async () => settings,
    listRulesForMedia: async () => [gated],
    getRule: async (id) => (id === gated.id ? gated : null),
    lastReplyText: async () => null,
    claimComment: async (row) => { if (rows.some((r) => r.commentId === row.commentId)) return null; rows.push({ id: 'r' + rows.length, ...row }); return 'r' + (rows.length - 1); },
    updateProcessed: async (id, patch) => Object.assign(rows.find((r) => r.id === id), patch),
    listWaitingByFromId: async (fromId) => rows.filter((r) => r.fromId === fromId && r.unlockStatus === 'waiting'),
    listWaitingByUsername: async (u) => rows.filter((r) => r.fromUsername === u && r.unlockStatus === 'waiting'),
  };
  const ig = {
    sendPrivateReply: async (igUserId, commentId, text, qr) => {
      if (qr && buttonRejected) throw new Error('(#100) quick_replies not supported');
      calls.pr.push({ commentId, text, qr });
    },
    replyToComment: async () => {},
    sendMessage: async (igUserId, to, text, qr) => { calls.msg.push({ to, text, qr }); },
    getUserProfile: async (igsid) => { calls.profile++; return { username: usernames[igsid] || 'stranger_' + igsid, is_user_follow_business: world.follows }; },
  };
  world.follows = follows;
  const deps = { store, makeInstagram: () => ig, rand: () => 0, now: () => world.now };
  world.now = NOW;
  return { deps, rows, calls };
}

test('a gated comment stores the commenter and sends the gate message with an "I followed" button', async () => {
  const { deps, rows, calls } = world();
  const [r] = await handleWebhook(commentPayload(), deps);
  assert.strictEqual(r.gated, true);
  assert.strictEqual(rows[0].unlockStatus, 'waiting');
  assert.strictEqual(rows[0].unlockExpiresAt, NOW + 7 * DAY);
  assert.strictEqual(rows[0].fromId, FAN);
  assert.strictEqual(rows[0].fromUsername, 'fan.one');
  assert.strictEqual(calls.pr[0].text, gateText(gated));
  assert.match(calls.pr[0].text, /reply "DONE"/);
  assert.deepStrictEqual(calls.pr[0].qr, [{ title: BUTTON_TITLE, payload: 'UNLOCK:9' }]);
});

test('gateText leaves the message alone when it already mentions DONE', () => {
  assert.strictEqual(gateText({ ...gated, gateText: 'Follow us, then reply DONE' }), 'Follow us, then reply DONE');
});

test('if Instagram refuses the button, the gate message is sent as plain text', async () => {
  const { deps, calls, rows } = world({ buttonRejected: true });
  await handleWebhook(commentPayload(), deps);
  assert.strictEqual(calls.pr.length, 1);
  assert.strictEqual(calls.pr[0].qr, undefined);
  assert.strictEqual(rows[0].dmStatus, 'sent');
});

test('tapping the button while following sends the real DM and marks it unlocked', async () => {
  const { deps, rows, calls } = world({ follows: true });
  await handleWebhook(commentPayload(), deps);
  const [r] = await handleWebhook(msgPayload({ text: BUTTON_TITLE, quick_reply: { payload: 'UNLOCK:9' } }), deps);
  assert.strictEqual(r.status, 'unlocked');
  assert.deepStrictEqual(calls.msg, [{ to: FAN, text: gated.dmText, qr: undefined }]);
  assert.strictEqual(rows[0].unlockStatus, 'sent');
  assert.strictEqual(rows[0].unlockedAt, NOW);
});

test('typing DONE (any case/spacing) also unlocks', async () => {
  const { deps, calls } = world({ follows: true });
  await handleWebhook(commentPayload(), deps);
  const [r] = await handleWebhook(msgPayload({ text: '  DONE ' }), deps);
  assert.strictEqual(r.status, 'unlocked');
  assert.strictEqual(calls.msg[0].text, gated.dmText);
});

test('not following yet: asks them to follow and tap again, and keeps waiting', async () => {
  const { deps, rows, calls } = world({ follows: false });
  await handleWebhook(commentPayload(), deps);
  const [r] = await handleWebhook(msgPayload({ text: 'done' }), deps);
  assert.strictEqual(r.status, 'not following');
  assert.match(calls.msg[0].text, /not following @my_brand/);
  assert.deepStrictEqual(calls.msg[0].qr, [{ title: BUTTON_TITLE, payload: 'UNLOCK:9' }]);
  assert.strictEqual(rows[0].unlockStatus, 'waiting');

  world.follows = true; // they follow, then tap again
  const [r2] = await handleWebhook(msgPayload({ text: BUTTON_TITLE, quick_reply: { payload: 'UNLOCK:9' } }), deps);
  assert.strictEqual(r2.status, 'unlocked');
  assert.strictEqual(calls.msg[1].text, gated.dmText);
});

test('after 7 days the offer expires', async () => {
  const { deps, rows, calls } = world({ follows: true });
  await handleWebhook(commentPayload(), deps);
  world.now = NOW + 7 * DAY + 1;
  const [r] = await handleWebhook(msgPayload({ text: 'done' }), deps);
  assert.strictEqual(r.status, 'expired');
  assert.strictEqual(rows[0].unlockStatus, 'expired');
  assert.deepStrictEqual(calls.msg.map((m) => m.text), [EXPIRED_TEXT]);
});

test('a re-sent unlock message does not send the real DM twice', async () => {
  const { deps, calls } = world({ follows: true });
  await handleWebhook(commentPayload(), deps);
  await handleWebhook(msgPayload({ text: 'done' }), deps);
  const [r] = await handleWebhook(msgPayload({ text: 'done' }), deps);
  assert.strictEqual(r.reason, 'not waiting');
  assert.strictEqual(calls.msg.length, 1);
});

test('ordinary DMs, unknown senders and echoes get no reply', async () => {
  const { deps, calls } = world({ follows: true });
  await handleWebhook(commentPayload(), deps);
  const res = [
    ...(await handleWebhook(msgPayload({ text: 'hi, love your page' }), deps)),
    ...(await handleWebhook(msgPayload({ text: 'done' }, '777'), deps)),
    ...(await handleWebhook(msgPayload({ text: 'done', is_echo: true }), deps)),
    ...(await handleWebhook(msgPayload({ text: 'done' }, ME), deps)),
  ];
  assert.deepStrictEqual(res.map((r) => r.reason), ['not a confirm word', 'not waiting', 'echo', 'echo']);
  assert.strictEqual(calls.msg.length, 0);
});

test('if the message id differs from the comment id, the username matches them up', async () => {
  const { deps, rows, calls } = world({ follows: true, usernames: { [FAN]: 'fan.one', 555000: 'fan.one' } });
  await handleWebhook(commentPayload(), deps);
  const [r] = await handleWebhook(msgPayload({ text: 'done' }, '555000'), deps);
  assert.strictEqual(r.status, 'unlocked');
  assert.strictEqual(calls.msg[0].to, '555000');
  assert.strictEqual(rows[0].fromId, '555000');
});

test('keywords without a gate still send the real DM straight away', async () => {
  const { deps, rows, calls } = world();
  deps.store.listRulesForMedia = async () => [{ ...gated, gateText: '' }];
  const [r] = await handleWebhook(commentPayload(), deps);
  assert.strictEqual(r.gated, false);
  assert.strictEqual(calls.pr[0].text, gated.dmText);
  assert.strictEqual(rows[0].unlockStatus, undefined);
});

test('typing DONE unlocks every keyword the person is waiting on; the button only its own', async () => {
  const other = { ...gated, id: '10', mediaId: '556', keyword: 'avengers', dmText: 'Avengers info' };
  const { deps, calls } = world({ follows: true });
  deps.store.listRulesForMedia = async (mediaId) => (mediaId === '556' ? [other] : [gated]);
  deps.store.getRule = async (id) => ({ 9: gated, 10: other }[id] || null);
  await handleWebhook(commentPayload(), deps);
  await handleWebhook(commentPayload({ id: '1002', text: 'avengers', media: { id: '556' } }), deps);
  const [r] = await handleWebhook(msgPayload({ text: 'Done' }), deps);
  assert.strictEqual(r.status, 'unlocked,unlocked');
  assert.deepStrictEqual(calls.msg.map((m) => m.text).sort(), ['Avengers info', gated.dmText].sort());
  assert.strictEqual(calls.profile, 1);
});

test('the button for one keyword leaves the other keyword waiting', async () => {
  const other = { ...gated, id: '10', mediaId: '556', keyword: 'avengers', dmText: 'Avengers info' };
  const { deps, rows } = world({ follows: true });
  deps.store.listRulesForMedia = async (mediaId) => (mediaId === '556' ? [other] : [gated]);
  deps.store.getRule = async (id) => ({ 9: gated, 10: other }[id] || null);
  await handleWebhook(commentPayload(), deps);
  await handleWebhook(commentPayload({ id: '1002', text: 'avengers', media: { id: '556' } }), deps);
  await handleWebhook(msgPayload({ text: BUTTON_TITLE, quick_reply: { payload: 'UNLOCK:9' } }), deps);
  assert.deepStrictEqual(rows.map((r) => r.unlockStatus), ['sent', 'waiting']);
});
