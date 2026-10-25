'use strict';

const PAGE = 300; // ZCQL returns at most 300 rows per query

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const bool = (v) => v === true || v === 'true';
// Every id that goes into a ZCQL string is digits only (Catalyst ROWIDs, Instagram media/comment ids).
// Instagram usernames: letters, digits, dots and underscores (lowercased before querying).
const usernameStr = (v) => {
  const s = String(v || '').toLowerCase();
  if (!/^[a-z0-9._]{1,30}$/.test(s)) throw new Error('bad username');
  return s;
};
const idStr = (v) => {
  const s = String(v);
  if (!/^\d+$/.test(s)) throw new Error('bad id');
  return s;
};

function toSettings(r) {
  return {
    id: String(r.ROWID),
    igUserId: r.ig_user_id || '',
    username: r.username || '',
    accessToken: r.access_token || '',
    tokenExpiresAt: num(r.token_expires_at),
  };
}

const SETTINGS_COLS = { igUserId: 'ig_user_id', username: 'username', accessToken: 'access_token', tokenExpiresAt: 'token_expires_at' };

function toRule(r) {
  return {
    id: String(r.ROWID),
    mediaId: r.media_id,
    permalink: r.permalink || '',
    captionPreview: r.caption_preview || '',
    keyword: r.keyword,
    dmText: r.dm_text || '',
    gateText: r.gate_text || '',
    enabled: bool(r.enabled),
  };
}

const RULE_COLS = { mediaId: 'media_id', permalink: 'permalink', captionPreview: 'caption_preview', keyword: 'keyword', dmText: 'dm_text', gateText: 'gate_text', enabled: 'enabled' };

function ruleRow(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields)) {
    if (!(k in RULE_COLS)) continue;
    if (k === 'enabled') out.enabled = String(Boolean(v));
    else out[RULE_COLS[k]] = v;
  }
  return out;
}

function toProcessed(r) {
  return {
    id: String(r.ROWID),
    commentId: r.comment_id,
    mediaId: r.media_id,
    fromId: r.from_id || '',
    fromUsername: r.from_username || '',
    commentText: r.comment_text || '',
    ruleId: r.rule_id || '',
    dmStatus: r.dm_status || '',
    replyStatus: r.reply_status || '',
    replyText: r.reply_text || '',
    unlockStatus: r.unlock_status || '',
    unlockExpiresAt: num(r.unlock_expires_at),
    unlockedAt: num(r.unlocked_at),
    error: r.error || '',
    createdAt: r.CREATEDTIME || null,
  };
}

const PROCESSED_COLS = { commentId: 'comment_id', mediaId: 'media_id', fromId: 'from_id', fromUsername: 'from_username', commentText: 'comment_text', ruleId: 'rule_id', dmStatus: 'dm_status', replyStatus: 'reply_status', replyText: 'reply_text', unlockStatus: 'unlock_status', unlockExpiresAt: 'unlock_expires_at', unlockedAt: 'unlocked_at', error: 'error' };

function mapCols(cols, patch) {
  const out = {};
  for (const [k, v] of Object.entries(patch)) if (k in cols) out[cols[k]] = v;
  return out;
}

function createStore(catalystApp) {
  const zcql = catalystApp.zcql();
  const datastore = catalystApp.datastore();

  async function queryAll(table, sql) {
    const out = [];
    for (let offset = 0; ; offset += PAGE) {
      const rows = await zcql.executeZCQLQuery(`${sql} ORDER BY ROWID LIMIT ${offset}, ${PAGE}`);
      out.push(...rows.map((r) => r[table]));
      if (rows.length < PAGE) break;
    }
    return out;
  }

  async function findProcessed(commentId) {
    const rows = await zcql.executeZCQLQuery(`SELECT ROWID FROM Processed WHERE comment_id = '${idStr(commentId)}'`);
    return rows.length ? String(rows[0].Processed.ROWID) : null;
  }

  return {
    async getSettings() {
      const rows = await zcql.executeZCQLQuery('SELECT * FROM Settings ORDER BY ROWID LIMIT 0, 1');
      return rows.length ? toSettings(rows[0].Settings) : null;
    },

    async saveSettings(patch) {
      const current = await this.getSettings();
      const row = mapCols(SETTINGS_COLS, patch);
      if (current) await datastore.table('Settings').updateRow({ ROWID: current.id, ...row });
      else await datastore.table('Settings').insertRow(row);
    },

    async listRules() {
      return (await queryAll('Rules', 'SELECT * FROM Rules')).map(toRule);
    },

    async listRulesForMedia(mediaId) {
      return (await queryAll('Rules', `SELECT * FROM Rules WHERE media_id = '${idStr(mediaId)}'`)).map(toRule);
    },

    async getRule(id) {
      const rows = await zcql.executeZCQLQuery(`SELECT * FROM Rules WHERE ROWID = '${idStr(id)}'`);
      return rows.length ? toRule(rows[0].Rules) : null;
    },

    async insertRule(fields) {
      const row = await datastore.table('Rules').insertRow(ruleRow(fields));
      return toRule(row);
    },

    async updateRule(id, fields) {
      const row = await datastore.table('Rules').updateRow({ ROWID: idStr(id), ...ruleRow(fields) });
      return toRule(row);
    },

    async deleteRule(id) {
      await datastore.table('Rules').deleteRow(idStr(id));
    },

    // Returns the new row id, or null if this comment was already handled (Meta re-sent the event).
    async claimComment(fields) {
      if (await findProcessed(fields.commentId)) return null;
      try {
        const row = await datastore.table('Processed').insertRow(mapCols(PROCESSED_COLS, fields));
        return String(row.ROWID);
      } catch (err) {
        // comment_id is a unique column: a parallel delivery may have inserted it first.
        if (await findProcessed(fields.commentId)) return null;
        throw err;
      }
    },

    async updateProcessed(id, patch) {
      await datastore.table('Processed').updateRow({ ROWID: idStr(id), ...mapCols(PROCESSED_COLS, patch) });
    },

    // Comments from this person still waiting for the follow check (see unlock.js).
    async listWaitingByFromId(fromId) {
      const rows = await zcql.executeZCQLQuery(`SELECT * FROM Processed WHERE from_id = '${idStr(fromId)}' AND unlock_status = 'waiting'`);
      return rows.map((r) => toProcessed(r.Processed));
    },

    async listWaitingByUsername(username) {
      const rows = await zcql.executeZCQLQuery(`SELECT * FROM Processed WHERE from_username = '${usernameStr(username)}' AND unlock_status = 'waiting'`);
      return rows.map((r) => toProcessed(r.Processed));
    },

    // The public reply used on the most recent comment, so the next one can be different.
    async lastReplyText() {
      const rows = await zcql.executeZCQLQuery('SELECT reply_text FROM Processed ORDER BY CREATEDTIME DESC LIMIT 0, 1');
      return rows.length ? rows[0].Processed.reply_text || null : null;
    },

    async listActivity(limit = 100) {
      const n = Math.max(1, Math.min(PAGE, Math.floor(Number(limit)) || 100));
      const rows = await zcql.executeZCQLQuery(`SELECT * FROM Processed ORDER BY CREATEDTIME DESC LIMIT 0, ${n}`);
      return rows.map((r) => toProcessed(r.Processed));
    },
  };
}

module.exports = { createStore, toRule, ruleRow, toSettings, toProcessed, idStr, usernameStr };
