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

log "Installing dependencies…"
sudo -u "$APP_USER" bash -c "cd '$APP_DIR' && npm ci --omit=dev --no-audit --no-fund --silent"

log "Re-seeding dataset…"
sudo -u "$APP_USER" bash -c "cd '$APP_DIR' && set -a && . ./.env && node server/seed.js"

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
