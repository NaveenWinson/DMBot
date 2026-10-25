'use strict';
// Admin API for the DMBot page. Every Catalyst user (invited by the owner) manages only their own Instagram account.
// Also hosts the Instagram login callback and the x-cron-secret maintenance endpoints.
const express = require('express');
const catalyst = require('zcatalyst-sdk-node');
const { createStore } = require('./lib/store');
const { createInstagram, InstagramError } = require('./lib/instagram');
const { cronAuthorized } = require('./lib/guards');
const { validateRule, keywordTaken } = require('./lib/rules-admin');
const { findRule } = require('./lib/match');
const { toReel, findReelByUrl } = require('./lib/reels');
const { signState, verifyState, authorizeUrl, exchangeCode } = require('./lib/oauth');

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
  ? 'Instagram says the access token is invalid or expired. Connect Instagram again in Settings.'
  : `Instagram error: ${(err && err.message) || 'request failed'}`);

const redirectUri = () => `${process.env.APP_BASE_URL}/server/admin/oauth/callback`;
const cron = (req, res) => {
  if (cronAuthorized(req.get('x-cron-secret'), process.env.CRON_SECRET)) return true;
  res.status(401).json({ error: 'Unauthorized' });
  return false;
};

// Token check + webhook subscription + save, shared by the Instagram login and the pasted-token fallback.
async function connectAccount(store, email, accessToken, expiresIn) {
  const ig = createInstagram(accessToken);
  const me = await ig.me();
  if (!me || !me.user_id) throw new Error('Instagram did not return an account for this token');
  const igUserId = String(me.user_id);
  const owner = await store.getAccountByIgUserId(igUserId);
  if (owner && owner.ownerEmail && owner.ownerEmail !== email) {
    const e = new Error('This Instagram account is already connected to another DMBot user.');
    e.conflict = true;
    throw e;
  }
  await ig.subscribeComments();
  const fields = { accessToken, igUserId, username: me.username || '', tokenExpiresAt: Date.now() + (expiresIn ? expiresIn * 1000 : TOKEN_LIFETIME_MS) };
  await store.saveAccount(email, fields);
  return fields;
}

// ---- maintenance (x-cron-secret), registered before the sign-in guard ----

// Weekly/fortnightly cron: refresh every account's token; one failure does not stop the rest.
app.post('/cron/refresh-token', async (req, res) => {
  if (!cron(req, res)) return;
  try {
    const store = createStore(catalyst.initialize(req));
    const results = [];
    for (const a of await store.listAccounts()) {
      if (!a.accessToken) continue;
      try {
        const out = await createInstagram(a.accessToken).refreshToken();
        const tokenExpiresAt = Date.now() + (Number(out.expires_in) * 1000 || TOKEN_LIFETIME_MS);
        await store.updateAccount(a.id, { accessToken: out.access_token, tokenExpiresAt });
        results.push({ username: a.username, refreshed: true, tokenExpiresAt });
      } catch (err) {
        console.error('token refresh failed:', a.username, err.message);
        results.push({ username: a.username, refreshed: false, error: err.message });
      }
    }
    res.json({ ok: true, results });
  } catch (err) {
    console.error('token refresh failed:', err.message);
    res.status(500).json({ error: 'Token refresh failed' });
  }
});

// Re-runs the webhook subscription (comments + messages) for every account.
app.post('/cron/resubscribe', async (req, res) => {
  if (!cron(req, res)) return;
  try {
    const results = [];
    for (const a of await createStore(catalyst.initialize(req)).listAccounts()) {
      if (!a.accessToken) continue;
      const ig = createInstagram(a.accessToken);
      try {
        await ig.subscribeComments();
        results.push({ username: a.username, subscribedApps: await ig.subscribedApps() });
      } catch (err) {
        results.push({ username: a.username, error: igMessage(err) });
      }
    }
    res.json({ ok: true, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// One-off: give the single-account data from before multi-account support to ADMIN_EMAIL. Safe to run again.
app.post('/cron/migrate', async (req, res) => {
  if (!cron(req, res)) return;
  try {
    res.json({ ok: true, ...(await createStore(catalyst.initialize(req)).migrateLegacy(process.env.ADMIN_EMAIL)) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Read-only troubleshooting. No ?ig: a summary of every account. ?ig=<id>: what the bot sees on Instagram for that
// account vs. what it has recorded. Never returns tokens.
app.get('/cron/diagnose', async (req, res) => {
  if (!cron(req, res)) return;
  const out = {};
  const attempt = async (key, fn) => { try { out[key] = await fn(); } catch (e) { out[key] = { error: e.message, code: e.code }; } };
  try {
    const store = createStore(catalyst.initialize(req));
    const accounts = await store.listAccounts();
    if (!req.query.ig) {
      out.accounts = [];
      for (const a of accounts) {
        out.accounts.push({ igUserId: a.igUserId, username: a.username, ownerEmail: a.ownerEmail, connected: !!a.accessToken, tokenExpiresAt: a.tokenExpiresAt, rules: a.igUserId ? (await store.listRules(a.igUserId)).length : 0 });
      }
      return res.json(out);
    }
    const settings = accounts.find((a) => a.igUserId === String(req.query.ig));
    if (!settings) return res.status(404).json({ error: 'No such account' });
    out.settings = { igUserId: settings.igUserId, username: settings.username, ownerEmail: settings.ownerEmail, tokenExpiresAt: settings.tokenExpiresAt };
    const rules = await store.listRules(settings.igUserId);
    out.rules = rules.map((r) => ({ id: r.id, mediaId: r.mediaId, keyword: r.keyword, enabled: r.enabled, gated: !!r.gateText }));
    const activity = await store.listActivity(settings.igUserId, 20);
    out.activity = activity.map((a) => ({ commentId: a.commentId, text: a.commentText, dm: a.dmStatus, reply: a.replyStatus, follow: a.unlockStatus, error: a.error, at: a.createdAt }));
    const ig = createInstagram(settings.accessToken);
    await attempt('subscribedApps', () => ig.subscribedApps());
    const seen = new Set(activity.map((a) => a.commentId));
    out.media = {};
    out.reels = {};
    for (const mediaId of [...new Set(rules.map((r) => r.mediaId))]) {
      await attempt('tmp', () => ig.getMedia(mediaId));
      out.media[mediaId] = out.tmp;
      await attempt('tmp', () => ig.listComments(mediaId));
      const list = out.tmp && out.tmp.data;
      out.reels[mediaId] = list ? list.map((c) => {
        const from = c.from || {};
        const own = from.id === settings.igUserId || (c.username || '').toLowerCase() === settings.username.toLowerCase();
        const rule = findRule(rules, mediaId, c.text);
        return { id: c.id, text: c.text, at: c.timestamp, ownComment: own, matchesRule: rule ? rule.keyword : null, recorded: seen.has(String(c.id)) };
      }) : out.tmp;
      delete out.tmp;
    }
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message, partial: out });
  }
});

// ---- signed-in users ----

async function currentUser(req) {
  const catalystApp = catalyst.initialize(req);
  const user = await catalystApp.userManagement().getCurrentUser();
  if (!user || !user.email_id) return null;
  return { email: String(user.email_id).trim().toLowerCase(), store: createStore(catalystApp) };
}

// Instagram sends the browser back here after "Connect Instagram". Answers with redirects, not JSON.
app.get('/oauth/callback', async (req, res) => {
  const back = (q) => res.redirect(302, `${process.env.APP_BASE_URL}/app/#/settings?${q}`);
  if (req.query.error) return back('error=' + encodeURIComponent(req.query.error_description || 'Instagram login was cancelled'));
  try {
    const u = await currentUser(req);
    if (!u) return back('error=' + encodeURIComponent('Sign in to DMBot first, then connect Instagram'));
    const email = verifyState(req.query.state, process.env.META_APP_SECRET);
    if (!email || email !== u.email) return back('error=' + encodeURIComponent('That login link expired. Click Connect Instagram again.'));
    const { accessToken, expiresIn } = await exchangeCode({
      appId: process.env.IG_APP_ID, appSecret: process.env.META_APP_SECRET, redirectUri: redirectUri(), code: req.query.code,
    });
    await connectAccount(u.store, u.email, accessToken, expiresIn);
    back('connected=1');
  } catch (err) {
    console.error('instagram login failed:', err.message);
    back('error=' + encodeURIComponent(err.conflict ? err.message : 'Could not connect Instagram: ' + err.message));
  }
});

async function requireUser(req, res, next) {
  try {
    const u = await currentUser(req);
    if (!u) return res.status(401).json({ error: 'Please sign in' });
    req.email = u.email;
    req.store = u.store;
    req.account = await u.store.getAccountByEmail(u.email);
    next();
  } catch (err) {
    res.status(401).json({ error: 'Please sign in' });
  }
}

app.use(requireUser);

function connected(req, res) {
  if (!req.account || !req.account.accessToken) {
    res.status(409).json({ error: 'Connect your Instagram account in Settings first' });
    return null;
  }
  return req.account;
}

const publicSettings = (email, s) => ({
  email,
  connected: !!(s && s.accessToken),
  username: (s && s.username) || '',
  igUserId: (s && s.igUserId) || '',
  tokenExpiresAt: (s && s.tokenExpiresAt) || null,
});

app.get('/settings', (req, res) => res.json(publicSettings(req.email, req.account)));

// Starts "Connect Instagram": the page sends the browser to this URL.
app.get('/oauth/start', (req, res) => {
  if (!process.env.IG_APP_ID || !process.env.APP_BASE_URL) return res.status(500).json({ error: 'Instagram login is not configured' });
  res.json({ url: authorizeUrl({ appId: process.env.IG_APP_ID, redirectUri: redirectUri(), state: signState(req.email, process.env.META_APP_SECRET) }) });
});

// Fallback: save a pasted access token (generated in the Meta dashboard).
app.put('/settings', async (req, res) => {
  const accessToken = String((req.body && req.body.accessToken) || '').trim();
  if (!accessToken || accessToken.length > 1000 || /\s/.test(accessToken)) return res.status(400).json({ error: 'Paste the access token from the Meta dashboard' });
  try {
    res.json(publicSettings(req.email, await connectAccount(req.store, req.email, accessToken)));
  } catch (err) {
    if (err.conflict) return res.status(409).json({ error: err.message });
    if (err instanceof InstagramError || /Instagram/.test(err.message)) return res.status(400).json({ error: igMessage(err) });
    console.error('settings save failed:', err.message);
    res.status(500).json({ error: 'Could not save settings' });
  }
});

async function loadReels(account) {
  return (await createInstagram(account.accessToken).listReels()).map(toReel);
}

// Instagram failures are shown to the user; anything else (Data Store) gets a generic message.
function sendFailure(res, err, what) {
  if (err instanceof InstagramError) return res.status(502).json({ error: igMessage(err) });
  if (err.message === 'bad id') return res.status(400).json({ error: 'Bad id' });
  console.error(`${what} failed:`, err.message);
  res.status(500).json({ error: `Could not ${what}` });
}

app.get('/reels', async (req, res) => {
  try {
    const account = connected(req, res);
    if (!account) return;
    const [reels, rules] = await Promise.all([loadReels(account), req.store.listRules(account.igUserId)]);
    const counts = {};
    rules.forEach((r) => { counts[r.mediaId] = (counts[r.mediaId] || 0) + 1; });
    res.json({ reels: reels.map((r) => ({ ...r, ruleCount: counts[r.id] || 0 })) });
  } catch (err) {
    sendFailure(res, err, 'load reels');
  }
});

app.post('/reels/resolve', async (req, res) => {
  try {
    const account = connected(req, res);
    if (!account) return;
    const reel = findReelByUrl(await loadReels(account), req.body && req.body.url);
    if (!reel) return res.status(404).json({ error: 'No reel on your account matches that link (only your recent reels are searched)' });
    res.json({ reel });
  } catch (err) {
    sendFailure(res, err, 'find the reel');
  }
});

app.get('/rules', async (req, res) => {
  try {
    const account = connected(req, res);
    if (!account) return;
    const mediaId = req.query.mediaId;
    const rules = mediaId ? await req.store.listRulesForMedia(account.igUserId, String(mediaId)) : await req.store.listRules(account.igUserId);
    res.json({ rules });
  } catch (err) {
    sendFailure(res, err, 'load rules');
  }
});

// A rule id from the browser is only usable if it belongs to the signed-in user's account.
async function ownRule(req, id) {
  const rule = await req.store.getRule(id);
  return rule && rule.accountId === req.account.igUserId ? rule : null;
}

async function saveRule(req, res, id) {
  const account = connected(req, res);
  if (!account) return;
  const v = validateRule(req.body);
  if (!v.ok) return res.status(400).json({ error: v.errors[0], errors: v.errors });
  try {
    if (id && !(await ownRule(req, id))) return res.status(404).json({ error: 'Rule not found' });
    const existing = await req.store.listRulesForMedia(account.igUserId, v.rule.mediaId);
    if (keywordTaken(existing, v.rule.mediaId, v.rule.keyword, id)) {
      return res.status(409).json({ error: `This reel already has a rule for "${v.rule.keyword}"` });
    }
    const rule = id ? await req.store.updateRule(id, v.rule) : await req.store.insertRule(account.igUserId, v.rule);
    res.json({ rule });
  } catch (err) {
    sendFailure(res, err, 'save rule');
  }
}

app.post('/rules', (req, res) => saveRule(req, res, null));
app.put('/rules/:id', (req, res) => saveRule(req, res, req.params.id));

app.delete('/rules/:id', async (req, res) => {
  try {
    if (!connected(req, res)) return;
    if (!(await ownRule(req, req.params.id))) return res.status(404).json({ error: 'Rule not found' });
    await req.store.deleteRule(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    sendFailure(res, err, 'delete rule');
  }
});

app.get('/activity', async (req, res) => {
  try {
    if (!req.account || !req.account.igUserId) return res.json({ activity: [] });
    res.json({ activity: await req.store.listActivity(req.account.igUserId, req.query.limit) });
  } catch (err) {
    sendFailure(res, err, 'load activity');
  }
});

module.exports = app;
