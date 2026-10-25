'use strict';
const crypto = require('crypto');

function isAdminEmail(email, adminEmail) {
  if (!email || !adminEmail) return false;
  return String(email).trim().toLowerCase() === String(adminEmail).trim().toLowerCase();
}

function cronAuthorized(headerValue, secret) {
  if (!secret || !headerValue) return false;
  const a = Buffer.from(String(headerValue));
  const b = Buffer.from(String(secret));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { isAdminEmail, cronAuthorized };
