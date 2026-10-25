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
  assert.strictEqual(await createStore(app).lastReplyText(), 'DM sent! 💌');
  assert.match(app.queries[0], /ORDER BY CREATEDTIME DESC LIMIT 0, 1$/);
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
  await assert.rejects(store.listRulesForMedia("1' OR '1'='1"), /bad id/);
  await assert.rejects(store.claimComment({ commentId: 'x' }), /bad id/);
});

test('listActivity clamps the limit', async () => {
  const app = fakeApp();
  await createStore(app).listActivity('9999');
  assert.match(app.queries[0], /ORDER BY CREATEDTIME DESC LIMIT 0, 300$/);
});

test('waiting lookups only take digit ids and valid usernames', async () => {
  const app = fakeApp();
  const store = createStore(app);
  await store.listWaitingByFromId('123');
  await store.listWaitingByUsername('Fan.One');
  assert.match(app.queries[0], /WHERE from_id = '123' AND unlock_status = 'waiting'$/);
  assert.match(app.queries[1], /WHERE from_username = 'fan.one' AND unlock_status = 'waiting'$/);
  await assert.rejects(store.listWaitingByUsername("x' OR '1'='1"), /bad username/);
});
