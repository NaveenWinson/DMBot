// Joins every keyword rule to its reel for the Keywords tab.
// Reels come newest first; rules whose reel is not in that list (older posts, or the reels call failed) go last
// and fall back to the caption and link stored with the rule.
export function keywordRows(rules, reels) {
  const order = new Map((reels || []).map((r, i) => [r.id, i]));
  const byId = new Map((reels || []).map((r) => [r.id, r]));
  return (rules || [])
    .map((rule) => {
      const reel = byId.get(rule.mediaId);
      return {
        rule,
        reel: {
          id: rule.mediaId,
          caption: reel ? reel.caption : rule.captionPreview || '',
          permalink: reel ? reel.permalink : rule.permalink || '',
          thumbnailUrl: reel ? reel.thumbnailUrl : '',
          timestamp: reel ? reel.timestamp : null,
        },
        rank: order.has(rule.mediaId) ? order.get(rule.mediaId) : Infinity,
      };
    })
    .sort((a, b) => a.rank - b.rank || a.rule.mediaId.localeCompare(b.rule.mediaId) || a.rule.keyword.localeCompare(b.rule.keyword))
    .map(({ rule, reel }) => ({ rule, reel }));
}
