import { describe, it, expect } from 'vitest';
import { daysLeft, truncate, emptyRule, ruleToForm, formatDate, followLabel } from './format.js';

describe('format', () => {
  it('daysLeft counts whole days and handles unknown', () => {
    const now = Date.UTC(2026, 0, 1);
    expect(daysLeft(now + 10.5 * 86400000, now)).toBe(10);
    expect(daysLeft(now - 1, now)).toBe(-1);
    expect(daysLeft(null, now)).toBeNull();
  });

  it('truncate collapses whitespace and adds an ellipsis', () => {
    expect(truncate('a\n\n b', 10)).toBe('a b');
    expect(truncate('abcdefghij', 5)).toBe('abcd…');
    expect(truncate(null, 5)).toBe('');
  });

  it('ruleToForm keeps only the editable fields', () => {
    expect(ruleToForm({ id: '1', mediaId: '2', keyword: 'k', dmText: 'd', enabled: false })).toEqual({ keyword: 'k', gateText: '', dmText: 'd', enabled: false });
    expect(ruleToForm({ keyword: 'k', dmText: 'd', gateText: 'g', enabled: true })).toMatchObject({ gateText: 'g' });
    expect(emptyRule().enabled).toBe(true);
  });

  it('formatDate ignores empty and invalid values', () => {
    expect(formatDate('')).toBe('');
    expect(formatDate('nope')).toBe('');
    expect(formatDate(Date.UTC(2026, 0, 1))).not.toBe('');
  });

  it('followLabel names the follow-gate states', () => {
    expect(followLabel('waiting')).toBe('waiting');
    expect(followLabel('sent')).toBe('unlocked');
    expect(followLabel('expired')).toBe('expired');
    expect(followLabel('')).toBe('');
  });
});
