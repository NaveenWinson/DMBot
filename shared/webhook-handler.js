'use strict';
const { findRule } = require('./match');
const { pickReply } = require('./replies');
const { extractMessages, handleMessage, gateText, isGated, unlockButton, UNLOCK_WINDOW_MS } = require('./unlock');

// Instagram Login puts field/value directly on each entry; the Facebook Login variant uses entry.changes[].
// Both shapes are accepted.
function extractComments(payload) {
  if (!payload || payload.object !== 'instagram' || !Array.isArray(payload.entry)) return [];
  const out = [];
  for (const entry of payload.entry) {
    const changes = Array.isArray(entry.changes) ? entry.changes : [{ field: entry.field, value: entry.value }];
    for (const ch of changes) {
      if (!ch || ch.field !== 'comments' || !ch.value) continue;
      const v = ch.value;
      const commentId = v.id || v.comment_id;
      if (!commentId) continue;
      out.push({
        accountId: entry.id != null ? String(entry.id) : '',
        commentId: String(commentId),
        parentId: v.parent_id ? String(v.parent_id) : null,
        mediaId: v.media && v.media.id ? String(v.media.id) : '',
        fromId: v.from && v.from.id ? String(v.from.id) : '',
        fromUsername: (v.from && v.from.username) || '',
        text: v.text || '',
      });
    }
  }
  return out;
}

const shortErr = (e) => String((e && e.message) || e).slice(0, 255);

function isOwnComment(c, settings) {
  if (c.fromId && (c.fromId === settings.igUserId)) return true;
  return !!c.fromUsername && !!settings.username && c.fromUsername.toLowerCase() === settings.username.toLowerCase();
}

// Sends the comment's one private reply: the follow-gate message (with a tap button) or, for keywords without a
// gate, the real DM. If Instagram refuses the button in a private reply, the gate text goes out without it.
async function sendFirstDm(ig, settings, c, rule) {
  if (!isGated(rule)) return ig.sendPrivateReply(settings.igUserId, c.commentId, rule.dmText);
  try {
    return await ig.sendPrivateReply(settings.igUserId, c.commentId, gateText(rule), unlockButton(rule.id));
  } catch (e) {
    console.warn('gate DM with button failed, retrying as text:', shortErr(e));
    return ig.sendPrivateReply(settings.igUserId, c.commentId, gateText(rule));
  }
}

async function handleComment(c, { store, ig, settings, rules, rand, lastReply, now = Date.now }) {
  if (isOwnComment(c, settings)) return { commentId: c.commentId, status: 'skipped', reason: 'own comment' };
  if (c.parentId) return { commentId: c.commentId, status: 'skipped', reason: 'reply to a comment' };
  const rule = findRule(rules, c.mediaId, c.text);
  if (!rule) return { commentId: c.commentId, status: 'skipped', reason: 'no matching rule' };

  // Meta retries deliveries, so the unique comment_id row is the "already handled" marker.
  const gated = isGated(rule);
  const rowId = await store.claimComment({
    commentId: c.commentId, mediaId: c.mediaId, fromId: c.fromId, fromUsername: c.fromUsername.toLowerCase(),
    commentText: c.text, ruleId: rule.id, dmStatus: 'pending', replyStatus: 'pending',
    ...(gated ? { unlockStatus: 'waiting', unlockExpiresAt: now() + UNLOCK_WINDOW_MS } : {}),
  });
  if (!rowId) return { commentId: c.commentId, status: 'skipped', reason: 'duplicate' };

  const errors = [];
  let dmStatus = 'sent';
  try {
    await sendFirstDm(ig, settings, c, rule);
  } catch (e) {
    dmStatus = 'failed';
    errors.push('DM: ' + shortErr(e));
  }
  const replyText = pickReply(lastReply, rand);
  let replyStatus = 'sent';
  try {
    await ig.replyToComment(c.commentId, replyText);
  } catch (e) {
    replyStatus = 'failed';
    errors.push('Reply: ' + shortErr(e));
  }
  const error = errors.join(' | ').slice(0, 255);
  await store.updateProcessed(rowId, { dmStatus, replyStatus, replyText, error });
  return { commentId: c.commentId, status: 'handled', gated, dmStatus, replyStatus, replyText, error };
}

async function handleWebhook(payload, { store, makeInstagram, rand = Math.random, now = Date.now }) {
  const comments = extractComments(payload);
  const messages = extractMessages(payload);
  if (comments.length === 0 && messages.length === 0) return [];
  const settings = await store.getSettings();
  if (!settings || !settings.accessToken || !settings.igUserId) {
    return [...comments.map((c) => ({ commentId: c.commentId, status: 'skipped', reason: 'not connected' })),
      ...messages.map((m) => ({ senderId: m.senderId, status: 'skipped', reason: 'not connected' }))];
  }
  const ig = makeInstagram(settings.accessToken);
  const rulesByMedia = new Map();
  const results = [];
  let lastReply; // loaded on the first match, then carried through the batch
  for (const c of comments) {
    try {
      if (c.accountId && c.accountId !== settings.igUserId) {
        results.push({ commentId: c.commentId, status: 'skipped', reason: 'other account' });
        continue;
      }
      if (!rulesByMedia.has(c.mediaId)) rulesByMedia.set(c.mediaId, c.mediaId ? await store.listRulesForMedia(c.mediaId) : []);
      const rules = rulesByMedia.get(c.mediaId);
      if (lastReply === undefined && rules.length) lastReply = await store.lastReplyText();
      const r = await handleComment(c, { store, ig, settings, rules, rand, lastReply, now });
      if (r.replyText) lastReply = r.replyText;
      results.push(r);
    } catch (e) {
      console.error('comment failed:', c.commentId, shortErr(e));
      results.push({ commentId: c.commentId, status: 'error', error: shortErr(e) });
    }
  }
  for (const m of messages) {
    try {
      if (m.accountId && m.accountId !== settings.igUserId) {
        results.push({ senderId: m.senderId, status: 'skipped', reason: 'other account' });
        continue;
      }
      results.push(await handleMessage(m, { store, ig, settings, now }));
    } catch (e) {
      console.error('message failed:', m.senderId, shortErr(e));
      results.push({ senderId: m.senderId, status: 'error', error: shortErr(e) });
    }
  }
  return results;
}

module.exports = { extractComments, handleComment, handleWebhook };
