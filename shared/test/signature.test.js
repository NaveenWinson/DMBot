'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { verifySignature, sign } = require('../signature');

const SECRET = 'app-secret';
const body = Buffer.from('{"object":"instagram","entry":[{"text":"caf\\u00e9"}]}');

test('accepts a correct signature on the raw bytes', () => {
  assert.strictEqual(verifySignature(body, sign(body, SECRET), SECRET), true);
});

test('rejects wrong secret, changed body, bad format and missing parts', () => {
  assert.strictEqual(verifySignature(body, sign(body, 'other'), SECRET), false);
  assert.strictEqual(verifySignature(Buffer.from(body.toString() + ' '), sign(body, SECRET), SECRET), false);
  assert.strictEqual(verifySignature(body, 'sha1=abc', SECRET), false);
  assert.strictEqual(verifySignature(body, undefined, SECRET), false);
  assert.strictEqual(verifySignature(body, sign(body, SECRET), ''), false);
  assert.strictEqual(verifySignature(undefined, sign(body, SECRET), SECRET), false);
});
