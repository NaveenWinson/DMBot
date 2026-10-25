export function formatDate(value) {
  if (value == null || value === '') return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

// Whole days left until the token expires (negative once expired), or null if unknown.
export function daysLeft(expiresAtMs, nowMs = Date.now()) {
  if (!expiresAtMs) return null;
  return Math.floor((expiresAtMs - nowMs) / (24 * 60 * 60 * 1000));
}

export function truncate(text, max) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

export const emptyRule = () => ({ keyword: '', gateText: '', dmText: '', enabled: true });

export function ruleToForm(rule) {
  return { keyword: rule.keyword, gateText: rule.gateText || '', dmText: rule.dmText, enabled: rule.enabled };
}

// Activity chip for the follow-gate state of a processed comment.
export function followLabel(unlockStatus) {
  return { waiting: 'waiting', sent: 'unlocked', expired: 'expired' }[unlockStatus] || '';
}
