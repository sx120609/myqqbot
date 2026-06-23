#!/usr/bin/env bash
set -Eeuo pipefail

SERVICE_NAME="${SERVICE_NAME:-myqqbot}"
APP_DIR="${APP_DIR:-}"
BRANCH="${BRANCH:-main}"
REPO_URL="${REPO_URL:-}"
RUN_USER="${RUN_USER:-}"
RUN_GROUP="${RUN_GROUP:-}"
APP_PORT="${APP_PORT:-8787}"
SKIP_DATA_SYNC="${SKIP_DATA_SYNC:-0}"
SKIP_SYSTEMD="${SKIP_SYSTEMD:-0}"
PRUNE_DEV_DEPS="${PRUNE_DEV_DEPS:-1}"
NODE_BIN="${NODE_BIN:-}"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

log() {
  printf '\033[1;34m[deploy]\033[0m %s\n' "$*"
}

fail() {
  printf '\033[1;31m[deploy]\033[0m %s\n' "$*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

run_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  else
    fail "This step needs root privileges. Re-run with sudo or set SKIP_SYSTEMD=1."
  fi
}

set_env_value() {
  local file="$1"
  local key="$2"
  local value="$3"
  if grep -q "^${key}=" "$file"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >>"$file"
  fi
}

prepare_app_dir() {
  if [ -z "$APP_DIR" ]; then
    APP_DIR="$SOURCE_DIR"
    log "Using current checkout: $APP_DIR"
    return
  fi

  APP_DIR="$(mkdir -p "$(dirname "$APP_DIR")" && cd "$(dirname "$APP_DIR")" && pwd)/$(basename "$APP_DIR")"

  if [ "$APP_DIR" = "$SOURCE_DIR" ]; then
    log "Using current checkout: $APP_DIR"
    return
  fi

  if [ -z "$REPO_URL" ]; then
    REPO_URL="$(git -C "$SOURCE_DIR" config --get remote.origin.url || true)"
  fi
  [ -n "$REPO_URL" ] || fail "REPO_URL is required when APP_DIR points to another directory."

  if [ -d "$APP_DIR/.git" ]; then
    log "Updating $APP_DIR from $REPO_URL ($BRANCH)"
    git -C "$APP_DIR" fetch origin "$BRANCH"
    git -C "$APP_DIR" checkout "$BRANCH"
    git -C "$APP_DIR" pull --ff-only origin "$BRANCH"
  elif [ -e "$APP_DIR" ] && [ "$(find "$APP_DIR" -mindepth 1 -maxdepth 1 | wc -l)" -gt 0 ]; then
    fail "$APP_DIR exists and is not an empty git checkout."
  else
    log "Cloning $REPO_URL into $APP_DIR"
    git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
  fi
}

ensure_linux_and_node() {
  [ "$(uname -s)" = "Linux" ] || fail "This deploy script is intended for Linux."
  need_cmd git
  need_cmd node
  need_cmd npm

  local node_major
  node_major="$(node -p "Number(process.versions.node.split('.')[0])")"
  if [ "$node_major" -lt 24 ]; then
    fail "Node.js 24+ is required because this project uses node:sqlite. Current: $(node --version)"
  fi
}

prepare_runtime_user() {
  if [ -z "$RUN_USER" ]; then
    if [ "$(id -u)" -eq 0 ]; then
      RUN_USER="myqqbot"
    else
      RUN_USER="$(id -un)"
    fi
  fi

  if [ -z "$RUN_GROUP" ]; then
    RUN_GROUP="$RUN_USER"
  fi

  if [ "$(id -u)" -eq 0 ] && ! id "$RUN_USER" >/dev/null 2>&1; then
    local nologin_shell
    nologin_shell="/usr/sbin/nologin"
    [ -x "$nologin_shell" ] || nologin_shell="/sbin/nologin"

    if ! getent group "$RUN_GROUP" >/dev/null 2>&1; then
      log "Creating system group: $RUN_GROUP"
      groupadd --system "$RUN_GROUP"
    fi

    log "Creating system user: $RUN_USER"
    useradd --system --gid "$RUN_GROUP" --home-dir "$APP_DIR" --shell "$nologin_shell" "$RUN_USER"
  fi
}

prepare_env() {
  cd "$APP_DIR"
  if [ ! -f .env ]; then
    log "Creating .env from .env.example"
    cp .env.example .env
    set_env_value .env APP_HOST "0.0.0.0"
    set_env_value .env APP_PORT "$APP_PORT"
  else
    log "Keeping existing .env"
  fi
}

install_and_build() {
  cd "$APP_DIR"
  log "Installing dependencies"
  npm ci

  if [ "$SKIP_DATA_SYNC" != "1" ]; then
    log "Syncing CollegesChat university data"
    npm run sync:data
  else
    log "Skipping data sync"
  fi

  log "Building server and WebUI"
  npm run build

  if [ "$PRUNE_DEV_DEPS" = "1" ]; then
    log "Pruning development dependencies"
    npm prune --omit=dev
  fi
}

install_systemd_service() {
  [ "$SKIP_SYSTEMD" != "1" ] || {
    log "Skipping systemd service installation"
    return
  }

  need_cmd systemctl
  prepare_runtime_user

  local node_path
  node_path="${NODE_BIN:-$(command -v node)}"
  local service_file="/etc/systemd/system/${SERVICE_NAME}.service"
  local tmp_file
  tmp_file="$(mktemp)"

  cat >"$tmp_file" <<EOF
[Unit]
Description=MyQQBot NapCat university information assistant
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${APP_DIR}
Environment=NODE_ENV=production
EnvironmentFile=${APP_DIR}/.env
ExecStart=${node_path} dist/server/main.js
Restart=always
RestartSec=5
User=${RUN_USER}
Group=${RUN_GROUP}

[Install]
WantedBy=multi-user.target
EOF

  log "Installing systemd service: $SERVICE_NAME"
  run_root install -m 0644 "$tmp_file" "$service_file"
  rm -f "$tmp_file"

  if [ "$(id -u)" -eq 0 ]; then
    chown -R "$RUN_USER:$RUN_GROUP" "$APP_DIR"
  elif command -v sudo >/dev/null 2>&1; then
    sudo chown -R "$RUN_USER:$RUN_GROUP" "$APP_DIR"
  fi

  run_root systemctl daemon-reload
  run_root systemctl enable "$SERVICE_NAME"
  run_root systemctl restart "$SERVICE_NAME"
}

print_summary() {
  cat <<EOF

Deploy finished.

Service:
  systemctl status ${SERVICE_NAME}
  journalctl -u ${SERVICE_NAME} -f

WebUI:
  http://<server-ip>:${APP_PORT}

NapCat reverse WebSocket:
  ws://<server-ip>:${APP_PORT}/onebot/v11/ws

Before production use, edit:
  ${APP_DIR}/.env

Set your sub2api values:
  LLM_BASE_URL=https://your-sub2api.example.com/v1
  LLM_API_KEY=sk-xxxx
  LLM_MODEL=gpt-5.5

EOF
}

main() {
  ensure_linux_and_node
  prepare_app_dir
  prepare_env
  install_and_build
  install_systemd_service
  print_summary
}

main "$@"
