'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { isAdminEmail, cronAuthorized } = require('../guards');

test('isAdminEmail ignores case and spaces', () => {
  assert.strictEqual(isAdminEmail(' Me@X.com', 'me@x.com '), true);
  assert.strictEqual(isAdminEmail('a@x.com', 'me@x.com'), false);
  assert.strictEqual(isAdminEmail('a@x.com', undefined), false);
});

test('cronAuthorized needs an exact match', () => {
  assert.strictEqual(cronAuthorized('s3cret-value', 's3cret-value'), true);
  assert.strictEqual(cronAuthorized('s3cret', 's3cret-value'), false);
  assert.strictEqual(cronAuthorized(undefined, 's3cret-value'), false);
  assert.strictEqual(cronAuthorized('x', ''), false);
});
