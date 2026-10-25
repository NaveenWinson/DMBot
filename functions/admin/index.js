'use strict';
// Admin API for the DMBot page (Catalyst sign-in + ADMIN_EMAIL), plus the token-refresh cron endpoint.
const express = require('express');
const catalyst = require('zcatalyst-sdk-node');
const { createStore } = require('./lib/store');
const { createInstagram, InstagramError } = require('./lib/instagram');
const { isAdminEmail, cronAuthorized } = require('./lib/guards');
const { validateRule, keywordTaken } = require('./lib/rules-admin');
const { findRule } = require('./lib/match');
const { toReel, findReelByUrl } = require('./lib/reels');

const DAY_MS = 24 * 60 * 60 * 1000;
const TOKEN_LIFETIME_MS = 60 * DAY_MS; // long-lived Instagram tokens

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));
app.use((req, res, next) => {
  res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
  next();
});

const igMessage = (err) => (err && err.code === 190
  ? 'Instagram says the access token is invalid or expired. Paste a new one in Settings.'
  : `Instagram error: ${(err && err.message) || 'request failed'}`);

// Called by a Catalyst cron job with the x-cron-secret header. Registered before the admin guard.
app.post('/cron/refresh-token', async (req, res) => {
  if (!cronAuthorized(req.get('x-cron-secret'), process.env.CRON_SECRET)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const store = createStore(catalyst.initialize(req));
    const settings = await store.getSettings();
    if (!settings || !settings.accessToken) return res.json({ ok: true, refreshed: false, reason: 'not connected' });
    const out = await createInstagram(settings.accessToken).refreshToken();
    const tokenExpiresAt = Date.now() + (Number(out.expires_in) * 1000 || TOKEN_LIFETIME_MS);
    await store.saveSettings({ accessToken: out.access_token, tokenExpiresAt });
    res.json({ ok: true, refreshed: true, tokenExpiresAt });
  } catch (err) {
    console.error('token refresh failed:', err.message);
    res.status(502).json({ error: 'Token refresh failed' });
  }
});

// Re-runs the webhook subscription (comments + messages) with the stored token, e.g. after adding a field.
app.post('/cron/resubscribe', async (req, res) => {
  if (!cronAuthorized(req.get('x-cron-secret'), process.env.CRON_SECRET)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const settings = await createStore(catalyst.initialize(req)).getSettings();
    if (!settings || !settings.accessToken) return res.status(409).json({ error: 'Not connected' });
    const ig = createInstagram(settings.accessToken);
    await ig.subscribeComments();
    res.json({ ok: true, subscribedApps: await ig.subscribedApps() });
  } catch (err) {
    res.status(502).json({ error: igMessage(err) });
  }
});

// Read-only troubleshooting (x-cron-secret): what the bot sees on Instagram vs. what it has recorded. Never returns the token.
app.get('/cron/diagnose', async (req, res) => {
  if (!cronAuthorized(req.get('x-cron-secret'), process.env.CRON_SECRET)) return res.status(401).json({ error: 'Unauthorized' });
  const out = {};
  const attempt = async (key, fn) => { try { out[key] = await fn(); } catch (e) { out[key] = { error: e.message, code: e.code }; } };
  try {
    const store = createStore(catalyst.initialize(req));
    const settings = await store.getSettings();
    out.settings = { connected: !!(settings && settings.accessToken), igUserId: settings && settings.igUserId, username: settings && settings.username, tokenExpiresAt: settings && settings.tokenExpiresAt };
    const rules = await store.listRules();
    out.rules = rules.map((r) => ({ id: r.id, mediaId: r.mediaId, keyword: r.keyword, enabled: r.enabled }));
    const activity = await store.listActivity(20);
    out.activity = activity.map((a) => ({ commentId: a.commentId, text: a.commentText, dm: a.dmStatus, reply: a.replyStatus, error: a.error, at: a.createdAt }));
    if (!settings || !settings.accessToken) return res.json(out);
    const ig = createInstagram(settings.accessToken);
    await attempt('me', () => ig.me());
    await attempt('subscribedApps', () => ig.subscribedApps());
    const seen = new Set(activity.map((a) => a.commentId));
    out.reels = {};
    out.media = {};
    for (const mediaId of [...new Set(rules.map((r) => r.mediaId))]) {
      await attempt('tmp', () => ig.getMedia(mediaId));
      out.media[mediaId] = out.tmp;
      await attempt('tmp', () => ig.listComments(mediaId));
      const list = out.tmp && out.tmp.data;
      out.reels[mediaId] = list ? list.map((c) => {
        const from = c.from || {};
        const own = from.id === settings.igUserId || (c.username || '').toLowerCase() === settings.username.toLowerCase();
        const rule = findRule(rules, mediaId, c.text);
        return { id: c.id, text: c.text, username: c.username, at: c.timestamp, ownComment: own, matchesRule: rule ? rule.keyword : null, recorded: seen.has(String(c.id)) };
      }) : out.tmp;
      delete out.tmp;
    }
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message, partial: out });
  }
});

async function requireAdmin(req, res, next) {
  try {
    const catalystApp = catalyst.initialize(req);
    const user = await catalystApp.userManagement().getCurrentUser();
    if (!user || !user.email_id) return res.status(401).json({ error: 'Please sign in' });
    if (!isAdminEmail(user.email_id, process.env.ADMIN_EMAIL)) return res.status(403).json({ error: 'Not authorized' });
    req.store = createStore(catalystApp);
    next();
  } catch (err) {
    res.status(401).json({ error: 'Please sign in' });
  }
}

app.use(requireAdmin);

async function connected(req, res) {
  const settings = await req.store.getSettings();
  if (!settings || !settings.accessToken) {
    res.status(409).json({ error: 'Connect your Instagram account in Settings first' });
    return null;
  }
  return settings;
}

const publicSettings = (s) => ({
  connected: !!(s && s.accessToken),
  username: (s && s.username) || '',
  igUserId: (s && s.igUserId) || '',
  tokenExpiresAt: (s && s.tokenExpiresAt) || null,
});

app.get('/settings', async (req, res) => {
  try {
    res.json(publicSettings(await req.store.getSettings()));
  } catch (err) {
    console.error('settings load failed:', err.message);
    res.status(500).json({ error: 'Could not load settings' });
  }
});

// Save a pasted access token: check it, turn on comment webhooks for the account, store it.
app.put('/settings', async (req, res) => {
  const accessToken = String((req.body && req.body.accessToken) || '').trim();
  if (!accessToken || accessToken.length > 1000 || /\s/.test(accessToken)) return res.status(400).json({ error: 'Paste the access token from the Meta dashboard' });
  let me;
  try {
    const ig = createInstagram(accessToken);
    me = await ig.me();
    if (!me || !me.user_id) return res.status(400).json({ error: 'Instagram did not return an account for this token' });
    await ig.subscribeComments();
  } catch (err) {
    return res.status(400).json({ error: igMessage(err) });
  }
  try {
    const fields = { accessToken, igUserId: String(me.user_id), username: me.username || '', tokenExpiresAt: Date.now() + TOKEN_LIFETIME_MS };
    await req.store.saveSettings(fields);
    res.json(publicSettings(fields));
  } catch (err) {
    console.error('settings save failed:', err.message);
    res.status(500).json({ error: 'Could not save settings' });
  }
});

async function loadReels(settings) {
  return (await createInstagram(settings.accessToken).listReels()).map(toReel);
}

// Instagram failures are shown to the admin; anything else (Data Store) gets a generic message.
function sendFailure(res, err, what) {
  if (err instanceof InstagramError) return res.status(502).json({ error: igMessage(err) });
  console.error(`${what} failed:`, err.message);
  res.status(500).json({ error: `Could not ${what}` });
}

app.get('/reels', async (req, res) => {
  try {
    const settings = await connected(req, res);
    if (!settings) return;
    const [reels, rules] = await Promise.all([loadReels(settings), req.store.listRules()]);
    const counts = {};
    rules.forEach((r) => { counts[r.mediaId] = (counts[r.mediaId] || 0) + 1; });
    res.json({ reels: reels.map((r) => ({ ...r, ruleCount: counts[r.id] || 0 })) });
  } catch (err) {
    sendFailure(res, err, 'load reels');
  }
});

app.post('/reels/resolve', async (req, res) => {
  try {
    const settings = await connected(req, res);
    if (!settings) return;
    const reel = findReelByUrl(await loadReels(settings), req.body && req.body.url);
    if (!reel) return res.status(404).json({ error: 'No reel on your account matches that link (only your recent reels are searched)' });
    res.json({ reel });
  } catch (err) {
    sendFailure(res, err, 'find the reel');
  }
});

app.get('/rules', async (req, res) => {
  try {
    const mediaId = req.query.mediaId;
    const rules = mediaId ? await req.store.listRulesForMedia(String(mediaId)) : await req.store.listRules();
    res.json({ rules });
  } catch (err) {
    if (err.message === 'bad id') return res.status(400).json({ error: 'Bad reel id' });
    console.error('rules load failed:', err.message);
    res.status(500).json({ error: 'Could not load rules' });
  }
});

async function saveRule(req, res, id) {
  const v = validateRule(req.body);
  if (!v.ok) return res.status(400).json({ error: v.errors[0], errors: v.errors });
  try {
    if (id && !(await req.store.getRule(id))) return res.status(404).json({ error: 'Rule not found' });
    const existing = await req.store.listRulesForMedia(v.rule.mediaId);
    if (keywordTaken(existing, v.rule.mediaId, v.rule.keyword, id)) {
      return res.status(409).json({ error: `This reel already has a rule for "${v.rule.keyword}"` });
    }
    const rule = id ? await req.store.updateRule(id, v.rule) : await req.store.insertRule(v.rule);
    res.json({ rule });
  } catch (err) {
    if (err.message === 'bad id') return res.status(400).json({ error: 'Bad rule id' });
    console.error('rule save failed:', err.message);
    res.status(500).json({ error: 'Could not save rule' });
  }
}

app.post('/rules', (req, res) => saveRule(req, res, null));
app.put('/rules/:id', (req, res) => saveRule(req, res, req.params.id));

app.delete('/rules/:id', async (req, res) => {
  try {
    await req.store.deleteRule(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    if (err.message === 'bad id') return res.status(400).json({ error: 'Bad rule id' });
    console.error('rule delete failed:', err.message);
    res.status(500).json({ error: 'Could not delete rule' });
  }
});

app.get('/activity', async (req, res) => {
  try {
    res.json({ activity: await req.store.listActivity(req.query.limit) });
  } catch (err) {
    console.error('activity load failed:', err.message);
    res.status(500).json({ error: 'Could not load activity' });
  }
});

module.exports = app;
