// Copies shared modules into each function's lib/ folder (Catalyst deploys each function folder alone).
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SHARED = path.join(ROOT, 'shared');

const MAP = {
  webhook: ['instagram.js', 'match.js', 'replies.js', 'unlock.js', 'signature.js', 'webhook-handler.js', 'store.js'],
  admin: ['instagram.js', 'match.js', 'reels.js', 'rules-admin.js', 'store.js', 'guards.js', 'oauth.js'],
};

for (const [fn, files] of Object.entries(MAP)) {
  const dest = path.join(ROOT, 'functions', fn, 'lib');
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  for (const f of files) {
    const src = path.join(SHARED, f);
    if (!fs.existsSync(src)) {
      console.warn(`skip ${fn}/${f} (shared/${f} not created yet)`);
      continue;
    }
    fs.copyFileSync(src, path.join(dest, f));
  }
  console.log(`synced ${fn}`);
}
