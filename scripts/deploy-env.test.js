'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const E = require('./deploy-env');

const SECRET = 'SECRET_xyz_987';
const LITERAL = {
  webhook: ['META_APP_SECRET', 'WEBHOOK_VERIFY_TOKEN'],
  admin: ['ADMIN_EMAIL', 'CRON_SECRET'],
};
const good = () => ({
  META_APP_SECRET: SECRET, WEBHOOK_VERIFY_TOKEN: 'verify-' + SECRET, CRON_SECRET: 'cron-' + SECRET, ADMIN_EMAIL: 'me@example.com',
});

test('parseEnvFile handles comments, blanks, quotes and = in values', () => {
  const env = E.parseEnvFile('# c\n\n A = 1 \nB="x y"\nC=\'q\'\nD=a=b==c\nE="  in  ner "\n');
  assert.deepStrictEqual(env, { A: '1', B: 'x y', C: 'q', D: 'a=b==c', E: '  in  ner ' });
});

test('parseEnvFile strips only one pair of quotes', () => {
  assert.strictEqual(E.parseEnvFile('A=""x""').A, '"x"');
});

test('parseEnvFile malformed line error names line number, not content', () => {
  assert.throws(() => E.parseEnvFile('A=1\n\nthis is ' + SECRET + ' junk'), (e) => {
    assert.match(e.message, /line 3/);
    assert.ok(!e.message.includes(SECRET));
    return true;
  });
  assert.throws(() => E.parseEnvFile('=novalue'), /line 1/);
});

test('missingKeys is sorted and treats empty as missing', () => {
  assert.deepStrictEqual(E.missingKeys({}), ['ADMIN_EMAIL', 'CRON_SECRET', 'META_APP_SECRET', 'WEBHOOK_VERIFY_TOKEN']);
  assert.deepStrictEqual(E.missingKeys({ ...good(), CRON_SECRET: '' }), ['CRON_SECRET']);
  assert.deepStrictEqual(E.missingKeys(good()), []);
});

test('validate rules', () => {
  assert.deepStrictEqual(E.validate(good()), []);
  assert.ok(E.validate({ ...good(), WEBHOOK_VERIFY_TOKEN: 'short' }).some((p) => p.includes('WEBHOOK_VERIFY_TOKEN')));
  assert.ok(E.validate({ ...good(), CRON_SECRET: 'short' }).some((p) => p.includes('CRON_SECRET')));
  assert.ok(E.validate({ ...good(), ADMIN_EMAIL: 'nope' }).some((p) => p.includes('ADMIN_EMAIL')));
  assert.ok(E.validate({}).length >= 4);
});

test('validate never leaks values', () => {
  const bad = { META_APP_SECRET: '', WEBHOOK_VERIFY_TOKEN: 'x' + SECRET.slice(0, 5), CRON_SECRET: SECRET.slice(0, 5), ADMIN_EMAIL: SECRET };
  const problems = E.validate(bad);
  assert.ok(problems.length >= 4);
  problems.forEach((p) => assert.ok(!p.includes(SECRET)));
});

test('applyToConfig keeps other fields and does not mutate', () => {
  const cfg = { deployment: { name: 'x', stack: 'node18', env_variables: { OLD: '1' } }, execution: { main: 'index.js' } };
  const snap = JSON.stringify(cfg);
  const out = E.applyToConfig(cfg, { A: 'b' });
  assert.strictEqual(JSON.stringify(cfg), snap);
  assert.deepStrictEqual(out.deployment.env_variables, { A: 'b' });
  assert.strictEqual(out.deployment.name, 'x');
  assert.deepStrictEqual(out.execution, { main: 'index.js' });
});

test('apply/restore end to end on a temp copy', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'denv-'));
  const backup = fs.mkdtempSync(path.join(os.tmpdir(), 'denvb-'));
  const originals = {};
  Object.keys(E.FUNCTION_VARS).forEach((fn, i) => {
    fs.mkdirSync(path.join(root, 'functions', fn), { recursive: true });
    const f = path.join(root, 'functions', fn, 'catalyst-config.json');
    const raw = Buffer.from(`{ "deployment": { "name": "${fn}", "env_variables": {} },\r\n "execution": {"main":"index.js"}}` + '\n'.repeat(i));
    fs.writeFileSync(f, raw);
    originals[fn] = raw;
  });
  fs.writeFileSync(path.join(root, '.env.deploy'), Object.entries(good()).map(([k, v]) => `${k}=${v}`).join('\n'));
  const summary = E.apply(root, backup);
  assert.strictEqual(summary.length, 2);
  Object.keys(E.FUNCTION_VARS).forEach((fn) => {
    const cfg = JSON.parse(fs.readFileSync(path.join(root, 'functions', fn, 'catalyst-config.json'), 'utf8'));
    const expected = {};
    LITERAL[fn].forEach((k) => { expected[k] = good()[k]; });
    assert.deepStrictEqual(cfg.deployment.env_variables, expected);
    assert.strictEqual(cfg.deployment.name, fn);
  });
  const adminCfg = JSON.parse(fs.readFileSync(path.join(root, 'functions/admin/catalyst-config.json'), 'utf8'));
  assert.ok(!('META_APP_SECRET' in adminCfg.deployment.env_variables));
  const hookCfg = JSON.parse(fs.readFileSync(path.join(root, 'functions/webhook/catalyst-config.json'), 'utf8'));
  assert.ok(!('CRON_SECRET' in hookCfg.deployment.env_variables));
  E.restore(root, backup);
  E.restore(root, backup); // idempotent
  Object.keys(originals).forEach((fn) => {
    assert.ok(fs.readFileSync(path.join(root, 'functions', fn, 'catalyst-config.json')).equals(originals[fn]));
  });
  assert.deepStrictEqual(E.restore(root, path.join(backup, 'nothing')), []);
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(backup, { recursive: true, force: true });
});

test('apply fails clearly without .env.deploy and touches nothing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'denv-'));
  assert.throws(() => E.apply(root, path.join(root, 'b')), /\.env\.deploy\.example/);
  assert.ok(!fs.existsSync(path.join(root, 'b')));
  fs.rmSync(root, { recursive: true, force: true });
});

function tempProject(envs) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'denvp-'));
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.copyFileSync(path.join(__dirname, 'deploy-env.js'), path.join(root, 'scripts', 'deploy-env.js'));
  Object.keys(E.FUNCTION_VARS).forEach((fn) => {
    fs.mkdirSync(path.join(root, 'functions', fn), { recursive: true });
    const cfg = { deployment: { name: fn, env_variables: (envs && envs[fn]) || {} } };
    fs.writeFileSync(path.join(root, 'functions', fn, 'catalyst-config.json'), JSON.stringify(cfg, null, 2));
  });
  fs.writeFileSync(path.join(root, '.env.deploy'), Object.entries(good()).map(([k, v]) => `${k}=${v}`).join('\n'));
  return root;
}
const snapshot = (root) => Object.keys(E.FUNCTION_VARS).map((fn) => fs.readFileSync(path.join(root, 'functions', fn, 'catalyst-config.json'), 'utf8'));

test('apply refuses when an original config already has env_variables, touching nothing', () => {
  const root = tempProject({ webhook: { X: SECRET } });
  const backup = path.join(root, 'bk');
  const before = snapshot(root);
  assert.throws(() => E.apply(root, backup), (e) => {
    assert.match(e.message, /functions\/webhook\/catalyst-config\.json/);
    assert.match(e.message, /git checkout -- functions/);
    assert.ok(!e.message.includes(SECRET));
    return true;
  });
  assert.deepStrictEqual(snapshot(root), before);
  assert.ok(!fs.existsSync(backup));
  fs.rmSync(root, { recursive: true, force: true });
});

test('apply works when all originals are empty; unparsable config errors name file only', () => {
  const root = tempProject();
  assert.doesNotThrow(() => E.apply(root, path.join(root, 'bk')));
  fs.writeFileSync(path.join(root, 'functions/admin/catalyst-config.json'), '{ ' + SECRET);
  assert.throws(() => E.apply(root, path.join(root, 'bk2')), (e) => {
    assert.match(e.message, /functions\/admin/);
    assert.ok(!e.message.includes(SECRET));
    return true;
  });
  fs.rmSync(root, { recursive: true, force: true });
});

test('apply writes 0600 and restore returns original mode and bytes', () => {
  const root = tempProject();
  const f = path.join(root, 'functions/webhook/catalyst-config.json');
  fs.chmodSync(f, 0o644);
  const orig = fs.readFileSync(f);
  const backup = path.join(root, 'bk');
  E.apply(root, backup);
  assert.strictEqual(fs.statSync(f).mode & 0o777, 0o600);
  E.restore(root, backup);
  assert.strictEqual(fs.statSync(f).mode & 0o777, 0o644);
  assert.ok(fs.readFileSync(f).equals(orig));
  fs.rmSync(root, { recursive: true, force: true });
});

test('parser: export prefix, inline comments, duplicates', () => {
  const env = E.parseEnvFile('export A=1\nB=val # note\nC=val#notcomment\nD="v # keep" # note\nE=\'x#y\'');
  assert.deepStrictEqual(env, { A: '1', B: 'val', C: 'val#notcomment', D: 'v # keep', E: 'x#y' });
  assert.throws(() => E.parseEnvFile('A=1\nB=2\nA=' + SECRET), (e) => {
    assert.match(e.message, /A/);
    assert.match(e.message, /line 3/);
    assert.ok(!e.message.includes(SECRET));
    return true;
  });
});

test('CLI apply/check/restore never print secret values', () => {
  const { spawnSync } = require('child_process');
  const root = tempProject();
  const backup = path.join(root, 'bk');
  const cli = path.join(root, 'scripts', 'deploy-env.js');
  const before = snapshot(root);
  for (const args of [['check'], ['apply', backup], ['restore', backup]]) {
    const r = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0);
    assert.ok(!(r.stdout + r.stderr).includes(SECRET));
  }
  assert.deepStrictEqual(snapshot(root), before);
  fs.rmSync(root, { recursive: true, force: true });
});

test('parser: blank value with inline comment is empty and reported missing', () => {
  const env = E.parseEnvFile('A= # c\nB=#c\nC="" # c');
  assert.deepStrictEqual(env, { A: '', B: '', C: '' });
  assert.ok(E.missingKeys({ ...good(), CRON_SECRET: E.parseEnvFile('CRON_SECRET= # c').CRON_SECRET }).includes('CRON_SECRET'));
});

test('parser: text after closing quote must be whitespace or comment; unterminated is malformed', () => {
  assert.strictEqual(E.parseEnvFile('B="a" # say "b"').B, 'a');
  for (const bad of ['B="a"b', 'B="a" x', 'B="open']) {
    assert.throws(() => E.parseEnvFile('A=1\n' + bad), (e) => {
      assert.match(e.message, /line 2/);
      assert.ok(!e.message.includes('open') && !e.message.includes(' x'));
      return true;
    });
  }
});

test('parser: " #" in unquoted value is a comment, quoted form round-trips', () => {
  assert.strictEqual(E.parseEnvFile('K=pa #ss').K, 'pa');
  assert.strictEqual(E.parseEnvFile('K="pa #ss"').K, 'pa #ss');
});

test('deploy.sh guard and trap (throwaway git repo, stubbed npm/npx)', { skip: process.platform === 'win32' }, () => {
  const { spawnSync } = require('child_process');
  const root = tempProject();
  const repoRoot = path.resolve(__dirname, '..');
  fs.copyFileSync(path.join(repoRoot, 'deploy.sh'), path.join(root, 'deploy.sh'));
  Object.keys(E.FUNCTION_VARS).forEach((fn) => fs.mkdirSync(path.join(root, 'functions', fn, 'node_modules')));
  fs.chmodSync(path.join(root, 'deploy.sh'), 0o755);
  fs.mkdirSync(path.join(root, 'client/dist/assets'), { recursive: true });
  fs.writeFileSync(path.join(root, 'client/index.html'), 'orig');
  fs.writeFileSync(path.join(root, 'client/dist/index.html'), 'built');
  fs.writeFileSync(path.join(root, 'client/package.json'), '{}');
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  for (const n of ['npm', 'npx']) { fs.writeFileSync(path.join(bin, n), '#!/bin/sh\nexit 0\n'); fs.chmodSync(path.join(bin, n), 0o755); }
  const env = { ...process.env, PATH: bin + path.delimiter + process.env.PATH, DEPLOY_DRY_RUN: '1' };
  const git = (...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: root, encoding: 'utf8' });
  git('init', '-q');
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
  const run = () => spawnSync('bash', ['deploy.sh'], { cwd: root, env, encoding: 'utf8' });
  const before = snapshot(root);

  let r = run();
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.ok(!(r.stdout + r.stderr).includes(SECRET));
  assert.deepStrictEqual(snapshot(root), before);
  assert.strictEqual(fs.readFileSync(path.join(root, 'client/index.html'), 'utf8'), 'orig');

  // Dirty config: guard fails fast, before anything else, and the file is untouched.
  fs.writeFileSync(path.join(root, 'functions/webhook/catalyst-config.json'), '{"deployment":{"env_variables":{"X":"' + SECRET + '"}}}');
  const dirty = snapshot(root);
  r = run();
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stderr, /uncommitted changes/);
  assert.match(r.stderr, /commit or stash/);
  assert.ok(!(r.stdout + r.stderr).includes(SECRET));
  assert.doesNotMatch(r.stdout, /Running tests/);
  assert.deepStrictEqual(snapshot(root), dirty);
  fs.rmSync(root, { recursive: true, force: true });
});
