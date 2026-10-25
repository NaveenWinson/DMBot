'use strict';
// Injects deploy-time environment variables from the private, git-ignored .env.deploy file into each
// function's catalyst-config.json, and restores the originals byte-for-byte. Never prints values.
const fs = require('fs');
const path = require('path');

const FUNCTION_VARS = {
  webhook: ['META_APP_SECRET', 'WEBHOOK_VERIFY_TOKEN'],
  admin: ['ADMIN_EMAIL', 'CRON_SECRET'],
};

function parseEnvFile(text) {
  const out = {};
  const lines = String(text).split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) return;
    const body = raw.replace(/^\s*export\s+/, '');
    const eq = body.indexOf('=');
    const key = eq === -1 ? '' : body.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(`Malformed line ${i + 1} in .env.deploy (expected KEY=VALUE)`);
    }
    if (Object.prototype.hasOwnProperty.call(out, key)) {
      throw new Error(`Duplicate key ${key} on line ${i + 1} in .env.deploy`);
    }
    let value = body.slice(eq + 1).trim();
    if (value[0] === '"' || value[0] === "'") {
      // Quoted: must end at the matching closing quote; only whitespace or a " #" comment may follow.
      const q = value.match(/^(["'])(.*?)\1(\s+#.*)?$/);
      if (!q) throw new Error(`Malformed line ${i + 1} in .env.deploy (bad quoting)`);
      value = q[2];
    } else {
      // Unquoted: " #" starts an inline comment (quote the value to keep it).
      value = value.replace(/(^|\s)#.*$/, '').trim();
    }
    out[key] = value;
  });
  return out;
}

function requiredKeys() {
  const set = new Set();
  Object.values(FUNCTION_VARS).forEach((keys) => keys.forEach((k) => set.add(k)));
  return [...set].sort();
}

function missingKeys(env) {
  return requiredKeys().filter((k) => typeof env[k] !== 'string' || env[k] === '');
}

function validate(env) {
  const problems = missingKeys(env).map((k) => `${k} is missing or empty`);
  const has = (k) => typeof env[k] === 'string' && env[k] !== '';
  if (has('WEBHOOK_VERIFY_TOKEN') && env.WEBHOOK_VERIFY_TOKEN.length < 16) {
    problems.push('WEBHOOK_VERIFY_TOKEN must be at least 16 characters');
  }
  if (has('CRON_SECRET') && env.CRON_SECRET.length < 16) problems.push('CRON_SECRET must be at least 16 characters');
  if (has('ADMIN_EMAIL') && !env.ADMIN_EMAIL.includes('@')) problems.push('ADMIN_EMAIL must contain @');
  return problems;
}

function varsFor(fn, env) {
  const vars = {};
  (FUNCTION_VARS[fn] || []).forEach((k) => { vars[k] = env[k]; });
  return vars;
}

function applyToConfig(config, vars) {
  const copy = JSON.parse(JSON.stringify(config));
  copy.deployment = Object.assign({}, copy.deployment, { env_variables: Object.assign({}, vars) });
  return copy;
}

function paths(root, fn) {
  return path.join(root, 'functions', fn, 'catalyst-config.json');
}

function loadEnv(root) {
  const file = path.join(root, '.env.deploy');
  if (!fs.existsSync(file)) {
    throw new Error('.env.deploy not found. Copy .env.deploy.example to .env.deploy and fill in your values.');
  }
  return parseEnvFile(fs.readFileSync(file, 'utf8'));
}

function check(root) {
  const env = loadEnv(root);
  const problems = validate(env);
  if (problems.length) {
    const e = new Error('.env.deploy has problems:\n' + problems.map((p) => '  - ' + p).join('\n'));
    throw e;
  }
  return env;
}

function readConfig(root, fn) {
  try {
    return JSON.parse(fs.readFileSync(paths(root, fn), 'utf8'));
  } catch (e) {
    throw new Error(`functions/${fn}/catalyst-config.json could not be read as JSON`);
  }
}

function apply(root, backupDir) {
  const env = check(root);
  const fns = Object.keys(FUNCTION_VARS);
  // Refuse before writing anything if a previous deploy left injected variables in the tracked files.
  const dirty = fns.filter((fn) => {
    const ev = ((readConfig(root, fn).deployment || {}).env_variables) || {};
    return Object.keys(ev).length > 0;
  });
  if (dirty.length) {
    throw new Error(dirty.map((fn) => `functions/${fn}/catalyst-config.json`).join(', ') +
      ' already contains env_variables. If these are leftovers from an interrupted deploy, run: ' +
      'git checkout -- functions/*/catalyst-config.json . If you have your own uncommitted edits there, ' +
      'commit or stash them first. Then deploy again.');
  }
  fs.mkdirSync(backupDir, { recursive: true });
  // Back up everything first so a mid-way failure can still be fully restored.
  fns.forEach((fn) => {
    fs.copyFileSync(paths(root, fn), path.join(backupDir, fn + '.json'));
    fs.writeFileSync(path.join(backupDir, fn + '.mode'), (fs.statSync(paths(root, fn)).mode & 0o777).toString(8));
  });
  const summary = [];
  fns.forEach((fn) => {
    const vars = varsFor(fn, env);
    const cfg = readConfig(root, fn);
    fs.chmodSync(paths(root, fn), 0o600); // before writing, so the secret never sits in a looser-mode file
    fs.writeFileSync(paths(root, fn), JSON.stringify(applyToConfig(cfg, vars), null, 2) + '\n');
    summary.push({ fn, keys: Object.keys(vars) });
  });
  return summary;
}

function restore(root, backupDir) {
  if (!backupDir || !fs.existsSync(backupDir)) return [];
  const restored = [];
  Object.keys(FUNCTION_VARS).forEach((fn) => {
    const b = path.join(backupDir, fn + '.json');
    if (fs.existsSync(b)) {
      fs.copyFileSync(b, paths(root, fn));
      const m = path.join(backupDir, fn + '.mode');
      if (fs.existsSync(m)) fs.chmodSync(paths(root, fn), parseInt(fs.readFileSync(m, 'utf8'), 8));
      restored.push(fn);
    }
  });
  return restored;
}

module.exports = { parseEnvFile, FUNCTION_VARS, missingKeys, validate, applyToConfig, apply, restore, check };

if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  const [cmd, backupDir] = process.argv.slice(2);
  try {
    if (cmd === 'check') {
      check(root);
      console.log('.env.deploy OK');
    } else if (cmd === 'apply' && backupDir) {
      const summary = apply(root, backupDir);
      console.log('Injected env variables: ' + summary
        .map((s) => `${s.fn} (${s.keys.length}${s.keys.length ? ': ' + s.keys.join(', ') : ''})`).join('; '));
    } else if (cmd === 'restore' && backupDir) {
      const r = restore(root, backupDir);
      console.log(`Restored ${r.length} catalyst-config.json file(s)`);
    } else {
      console.error('Usage: node scripts/deploy-env.js check | apply <backupDir> | restore <backupDir>');
      process.exit(2);
    }
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
