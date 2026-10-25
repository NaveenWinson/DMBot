'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createStore, toRule, ruleRow } = require('../store');

function fakeApp({ processedExists = false, insertFails = false } = {}) {
  const queries = [];
  let existsNow = processedExists;
  const tables = {};
  const table = (name) => (tables[name] = tables[name] || {
    inserted: [], updated: [],
    insertRow: async (row) => {
      if (name === 'Processed' && insertFails) { existsNow = true; throw new Error('Duplicate value for unique column'); }
      tables[name].inserted.push(row); return { ROWID: '77', ...row };
    },
    updateRow: async (row) => { tables[name].updated.push(row); return row; },
  });
  return {
    queries, tables,
    zcql: () => ({ executeZCQLQuery: async (sql) => { queries.push(sql); return sql.includes('FROM Processed WHERE') && existsNow ? [{ Processed: { ROWID: '5' } }] : []; } }),
    datastore: () => ({ table }),
  };
}

test('rule rows store enabled as text and drop unknown fields', () => {
  const row = ruleRow({ mediaId: '1', keyword: 'link', enabled: false, publicReplies: ['a'], junk: 'x' });
  assert.deepStrictEqual(row, { media_id: '1', keyword: 'link', enabled: 'false' });
  assert.strictEqual(toRule({ ROWID: 3, ...row }).enabled, false);
});

test('lastReplyText reads the newest processed row', async () => {
  const app = fakeApp();
  app.zcql = () => ({ executeZCQLQuery: async (sql) => { app.queries.push(sql); return [{ Processed: { reply_text: 'DM sent! 💌' } }]; } });
  assert.strictEqual(await createStore(app).lastReplyText('17'), 'DM sent! 💌');
  assert.match(app.queries[0], /WHERE account_id = '17' ORDER BY CREATEDTIME DESC LIMIT 0, 1$/);
});

test('claimComment inserts once and returns null for an existing comment', async () => {
  const app = fakeApp();
  assert.strictEqual(await createStore(app).claimComment({ commentId: '100', dmStatus: 'pending' }), '77');
  assert.deepStrictEqual(app.tables.Processed.inserted[0], { comment_id: '100', dm_status: 'pending' });
  assert.strictEqual(await createStore(fakeApp({ processedExists: true })).claimComment({ commentId: '100' }), null);
});

test('claimComment treats a unique-column clash from a parallel delivery as a duplicate', async () => {
  assert.strictEqual(await createStore(fakeApp({ insertFails: true })).claimComment({ commentId: '100' }), null);
});

test('ids are digits only before they reach ZCQL', async () => {
  const store = createStore(fakeApp());
  await assert.rejects(store.listRulesForMedia('17', "1' OR '1'='1"), /bad id/);
  await assert.rejects(store.listRules("1' OR '1'='1"), /bad id/);
  await assert.rejects(store.getAccountByEmail("a@b.co' OR '1'='1"), /bad email/);
  await assert.rejects(store.claimComment({ commentId: 'x' }), /bad id/);
});

test('listActivity clamps the limit', async () => {
  const app = fakeApp();
  await createStore(app).listActivity('17', '9999');
  assert.match(app.queries[0], /ORDER BY CREATEDTIME DESC LIMIT 0, 300$/);
});

test('waiting lookups only take digit ids and valid usernames', async () => {
  const app = fakeApp();
  const store = createStore(app);
  await store.listWaitingByFromId('17', '123');
  await store.listWaitingByUsername('17', 'Fan.One');
  assert.match(app.queries[0], /WHERE account_id = '17' AND from_id = '123' AND unlock_status = 'waiting'$/);
  assert.match(app.queries[1], /WHERE account_id = '17' AND from_username = 'fan.one' AND unlock_status = 'waiting'$/);
  await assert.rejects(store.listWaitingByUsername('17', "x' OR '1'='1"), /bad username/);
  await assert.rejects(store.listWaitingByFromId("1' OR '1'='1", '123'), /bad id/);
});

function memoryApp(tables) {
  const queries = [];
  return {
    queries, tables,
    zcql: () => ({ executeZCQLQuery: async (sql) => {
      queries.push(sql);
      const t = /FROM (\w+)/.exec(sql)[1];
      let rows = tables[t];
      if (/IS NULL/.test(sql)) rows = rows.filter((r) => !r.account_id);
      for (const [, k, v] of sql.matchAll(/(\w+) = '([^']*)'/g)) rows = rows.filter((r) => String(r[k]) === v);
      const lim = /LIMIT (\d+), (\d+)/.exec(sql);
      if (lim) rows = rows.slice(+lim[1], +lim[1] + +lim[2]);
      return rows.map((r) => ({ [t]: r }));
    } }),
    datastore: () => ({ table: (t) => ({
      insertRow: async (row) => { const r = { ROWID: String(100 + tables[t].length), ...row }; tables[t].push(r); return r; },
      updateRow: async (row) => Object.assign(tables[t].find((x) => x.ROWID === String(row.ROWID)), row),
    }) }),
  };
}

test('saveAccount keeps one row per email and lowercases it', async () => {
  const app = memoryApp({ Settings: [] });
  const store = createStore(app);
  await store.saveAccount('Friend@Mail.com', { igUserId: '5', username: 'f', accessToken: 't1' });
  await store.saveAccount('friend@mail.com', { accessToken: 't2' });
  assert.strictEqual(app.tables.Settings.length, 1);
  assert.deepStrictEqual((await store.getAccountByEmail('FRIEND@mail.com')), { id: '100', ownerEmail: 'friend@mail.com', igUserId: '5', username: 'f', accessToken: 't2', tokenExpiresAt: null });
  assert.strictEqual((await store.getAccountByIgUserId('5')).ownerEmail, 'friend@mail.com');
});

test('insertRule stamps the account and updateRule never moves a rule', async () => {
  const app = memoryApp({ Rules: [] });
  const store = createStore(app);
  const r = await store.insertRule('17', { mediaId: '1', keyword: 'k', dmText: 'd', accountId: '99' });
  assert.strictEqual(r.accountId, '17');
  await store.updateRule(r.id, { keyword: 'k2', accountId: '99' });
  assert.strictEqual(app.tables.Rules[0].account_id, '17');
});

test('migrateLegacy gives the ownerless account to ADMIN_EMAIL and fills only empty account_ids; reruns are harmless', async () => {
  const app = memoryApp({
    Settings: [{ ROWID: '1', ig_user_id: '17', username: 'me', access_token: 't' }],
    Rules: [{ ROWID: '2', media_id: '5', keyword: 'macau' }, { ROWID: '3', media_id: '6', keyword: 'x', account_id: '42' }],
    Processed: [{ ROWID: '4', comment_id: '9' }],
  });
  const store = createStore(app);
  assert.deepStrictEqual(await store.migrateLegacy('Owner@Mail.com'), { account: '17', rules: 1, processed: 1 });
  assert.strictEqual(app.tables.Settings[0].owner_email, 'owner@mail.com');
  assert.deepStrictEqual(app.tables.Rules.map((r) => r.account_id), ['17', '42']);
  assert.strictEqual(app.tables.Processed[0].account_id, '17');
  assert.deepStrictEqual(await store.migrateLegacy('owner@mail.com'), { account: '17', rules: 0, processed: 0 });
});
