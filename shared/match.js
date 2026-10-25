'use strict';

// Exact keyword match: the whole comment must equal the keyword, ignoring case and extra spaces.
function normalize(text) {
  return String(text == null ? '' : text).normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

function findRule(rules, mediaId, text) {
  const n = normalize(text);
  if (!n || !mediaId) return null;
  return (rules || []).find((r) => r.enabled && r.mediaId === String(mediaId) && r.keyword === n) || null;
}

module.exports = { normalize, findRule };
