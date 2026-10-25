'use strict';
// Instagram webhook: GET = Meta's subscription check, POST = comment notifications.
// Meta callback URL: https://<your-app-domain>/server/webhook/
const express = require('express');
const catalyst = require('zcatalyst-sdk-node');
const { createStore } = require('./lib/store');
const { createInstagram } = require('./lib/instagram');
const { verifySignature } = require('./lib/signature');
const { handleWebhook } = require('./lib/webhook-handler');

const app = express();
app.disable('x-powered-by');
// Keep the exact bytes: the signature is computed over the raw body, not the re-serialized JSON.
app.use(express.json({ limit: '1mb', verify: (req, _res, buf) => { req.rawBody = buf; } }));

app.get('/', (req, res) => {
  const token = process.env.WEBHOOK_VERIFY_TOKEN;
  if (req.query['hub.mode'] === 'subscribe' && token && req.query['hub.verify_token'] === token) {
    return res.status(200).type('text/plain').send(String(req.query['hub.challenge'] || ''));
  }
  res.sendStatus(403);
});

app.post('/', async (req, res) => {
  if (!req.rawBody) {
    // Catalyst consumed the body before Express could keep the raw bytes; see docs/setup.md "Verify at deploy".
    console.error('webhook: raw body unavailable, cannot check signature');
    return res.sendStatus(500);
  }
  if (!verifySignature(req.rawBody, req.get('x-hub-signature-256'), process.env.META_APP_SECRET)) {
    console.warn('webhook: bad signature', req.get('x-hub-signature-256') ? '(header present)' : '(no header)');
    return res.sendStatus(401);
  }
  const b = req.body || {};
  const fields = (Array.isArray(b.entry) ? b.entry : []).map((e) => e.field || (e.changes || []).map((c) => c.field).join('+'));
  console.log('webhook: received', JSON.stringify({ object: b.object, fields }));
  try {
    const store = createStore(catalyst.initialize(req));
    const results = await handleWebhook(req.body, { store, makeInstagram: (t) => createInstagram(t) });
    results.forEach((r) => console.log('webhook:', JSON.stringify(r)));
    // Reply only after the work is done: Catalyst may stop the function once it has responded.
    res.sendStatus(200);
  } catch (err) {
    // Settings could not be read; a non-200 makes Meta retry later.
    console.error('webhook failed:', err.message);
    res.sendStatus(500);
  }
});

module.exports = app;
