'use strict';
const { normalize } = require('./match');

const LIMITS = { keyword: 100, dmText: 1000, gateText: 800, caption: 200 };

// Validates an admin rule form. Returns { ok: true, rule } or { ok: false, errors: [..] }.
function validateRule(body) {
  const b = body || {};
  const errors = [];
  const mediaId = String(b.mediaId || '');
  if (!/^\d+$/.test(mediaId)) errors.push('Pick a reel');
  const keyword = normalize(b.keyword);
  if (!keyword) errors.push('Keyword is required');
  else if (keyword.length > LIMITS.keyword) errors.push(`Keyword must be at most ${LIMITS.keyword} characters`);
  const dmText = String(b.dmText || '').trim();
  if (!dmText) errors.push('DM text is required');
  else if (dmText.length > LIMITS.dmText) errors.push(`DM text must be at most ${LIMITS.dmText} characters`);
  const gateText = String(b.gateText || '').trim();
  if (!gateText) errors.push('Follow-gate message is required');
  else if (gateText.length > LIMITS.gateText) errors.push(`Follow-gate message must be at most ${LIMITS.gateText} characters`);
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    rule: {
      mediaId,
      permalink: String(b.permalink || '').slice(0, 255),
      captionPreview: String(b.captionPreview || '').slice(0, LIMITS.caption),
      keyword,
      dmText,
      gateText,
      enabled: b.enabled !== false,
    },
  };
}

// A reel cannot have the same keyword twice (exceptId: the rule being edited).
function keywordTaken(rules, mediaId, keyword, exceptId) {
  return (rules || []).some((r) => r.mediaId === mediaId && r.keyword === keyword && r.id !== exceptId);
}

module.exports = { validateRule, keywordTaken, LIMITS };
