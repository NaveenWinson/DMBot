'use strict';
// Follow-gate: a matching comment gets a "follow us" DM first. When the person replies (taps the button or
// types DONE), the bot checks that they follow the account and then sends the real DM.
// Instagram has no "new follower" event and allows only one DM per comment, so their reply is the trigger.
const { normalize } = require('./match');

const UNLOCK_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const BUTTON_TITLE = 'I followed ✅';
const PAYLOAD_PREFIX = 'UNLOCK:';
const CONFIRM_WORD = 'done'; // the same for every keyword; matched with normalize(), so DONE / Done work too

const notFollowingText = (username) => `Looks like you're not following @${username} yet. Follow, then tap "${BUTTON_TITLE}" again.`;
const EXPIRED_TEXT = 'This offer has expired. Comment the keyword on the reel again to get it.';

const isGated = (rule) => !!(rule && rule.gateText);
const unlockButton = (ruleId) => [{ title: BUTTON_TITLE, payload: PAYLOAD_PREFIX + ruleId }];

// The gate message, with a how-to line added when it doesn't already mention DONE.
function gateText(rule) {
  const text = rule.gateText.trim();
  if (normalize(text).includes(CONFIRM_WORD)) return text;
  return `${text}\n\nAfter following, tap "${BUTTON_TITLE}" or reply "${CONFIRM_WORD.toUpperCase()}".`;
}

function extractMessages(payload) {
  if (!payload || payload.object !== 'instagram' || !Array.isArray(payload.entry)) return [];
  const out = [];
  for (const entry of payload.entry) {
    for (const m of Array.isArray(entry.messaging) ? entry.messaging : []) {
      if (!m || !m.message || !m.sender || !m.sender.id) continue;
      out.push({
        accountId: entry.id != null ? String(entry.id) : '',
        senderId: String(m.sender.id),
        mid: m.message.mid || '',
        text: m.message.text || '',
        payload: (m.message.quick_reply && m.message.quick_reply.payload) || '',
        isEcho: m.message.is_echo === true,
      });
    }
  }
  return out;
}

const shortErr = (e) => String((e && e.message) || e).slice(0, 255);

async function handleMessage(m, { store, ig, settings, now = Date.now }) {
  const base = { senderId: m.senderId };
  if (m.isEcho || m.senderId === settings.igUserId) return { ...base, status: 'skipped', reason: 'echo' };
  if (!m.text && !m.payload) return { ...base, status: 'skipped', reason: 'no text' };

  let profile = null;
  let waiting = await store.listWaitingByFromId(m.senderId);
  if (waiting.length === 0) {
    // The comment's sender id may differ from the messaging id; fall back to the username (consent is given now).
    try {
      profile = await ig.getUserProfile(m.senderId);
      if (profile && profile.username) waiting = await store.listWaitingByUsername(profile.username);
    } catch (e) {
      return { ...base, status: 'skipped', reason: 'not waiting (' + shortErr(e) + ')' };
    }
  }
  if (waiting.length === 0) return { ...base, status: 'skipped', reason: 'not waiting' };

  const rules = new Map();
  for (const id of new Set(waiting.map((w) => w.ruleId))) rules.set(id, await store.getRule(id));

  // The button names its keyword; typing DONE covers every keyword they're waiting on.
  let targets;
  if (m.payload.startsWith(PAYLOAD_PREFIX)) {
    const id = m.payload.slice(PAYLOAD_PREFIX.length);
    targets = rules.get(id) ? [rules.get(id)] : [];
  } else if (normalize(m.text) === CONFIRM_WORD) {
    targets = [...rules.values()].filter(Boolean);
  } else {
    return { ...base, status: 'skipped', reason: 'not a confirm word' };
  }
  if (targets.length === 0) return { ...base, status: 'skipped', reason: 'keyword deleted' };

  const results = [];
  for (const rule of targets) {
    const r = await unlockRule(rule, waiting.filter((w) => w.ruleId === rule.id), { m, ig, store, settings, now, profile });
    profile = r.profile;
    results.push(r.status);
  }
  return { ...base, status: results.join(','), keywords: targets.map((r) => r.keyword) };
}

async function unlockRule(rule, rows, { m, ig, store, settings, now, profile }) {
  const t = now();
  const expired = rows.filter((w) => w.unlockExpiresAt != null && w.unlockExpiresAt < t);
  const open = rows.filter((w) => !expired.includes(w));
  for (const w of expired) await store.updateProcessed(w.id, { unlockStatus: 'expired' });
  if (open.length === 0) {
    await ig.sendMessage(settings.igUserId, m.senderId, EXPIRED_TEXT);
    return { status: 'expired', profile };
  }

  if (!profile) profile = await ig.getUserProfile(m.senderId);
  if (!profile || profile.is_user_follow_business !== true) {
    await ig.sendMessage(settings.igUserId, m.senderId, notFollowingText(settings.username), unlockButton(rule.id));
    return { status: 'not following', profile };
  }

  try {
    await ig.sendMessage(settings.igUserId, m.senderId, rule.dmText);
  } catch (e) {
    for (const w of open) await store.updateProcessed(w.id, { error: ('Unlock: ' + shortErr(e)).slice(0, 255) });
    throw e;
  }
  for (const w of open) await store.updateProcessed(w.id, { unlockStatus: 'sent', unlockedAt: t, fromId: m.senderId });
  return { status: 'unlocked', profile };
}

module.exports = { extractMessages, handleMessage, gateText, isGated, unlockButton, UNLOCK_WINDOW_MS, BUTTON_TITLE, CONFIRM_WORD, EXPIRED_TEXT, notFollowingText };
