'use strict';
const crypto = require('crypto');

// Meta signs every webhook POST: X-Hub-Signature-256: sha256=<hex HMAC-SHA256(app secret, raw body)>.
function verifySignature(rawBody, header, appSecret) {
  if (!appSecret || !header || rawBody == null) return false;
  const m = /^sha256=([0-9a-f]{64})$/i.exec(String(header).trim());
  if (!m) return false;
  const expected = crypto.createHmac('sha256', appSecret).update(rawBody).digest();
  const given = Buffer.from(m[1], 'hex');
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

function sign(rawBody, appSecret) {
  return 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
}

module.exports = { verifySignature, sign };
