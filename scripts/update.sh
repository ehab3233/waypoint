#!/usr/bin/env bash
#
# Waypoint — update an existing install from git.
#
#   sudo /opt/waypoint/scripts/update.sh
#
# Pulls the latest code for the branch the install tracks, reinstalls
# dependencies, re-seeds the dataset (idempotent — search history is kept),
# and restarts the service. Credentials in .env are untouched.
#
set -euo pipefail

# This script rewrites itself during the git reset below, and bash reads a
# script incrementally as it runs — so a changed file can leave the running
# shell reading from the wrong byte offset. Re-run from a private copy first.
if [ "${WAYPOINT_UPDATE_REEXEC:-}" != "1" ]; then
  _self_copy="$(mktemp /tmp/waypoint-update.XXXXXX)"
  cat "$0" > "$_self_copy"
  chmod +x "$_self_copy"
  WAYPOINT_UPDATE_REEXEC=1 bash "$_self_copy" "$@"
  _rc=$?
  rm -f "$_self_copy"
  exit "$_rc"
fi

APP_NAME="waypoint"
APP_USER="waypoint"
APP_DIR="/opt/waypoint"

log() { echo -e "\033[1;36m[waypoint]\033[0m $*"; }
die() { echo -e "\033[1;31m[waypoint] ERROR:\033[0m $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Run as root (sudo $0)."
[ -d "${APP_DIR}/.git" ] || die "No install found at ${APP_DIR}. Run scripts/install.sh first."

cd "$APP_DIR"
BRANCH="$(sudo -u "$APP_USER" git rev-parse --abbrev-ref HEAD)"
OLD_REV="$(sudo -u "$APP_USER" git rev-parse --short HEAD)"

log "Fetching origin/${BRANCH}…"
tries=0
until sudo -u "$APP_USER" git fetch origin "$BRANCH" --quiet; do
  tries=$((tries + 1))
  [ "$tries" -ge 5 ] && die "git fetch failed after 5 attempts."
  wait=$((2 ** tries))
  log "Fetch failed, retrying in ${wait}s…"
  sleep "$wait"
done

NEW_REV="$(sudo -u "$APP_USER" git rev-parse --short "origin/${BRANCH}")"
if [ "$OLD_REV" = "$NEW_REV" ]; then
  log "Already up to date (${OLD_REV})."
  exit 0
fi

log "Updating ${OLD_REV} → ${NEW_REV}…"
# Appliance-style update: the deploy tree mirrors git exactly. .env is
# untracked and therefore survives.
sudo -u "$APP_USER" git reset --hard "origin/${BRANCH}" --quiet

NODE_BIN="$(command -v node)"
NPM_BIN="$(command -v npm)"
[ -x "$NODE_BIN" ] && [ -x "$NPM_BIN" ] || die "node/npm not found on PATH."

as_app() { sudo -u "$APP_USER" -H bash -c "$1"; }

deps_ok() {
  as_app "cd '$APP_DIR' && '$NODE_BIN' -e \"require('express');require('pg')\"" >/dev/null 2>&1
}

# npm can exit 0 with an unusable tree, so verify rather than trust it.
for attempt in 1 2 3; do
  log "Installing dependencies (attempt ${attempt})…"
  as_app "cd '$APP_DIR' && '$NPM_BIN' ci --omit=dev --no-audit --no-fund" || true
  deps_ok && break
  log "Dependency tree is incomplete — clearing node_modules and retrying."
  rm -rf "${APP_DIR}/node_modules"
  [ "$attempt" -eq 3 ] && die "Could not install Node dependencies. The old build is still running; nothing was restarted."
done
log "Dependencies verified."

log "Re-seeding dataset…"
as_app "cd '$APP_DIR' && set -a && . ./.env && set +a && '$NODE_BIN' server/seed.js"

log "Restarting service…"
systemctl restart "$APP_NAME"

PORT="$(grep '^PORT=' "$APP_DIR/.env" | cut -d= -f2 || echo 8080)"
ok=0
for i in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then ok=1; break; fi
  sleep 1
done
[ "$ok" -eq 1 ] || { journalctl -u "$APP_NAME" -n 30 --no-pager || true; die "Service failed its health check after update."; }

log "✅ Updated to ${NEW_REV} and healthy."
sudo -u "$APP_USER" git log --oneline "${OLD_REV}..${NEW_REV}" | sed 's/^/[waypoint]   /'
