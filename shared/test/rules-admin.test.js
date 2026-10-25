'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { validateRule, keywordTaken } = require('../rules-admin');

const good = () => ({ mediaId: '123', keyword: '  LINK ', dmText: 'Here: https://x.y', gateText: 'Follow us to unlock!' });

test('validateRule normalizes the keyword and ignores any posted public replies', () => {
  const out = validateRule(good());
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.rule.keyword, 'link');
  assert.strictEqual(out.rule.gateText, 'Follow us to unlock!');
  assert.strictEqual(validateRule({ ...good(), publicReplies: ['x'] }).rule.publicReplies, undefined);
  assert.strictEqual(out.rule.enabled, true);
});

test('validateRule reports every problem', () => {
  const out = validateRule({ mediaId: 'abc', keyword: ' ', dmText: '' });
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.errors.length, 4);
  assert.strictEqual(validateRule({ ...good(), gateText: 'x'.repeat(801) }).ok, false);
  assert.strictEqual(validateRule({ ...good(), dmText: 'x'.repeat(1001) }).ok, false);
});

test('keywordTaken checks the same reel and skips the rule being edited', () => {
  const rules = [{ id: '1', mediaId: '123', keyword: 'link' }];
  assert.strictEqual(keywordTaken(rules, '123', 'link'), true);
  assert.strictEqual(keywordTaken(rules, '123', 'link', '1'), false);
  assert.strictEqual(keywordTaken(rules, '999', 'link'), false);
});
