'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { PUBLIC_REPLIES, pickReply } = require('../replies');

test('there are 12 distinct, non-empty public replies', () => {
  assert.strictEqual(PUBLIC_REPLIES.length, 12);
  assert.strictEqual(new Set(PUBLIC_REPLIES).size, 12);
  PUBLIC_REPLIES.forEach((r) => assert.ok(r.trim().length > 0 && r.length <= 100));
});

test('pickReply never repeats the previous reply', () => {
  for (const last of PUBLIC_REPLIES) {
    for (const x of [0, 0.5, 0.999999]) assert.notStrictEqual(pickReply(last, () => x), last);
  }
});

test('pickReply can return every reply and works with no previous reply', () => {
  const seen = new Set();
  for (let i = 0; i < 12; i++) seen.add(pickReply(null, () => i / 12));
  assert.strictEqual(seen.size, 12);
  assert.strictEqual(pickReply(null, () => 0), PUBLIC_REPLIES[0]);
});

test('pickReply copes with a one-item list', () => {
  assert.strictEqual(pickReply('a', () => 0.7, ['a']), 'a');
});
