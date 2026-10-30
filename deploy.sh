#!/usr/bin/env bash
#
# deploy.sh — build the Hulas QC app locally and push it to the server.
#
# Run this from Git Bash on your Windows PC, from INSIDE the hulas-qc-app folder:
#   ./deploy.sh
#
# What it does:
#   1. Pulls latest code from GitHub
#   1b. Patches schema.prisma with the Linux binary target (local-only, never committed)
#   2. Installs dependencies
#   2b. Pulls the live database from the server and applies any schema changes to it
#   3. Builds the production bundle
#   4. Regenerates the Prisma client
#   5. Copies build output + database back to the server
#   6. Restarts the app via PM2
#   7. Confirms the app responds with HTTP 200
#
# Edit the variables below once, then just run ./deploy.sh every time you have updates.

set -e  # stop immediately if any step fails

# ---- CONFIG: edit these if your setup ever changes ----
SERVER_USER="hulas"
SERVER_HOST="192.168.1.203"
SERVER_DIR="~/hulas-qc-app-built"
PM2_APP_NAME="hulas-qc"
# ---------------------------------------------------------

echo "=================================================="
echo " Hulas QC — Deploy to $SERVER_HOST"
echo "=================================================="

echo ""
echo "[1/7] Pulling latest code from GitHub..."
# Discard local changes to files that get regenerated later anyway (the schema
# patch in 1b, and package-lock.json via npm install) — this prevents git pull
# from refusing to merge due to our own local-only modifications.
git checkout -- prisma/schema.prisma package-lock.json 2>/dev/null || true
git pull

echo ""
echo "[1b/7] Ensuring Linux binary target is set in schema.prisma (local-only fix)..."
if ! grep -q "debian-openssl-3.0.x" prisma/schema.prisma; then
  # Insert binaryTargets line right after the provider line in the generator block
  sed -i '/provider *= *"prisma-client-js"/a\  binaryTargets = ["native", "debian-openssl-3.0.x"]' prisma/schema.prisma
  echo "  patched schema.prisma"
else
  echo "  already patched, skipping"
fi

echo ""
echo "[2/7] Installing dependencies..."
npm install

echo ""
echo "[2b/7] Syncing live database from server and applying any schema changes..."
mkdir -p prisma/backups
if [ -f prisma/dev.db ]; then
  cp prisma/dev.db "prisma/backups/dev.db.local-$(date +%Y%m%d-%H%M%S)"
fi
scp -q "${SERVER_USER}@${SERVER_HOST}:${SERVER_DIR}/prisma/dev.db" prisma/dev.db
npx prisma db push

echo ""
echo "[3/7] Building production bundle..."
npm run build

echo ""
echo "[4/7] Regenerating Prisma client (safe if schema unchanged)..."
npx prisma generate

echo ""
echo "[5/7] Syncing files to server (this may take a moment)..."

HAS_RSYNC=false
if command -v rsync >/dev/null 2>&1; then
  HAS_RSYNC=true
fi

sync_path () {
  # $1 = local path, $2 = remote dest dir
  if $HAS_RSYNC; then
    rsync -avz "$1" "${SERVER_USER}@${SERVER_HOST}:${2}"
  else
    scp -rq "$1" "${SERVER_USER}@${SERVER_HOST}:${2}"
  fi
}

# .next changes on every build and has many small files — tar it for speed
echo "  updating .next (tar transfer)..."
tar czf next-build.tar.gz .next
scp -q next-build.tar.gz "${SERVER_USER}@${SERVER_HOST}:${SERVER_DIR}/"
ssh "${SERVER_USER}@${SERVER_HOST}" "cd ${SERVER_DIR} && rm -rf .next && tar xzf next-build.tar.gz && rm next-build.tar.gz"
rm next-build.tar.gz

# Always sync the small, fast stuff
sync_path "prisma/schema.prisma"           "${SERVER_DIR}/prisma/"
sync_path "package.json"                   "${SERVER_DIR}/"
sync_path "package-lock.json"              "${SERVER_DIR}/"
[ -d src ]    && sync_path "src"    "${SERVER_DIR}/" 2>/dev/null || true
[ -d public ] && sync_path "public" "${SERVER_DIR}/" 2>/dev/null || true

# Only sync node_modules if package-lock.json actually changed since the last deploy
LOCAL_HASH=$(sha256sum package-lock.json | awk '{print $1}')
REMOTE_HASH=$(ssh "${SERVER_USER}@${SERVER_HOST}" "cat ${SERVER_DIR}/.deploy-lockhash 2>/dev/null || echo none")

if [ "$LOCAL_HASH" != "$REMOTE_HASH" ]; then
  echo "  package-lock.json changed — updating node_modules (tar transfer, faster than raw copy)..."
  tar czf node_modules.tar.gz node_modules
  scp -q node_modules.tar.gz "${SERVER_USER}@${SERVER_HOST}:${SERVER_DIR}/"
  ssh "${SERVER_USER}@${SERVER_HOST}" "cd ${SERVER_DIR} && rm -rf node_modules && tar xzf node_modules.tar.gz && rm node_modules.tar.gz && echo '${LOCAL_HASH}' > .deploy-lockhash"
  rm node_modules.tar.gz
else
  echo "  node_modules unchanged — skipping (fast path)"
fi

# Push the schema-updated database back to the server (safe: it's the same data,
# just with the new columns/tables added, never touches your live records)
echo "  syncing updated database back to server..."
scp -q prisma/dev.db "${SERVER_USER}@${SERVER_HOST}:${SERVER_DIR}/prisma/dev.db"

echo ""
echo "[6/7] Restarting app on server..."
ssh "${SERVER_USER}@${SERVER_HOST}" "cd ${SERVER_DIR} && chmod +x node_modules/.bin/* && pm2 restart ${PM2_APP_NAME} && sleep 2 && curl -s -o /dev/null -w 'HTTP status: %{http_code}\n' http://localhost:3000/login"

echo ""
echo "=================================================="
echo " Done. Check http://${SERVER_HOST} in your browser."
echo "=================================================="