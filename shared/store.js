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
const emailStr = (v) => {
  const s = String(v || '').trim().toLowerCase();
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(s)) throw new Error('bad email');
  return s;
};

// One Settings row per connected Instagram account, owned by one Catalyst sign-in email.
function toSettings(r) {
  return {
    id: String(r.ROWID),
    ownerEmail: r.owner_email || '',
    igUserId: r.ig_user_id || '',
    username: r.username || '',
    accessToken: r.access_token || '',
    tokenExpiresAt: num(r.token_expires_at),
  };
}

const SETTINGS_COLS = { ownerEmail: 'owner_email', igUserId: 'ig_user_id', username: 'username', accessToken: 'access_token', tokenExpiresAt: 'token_expires_at' };

function toRule(r) {
  return {
    id: String(r.ROWID),
    accountId: r.account_id || '',
    mediaId: r.media_id,
    permalink: r.permalink || '',
    captionPreview: r.caption_preview || '',
    keyword: r.keyword,
    dmText: r.dm_text || '',
    gateText: r.gate_text || '',
    enabled: bool(r.enabled),
  };
}

const RULE_COLS = { accountId: 'account_id', mediaId: 'media_id', permalink: 'permalink', captionPreview: 'caption_preview', keyword: 'keyword', dmText: 'dm_text', gateText: 'gate_text', enabled: 'enabled' };

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
    accountId: r.account_id || '',
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

const PROCESSED_COLS = { accountId: 'account_id', commentId: 'comment_id', mediaId: 'media_id', fromId: 'from_id', fromUsername: 'from_username', commentText: 'comment_text', ruleId: 'rule_id', dmStatus: 'dm_status', replyStatus: 'reply_status', replyText: 'reply_text', unlockStatus: 'unlock_status', unlockExpiresAt: 'unlock_expires_at', unlockedAt: 'unlocked_at', error: 'error' };

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

  async function firstRow(table, sql) {
    const rows = await zcql.executeZCQLQuery(sql);
    return rows.length ? rows[0][table] : null;
  }

  return {
    async listAccounts() {
      return (await queryAll('Settings', 'SELECT * FROM Settings')).map(toSettings);
    },

    async getAccountByEmail(email) {
      const r = await firstRow('Settings', `SELECT * FROM Settings WHERE owner_email = '${emailStr(email)}'`);
      return r ? toSettings(r) : null;
    },

    async getAccountByIgUserId(igUserId) {
      const r = await firstRow('Settings', `SELECT * FROM Settings WHERE ig_user_id = '${idStr(igUserId)}'`);
      return r ? toSettings(r) : null;
    },

    // Creates or updates the account row of this sign-in email.
    async saveAccount(email, patch) {
      const ownerEmail = emailStr(email);
      const current = await this.getAccountByEmail(ownerEmail);
      const row = mapCols(SETTINGS_COLS, { ...patch, ownerEmail });
      if (current) await datastore.table('Settings').updateRow({ ROWID: current.id, ...row });
      else await datastore.table('Settings').insertRow(row);
    },

    async updateAccount(id, patch) {
      await datastore.table('Settings').updateRow({ ROWID: idStr(id), ...mapCols(SETTINGS_COLS, patch) });
    },

    async listRules(accountId) {
      return (await queryAll('Rules', `SELECT * FROM Rules WHERE account_id = '${idStr(accountId)}'`)).map(toRule);
    },

    async listRulesForMedia(accountId, mediaId) {
      return (await queryAll('Rules', `SELECT * FROM Rules WHERE account_id = '${idStr(accountId)}' AND media_id = '${idStr(mediaId)}'`)).map(toRule);
    },

    async getRule(id) {
      const r = await firstRow('Rules', `SELECT * FROM Rules WHERE ROWID = '${idStr(id)}'`);
      return r ? toRule(r) : null;
    },

    async insertRule(accountId, fields) {
      const row = await datastore.table('Rules').insertRow(ruleRow({ ...fields, accountId: idStr(accountId) }));
      return toRule(row);
    },

    async updateRule(id, fields) {
      const { accountId, ...rest } = fields; // a rule never moves to another account
      const row = await datastore.table('Rules').updateRow({ ROWID: idStr(id), ...ruleRow(rest) });
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
    async listWaitingByFromId(accountId, fromId) {
      const rows = await zcql.executeZCQLQuery(`SELECT * FROM Processed WHERE account_id = '${idStr(accountId)}' AND from_id = '${idStr(fromId)}' AND unlock_status = 'waiting'`);
      return rows.map((r) => toProcessed(r.Processed));
    },

    async listWaitingByUsername(accountId, username) {
      const rows = await zcql.executeZCQLQuery(`SELECT * FROM Processed WHERE account_id = '${idStr(accountId)}' AND from_username = '${usernameStr(username)}' AND unlock_status = 'waiting'`);
      return rows.map((r) => toProcessed(r.Processed));
    },

    // The public reply used on this account's most recent comment, so the next one can be different.
    async lastReplyText(accountId) {
      const r = await firstRow('Processed', `SELECT reply_text FROM Processed WHERE account_id = '${idStr(accountId)}' ORDER BY CREATEDTIME DESC LIMIT 0, 1`);
      return r ? r.reply_text || null : null;
    },

    async listActivity(accountId, limit = 100) {
      const n = Math.max(1, Math.min(PAGE, Math.floor(Number(limit)) || 100));
      const rows = await zcql.executeZCQLQuery(`SELECT * FROM Processed WHERE account_id = '${idStr(accountId)}' ORDER BY CREATEDTIME DESC LIMIT 0, ${n}`);
      return rows.map((r) => toProcessed(r.Processed));
    },

    // One-off move from the single-account version: the account row without an owner goes to adminEmail,
    // and rules/processed rows without an account go to that account. Safe to run again.
    async migrateLegacy(adminEmail) {
      const owner = emailStr(adminEmail);
      const out = { account: null, rules: 0, processed: 0 };
      const orphans = (await this.listAccounts()).filter((a) => !a.ownerEmail);
      if (orphans.length > 1) throw new Error('more than one account row without an owner');
      if (orphans.length === 1 && !(await this.getAccountByEmail(owner))) await this.updateAccount(orphans[0].id, { ownerEmail: owner });
      const account = await this.getAccountByEmail(owner);
      if (!account || !account.igUserId) return out;
      out.account = account.igUserId;
      for (const [table, key] of [['Rules', 'rules'], ['Processed', 'processed']]) {
        const rows = await queryAll(table, `SELECT ROWID FROM ${table} WHERE account_id IS NULL`);
        for (const r of rows) await datastore.table(table).updateRow({ ROWID: String(r.ROWID), account_id: account.igUserId });
        out[key] = rows.length;
      }
      return out;
    },
  };
}

module.exports = { createStore, toRule, ruleRow, toSettings, toProcessed, idStr, usernameStr, emailStr };
