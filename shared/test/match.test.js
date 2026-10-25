'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { normalize, findRule } = require('../match');

test('normalize trims, collapses spaces, lowercases and applies NFKC', () => {
  assert.strictEqual(normalize('  LINK  '), 'link');
  assert.strictEqual(normalize('Send\n  Me'), 'send me');
  assert.strictEqual(normalize('ＬＩＮＫ'), 'link'); // full-width letters
  assert.strictEqual(normalize(null), '');
});

const rules = [
  { id: '1', mediaId: '100', keyword: 'link', enabled: true },
  { id: '2', mediaId: '100', keyword: 'price', enabled: false },
  { id: '3', mediaId: '200', keyword: 'link', enabled: true },
];

test('findRule matches the whole comment exactly, on that reel only', () => {
  assert.strictEqual(findRule(rules, '100', 'Link').id, '1');
  assert.strictEqual(findRule(rules, '200', ' LINK ').id, '3');
  assert.strictEqual(findRule(rules, '100', 'link pls'), null);
  assert.strictEqual(findRule(rules, '300', 'link'), null);
  assert.strictEqual(findRule(rules, '100', ''), null);
});

test('findRule ignores disabled rules', () => {
  assert.strictEqual(findRule(rules, '100', 'price'), null);
});
