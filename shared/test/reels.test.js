'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { shortcodeFromUrl, findReelByUrl, toReel } = require('../reels');

test('shortcodeFromUrl handles reel, reels, p, username paths, query strings and share text', () => {
  assert.strictEqual(shortcodeFromUrl('https://www.instagram.com/reel/C9xYz_12-bC/?igsh=abc'), 'C9xYz_12-bC');
  assert.strictEqual(shortcodeFromUrl('https://instagram.com/reels/ABC123/'), 'ABC123');
  assert.strictEqual(shortcodeFromUrl('https://www.instagram.com/p/XYZ/'), 'XYZ');
  assert.strictEqual(shortcodeFromUrl('https://www.instagram.com/my.name/reel/QQQ/'), 'QQQ');
  assert.strictEqual(shortcodeFromUrl('Check this out https://www.instagram.com/reel/SHARE1/?igsh=x'), 'SHARE1');
  assert.strictEqual(shortcodeFromUrl('https://example.com/reel/ABC'), null);
  assert.strictEqual(shortcodeFromUrl(''), null);
});

test('findReelByUrl matches on shortcode regardless of /reel/ vs /p/ form', () => {
  const reels = [toReel({ id: 1, permalink: 'https://www.instagram.com/reel/AAA/' }), toReel({ id: 2, permalink: 'https://www.instagram.com/reel/BBB/' })];
  assert.strictEqual(findReelByUrl(reels, 'https://www.instagram.com/p/BBB/?igsh=1').id, '2');
  assert.strictEqual(findReelByUrl(reels, 'https://www.instagram.com/reel/CCC/'), null);
});

test('toReel falls back to media_url for the thumbnail', () => {
  assert.strictEqual(toReel({ id: 5, media_url: 'u' }).thumbnailUrl, 'u');
});
