import { describe, it, expect } from 'vitest';
import { keywordRows } from './keywords.js';

const reels = [
  { id: 'new', caption: 'Newest reel', permalink: 'https://www.instagram.com/reel/NEW/', thumbnailUrl: 'n.jpg', timestamp: 't2' },
  { id: 'old', caption: 'Older reel', permalink: 'https://www.instagram.com/reel/OLD/', thumbnailUrl: 'o.jpg', timestamp: 't1' },
];
const rule = (id, mediaId, keyword, extra = {}) => ({ id, mediaId, keyword, dmText: 'd', enabled: true, captionPreview: '', permalink: '', ...extra });

describe('keywordRows', () => {
  it('orders by reel (newest first), then keyword, with unknown reels last', () => {
    const rows = keywordRows([
      rule('1', 'gone', 'zeta'),
      rule('2', 'old', 'beta'),
      rule('3', 'new', 'link'),
      rule('4', 'old', 'alpha'),
    ], reels);
    expect(rows.map((r) => r.rule.id)).toEqual(['3', '4', '2', '1']);
  });

  it('takes thumbnail, caption and link from the reel', () => {
    const [row] = keywordRows([rule('3', 'new', 'link')], reels);
    expect(row.reel).toEqual({ id: 'new', caption: 'Newest reel', permalink: 'https://www.instagram.com/reel/NEW/', thumbnailUrl: 'n.jpg', timestamp: 't2' });
  });

  it('falls back to the stored caption and link when the reel is unknown or reels failed to load', () => {
    const r = rule('1', 'gone', 'x', { captionPreview: 'Saved caption', permalink: 'https://www.instagram.com/reel/GONE/' });
    for (const list of [reels, null]) {
      const [row] = keywordRows([r], list);
      expect(row.reel).toMatchObject({ caption: 'Saved caption', permalink: 'https://www.instagram.com/reel/GONE/', thumbnailUrl: '' });
    }
  });

  it('handles no rules', () => {
    expect(keywordRows([], reels)).toEqual([]);
    expect(keywordRows(undefined, undefined)).toEqual([]);
  });
});
