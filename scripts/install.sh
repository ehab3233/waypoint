#!/usr/bin/env bash
#
# Waypoint — bare-metal installer for Debian/Ubuntu Linux VMs.
#
# Fully hands-off: installs Node.js + PostgreSQL, creates a dedicated system
# user, generates database credentials itself, seeds the dataset, and wires
# the app up as a systemd service.
#
#   curl -fsSL https://raw.githubusercontent.com/ehab3233/waypoint/main/scripts/install.sh | sudo bash
#     — or, from a local clone —
#   sudo ./scripts/install.sh
#
# Re-running is safe: existing credentials and search history are preserved.
#
set -euo pipefail

APP_NAME="waypoint"
APP_USER="waypoint"
APP_DIR="/opt/waypoint"
REPO_URL="${WAYPOINT_REPO:-https://github.com/ehab3233/waypoint.git}"
BRANCH="${WAYPOINT_BRANCH:-main}"
PORT="${WAYPOINT_PORT:-8080}"
NODE_MAJOR=22

log()  { echo -e "\033[1;36m[waypoint]\033[0m $*"; }
die()  { echo -e "\033[1;31m[waypoint] ERROR:\033[0m $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Run as root (sudo ./scripts/install.sh)."
command -v apt-get >/dev/null 2>&1 || die "This installer targets Debian/Ubuntu (apt-get not found)."

export DEBIAN_FRONTEND=noninteractive

log "Installing base packages…"
apt-get update -qq
apt-get install -y -qq ca-certificates curl git gnupg openssl >/dev/null

# --- Node.js -----------------------------------------------------------------
need_node=1
if command -v node >/dev/null 2>&1; then
  have="$(node -v | sed 's/^v//' | cut -d. -f1)"
  [ "$have" -ge 20 ] && need_node=0
fi
if [ "$need_node" -eq 1 ]; then
  log "Installing Node.js ${NODE_MAJOR}.x…"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
log "Node $(node -v), npm $(npm -v)"

# --- PostgreSQL --------------------------------------------------------------
if ! command -v psql >/dev/null 2>&1; then
  log "Installing PostgreSQL…"
  apt-get install -y -qq postgresql >/dev/null
fi
systemctl enable --now postgresql >/dev/null 2>&1 || true
# Wait for the server to accept connections
for i in $(seq 1 30); do
  sudo -u postgres psql -tAc 'SELECT 1' >/dev/null 2>&1 && break
  sleep 1
  [ "$i" -eq 30 ] && die "PostgreSQL did not come up."
done
log "PostgreSQL is running."

# --- System user -------------------------------------------------------------
if ! id -u "$APP_USER" >/dev/null 2>&1; then
  log "Creating system user '${APP_USER}'…"
  useradd --system --create-home --home-dir "/var/lib/${APP_NAME}" --shell /usr/sbin/nologin "$APP_USER"
fi

# --- Code --------------------------------------------------------------------
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." 2>/dev/null && pwd || true)"
if [ -d "${APP_DIR}/.git" ]; then
  log "Existing install found — updating code from git…"
  git -C "$APP_DIR" fetch origin "$BRANCH" --quiet
  git -C "$APP_DIR" checkout -q "$BRANCH" 2>/dev/null || git -C "$APP_DIR" checkout -qb "$BRANCH" "origin/${BRANCH}"
  git -C "$APP_DIR" reset --hard "origin/${BRANCH}" --quiet
elif [ -n "$SRC_DIR" ] && [ -d "${SRC_DIR}/.git" ] && [ "$SRC_DIR" != "$APP_DIR" ]; then
  log "Installing from local clone at ${SRC_DIR}…"
  git clone --quiet "$SRC_DIR" "$APP_DIR"
  origin="$(git -C "$SRC_DIR" remote get-url origin 2>/dev/null || echo "$REPO_URL")"
  git -C "$APP_DIR" remote set-url origin "$origin"
else
  log "Cloning ${REPO_URL} (${BRANCH})…"
  git clone --quiet --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi
git config --system --add safe.directory "$APP_DIR" >/dev/null 2>&1 || true
chown -R "${APP_USER}:${APP_USER}" "$APP_DIR"

# --- Database: role + db with self-generated credentials ---------------------
DB_NAME="waypoint"
DB_USER="waypoint"
ENV_FILE="${APP_DIR}/.env"

if [ -f "$ENV_FILE" ] && grep -q '^DATABASE_URL=' "$ENV_FILE"; then
  log "Keeping existing database credentials from .env"
  DB_PASS="$(grep '^DATABASE_URL=' "$ENV_FILE" | sed -E 's|.*://[^:]+:([^@]+)@.*|\1|')"
else
  DB_PASS="$(openssl rand -hex 24)"
  log "Generated fresh database credentials."
fi

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1; then
  sudo -u postgres psql -qc "CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASS}'"
else
  sudo -u postgres psql -qc "ALTER ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASS}'"
fi
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
  sudo -u postgres createdb -O "$DB_USER" "$DB_NAME"
fi
log "Database '${DB_NAME}' ready."

umask 077
cat > "$ENV_FILE" <<EOF
DATABASE_URL=postgres://${DB_USER}:${DB_PASS}@127.0.0.1:5432/${DB_NAME}
PORT=${PORT}
NODE_ENV=production
EOF
chown "${APP_USER}:${APP_USER}" "$ENV_FILE"
chmod 600 "$ENV_FILE"

# --- App dependencies + seed -------------------------------------------------
log "Installing app dependencies…"
sudo -u "$APP_USER" bash -c "cd '$APP_DIR' && npm ci --omit=dev --no-audit --no-fund --silent"

log "Seeding database with the transport dataset…"
sudo -u "$APP_USER" bash -c "cd '$APP_DIR' && set -a && . ./.env && node server/seed.js"

# --- systemd -----------------------------------------------------------------
log "Installing systemd service…"
cat > "/etc/systemd/system/${APP_NAME}.service" <<EOF
[Unit]
Description=Waypoint multi-city trip optimizer
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${APP_DIR}/.env
ExecStart=$(command -v node) server/index.js
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=full
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now "$APP_NAME" >/dev/null

# --- Health check ------------------------------------------------------------
log "Waiting for the app to come up…"
ok=0
for i in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then ok=1; break; fi
  sleep 1
done
[ "$ok" -eq 1 ] || { journalctl -u "$APP_NAME" -n 30 --no-pager || true; die "Service failed its health check."; }

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo
log "✅ Waypoint is installed and running."
log "   URL:      http://${IP:-<this-vm>}:${PORT}"
log "   Service:  systemctl status ${APP_NAME}"
log "   Logs:     journalctl -u ${APP_NAME} -f"
log "   Updates:  sudo ${APP_DIR}/scripts/update.sh"
