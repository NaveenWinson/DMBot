'use strict';

// Pulls the shortcode out of a pasted reel link, e.g. https://www.instagram.com/reel/C9xYz_12AbC/?igsh=...
// Also accepts pasted share text that contains the link.
function shortcodeFromUrl(input) {
  const m = /instagram\.com\/(?:[A-Za-z0-9._]+\/)?(?:reels?|p|tv)\/([A-Za-z0-9_-]+)/i.exec(String(input || ''));
  return m ? m[1] : null;
}

function findReelByUrl(reels, input) {
  const code = shortcodeFromUrl(input);
  if (!code) return null;
  return (reels || []).find((r) => shortcodeFromUrl(r.permalink) === code) || null;
}

function toReel(media) {
  return {
    id: String(media.id),
    caption: media.caption || '',
    permalink: media.permalink || '',
    thumbnailUrl: media.thumbnail_url || media.media_url || '',
    timestamp: media.timestamp || null,
  };
}

module.exports = { shortcodeFromUrl, findReelByUrl, toReel };
