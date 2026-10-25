#!/bin/bash
# DMBot deploy: run tests, copy shared modules, build client, deploy to Catalyst.
# Catalyst's react client deploy wants a flat client root (built files, no source), so we
# temporarily rearrange client/ and ALWAYS restore it on exit. DEPLOY_DRY_RUN=1 skips `catalyst deploy`.
set -e
cd "$(dirname "$0")"
ROOT="$PWD"

# Fail fast (before tests/build/client changes) if .env.deploy is missing or invalid.
node scripts/deploy-env.js check

# A previous interrupted deploy may have left injected secrets in tracked config files.
if git rev-parse --is-inside-work-tree >/dev/null 2>&1 \
   && ! git diff --quiet -- functions/*/catalyst-config.json; then
  echo "functions/*/catalyst-config.json have uncommitted changes." >&2
  echo "If they are leftovers from an interrupted deploy (they contain env_variables), run: git checkout -- functions/*/catalyst-config.json" >&2
  echo "If they are NOT leftovers, commit or stash your edits first, then deploy again." >&2
  exit 1
fi

for fn in webhook admin; do
  if [ ! -d "functions/$fn/node_modules" ]; then
    echo "functions/$fn/node_modules is missing. Run: (cd functions/$fn && npm install --registry https://registry.npmjs.org)" >&2
    exit 1
  fi
done

echo "=== Running tests ==="
npm test
(cd client && npx vitest run)

echo "=== Syncing shared modules into functions ==="
npm run sync-shared

echo "=== Building client ==="
(cd client && npx vite build)

BACKUP="$(mktemp -d)"
ENV_BACKUP="$(mktemp -d)"
MOVED="node_modules src vite.config.js package.json package-lock.json .npmrc"
PREPARED=0

restore() {
  rc=$?
  set +e
  trap '' INT TERM
  # Always restore functions/*/catalyst-config.json first (removes injected secrets from tracked files).
  if (cd "$ROOT" && node scripts/deploy-env.js restore "$ENV_BACKUP"); then
    rm -rf "$ENV_BACKUP"
  else
    echo "RESTORE FAILED - secrets may remain in functions/*/catalyst-config.json. Run: git checkout -- functions/*/catalyst-config.json . Backup kept at: $ENV_BACKUP" >&2
  fi
  cd "$ROOT/client" || exit $rc
  if [ "$PREPARED" = 1 ]; then
    rm -rf assets index.html
    [ -f "$BACKUP/index.html" ] && cp -p "$BACKUP/index.html" index.html
    for f in $MOVED; do
      [ -e "$BACKUP/$f" ] && mv "$BACKUP/$f" "$f"
    done
  fi
  rm -rf "$BACKUP"
  echo "=== client/ restored ==="
  exit $rc
}
trap restore EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

echo "=== Preparing client for deploy ==="
cd "$ROOT/client"
PREPARED=1
cp -p index.html "$BACKUP/index.html"
for f in $MOVED; do
  [ -e "$f" ] && mv "$f" "$BACKUP/$f"
done
cp dist/index.html ./index.html
cp -r dist/assets ./assets

echo "=== Injecting function environment variables from .env.deploy ==="
cd "$ROOT"
node scripts/deploy-env.js apply "$ENV_BACKUP"

echo "=== Deploying ==="
if [ "${DEPLOY_DRY_RUN:-}" = 1 ]; then
  echo "DEPLOY_DRY_RUN=1: skipping catalyst deploy. client/ now contains:"
  ls -A client
else
  # Login shells on macOS may not have ~/.npm-global/bin (where npm -g put the CLI) on PATH.
  CATALYST_BIN="$(command -v catalyst || true)"
  [ -z "$CATALYST_BIN" ] && [ -x "$HOME/.npm-global/bin/catalyst" ] && CATALYST_BIN="$HOME/.npm-global/bin/catalyst"
  if [ -z "$CATALYST_BIN" ]; then
    echo "Catalyst CLI not found. Install it: npm install -g zcatalyst-cli --registry https://registry.npmjs.org" >&2
    exit 1
  fi
  "$CATALYST_BIN" deploy
fi
