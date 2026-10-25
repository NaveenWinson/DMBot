'use strict';
// Instagram API with Instagram Login (graph.instagram.com). Docs: developers.facebook.com/docs/instagram-platform

const HOST = 'https://graph.instagram.com';
const API_VERSION = process.env.IG_API_VERSION || 'v26.0';
const REEL_PAGES = 5; // at most 5 x 50 recent posts are scanned for reels

class InstagramError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function withQuickReplies(text, quickReplies) {
  const message = { text };
  if (quickReplies && quickReplies.length) {
    message.quick_replies = quickReplies.map((q) => ({ content_type: 'text', title: q.title, payload: q.payload }));
  }
  return message;
}

function createInstagram(accessToken, { fetchImpl = fetch, version = API_VERSION } = {}) {
  if (process.env.IG_MOCK === '1') return createMockInstagram(accessToken);
  const base = `${HOST}/${version}`;

  async function call(method, url, body) {
    const res = await fetchImpl(url, {
      method,
      headers: { Authorization: `Bearer ${accessToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = {};
    try { data = await res.json(); } catch (_) { /* non-JSON body */ }
    if (!res.ok || data.error) {
      const e = data.error || {};
      throw new InstagramError(e.message || `Instagram request failed (${res.status})`, res.status, e.code);
    }
    return data;
  }

  // The subscription and refresh docs pass the token as a query parameter rather than a header.
  const withToken = (url) => `${url}&access_token=${encodeURIComponent(accessToken)}`;

  return {
    // user_id is the professional account ID that webhooks use (entry.id); id is app-scoped.
    me: () => call('GET', `${base}/me?fields=user_id,username`),

    async listReels() {
      const fields = 'id,caption,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp';
      let url = `${base}/me/media?fields=${fields}&limit=50`;
      const out = [];
      for (let i = 0; i < REEL_PAGES && url; i++) {
        const page = await call('GET', url);
        out.push(...(page.data || []).filter((m) => m.media_product_type === 'REELS'));
        url = page.paging && page.paging.next;
      }
      return out;
    },

    // The one private reply a comment allows. quickReplies: [{ title, payload }] (optional tap buttons).
    sendPrivateReply: (igUserId, commentId, text, quickReplies) =>
      call('POST', `${base}/${encodeURIComponent(igUserId)}/messages`, { recipient: { comment_id: commentId }, message: withQuickReplies(text, quickReplies) }),

    // A normal DM; only allowed within 24 hours of the person's last message.
    sendMessage: (igUserId, recipientId, text, quickReplies) =>
      call('POST', `${base}/${encodeURIComponent(igUserId)}/messages`, { recipient: { id: recipientId }, message: withQuickReplies(text, quickReplies) }),

    // Needs consent: only works after the person has messaged the account.
    getUserProfile: (igsid) => call('GET', `${base}/${encodeURIComponent(igsid)}?fields=username,is_user_follow_business`),

    replyToComment: (commentId, message) =>
      call('POST', `${base}/${encodeURIComponent(commentId)}/replies`, { message }),

    getMedia: (mediaId) =>
      call('GET', `${base}/${encodeURIComponent(mediaId)}?fields=id,permalink,comments_count,media_product_type,timestamp`),

    listComments: (mediaId) =>
      call('GET', `${base}/${encodeURIComponent(mediaId)}/comments?fields=id,text,timestamp,username,from&limit=25`),

    subscribedApps: () => call('GET', withToken(`${base}/me/subscribed_apps?fields=subscribed_fields`)),

    subscribeComments: () => call('POST', withToken(`${base}/me/subscribed_apps?subscribed_fields=comments,messages`)),

    // Long-lived tokens last 60 days; refreshing (token must be 24h+ old) returns a fresh 60-day token.
    refreshToken: () => call('GET', withToken(`${HOST}/refresh_access_token?grant_type=ig_refresh_token`)),
  };
}

// IG_MOCK=1: no network, for trying the functions locally with `catalyst serve`.
function createMockInstagram(accessToken) {
  const log = (...a) => console.log('[IG_MOCK]', ...a);
  const second = String(accessToken || '').endsWith('-B'); // a token ending in -B is a second mock account
  return {
    me: async () => (second ? { user_id: '17840000000000002', username: 'mock_friend' } : { user_id: '17840000000000000', username: 'mock_account' }),
    listReels: async () => [{ id: '18000000000000001', caption: 'Mock reel', media_product_type: 'REELS', permalink: 'https://www.instagram.com/reel/MOCK123/', timestamp: new Date().toISOString() }],
    sendPrivateReply: async (igUserId, commentId, text, qr) => { log('DM', commentId, text, qr ? JSON.stringify(qr) : ''); return { message_id: 'mock' }; },
    sendMessage: async (igUserId, recipientId, text, qr) => { log('message', recipientId, text, qr ? JSON.stringify(qr) : ''); return { message_id: 'mock' }; },
    getUserProfile: async (igsid) => ({ id: igsid, username: 'fan', is_user_follow_business: process.env.IG_MOCK_FOLLOWS === '1' }),
    replyToComment: async (commentId, message) => { log('reply', commentId, message); return { id: 'mock' }; },
    subscribeComments: async () => ({ success: true }),
    refreshToken: async () => ({ access_token: 'mock-token', expires_in: 5184000 }),
  };
}

module.exports = { createInstagram, InstagramError, API_VERSION };
