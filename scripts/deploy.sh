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
SYNC_DATA_ON_UPDATE="${SYNC_DATA_ON_UPDATE:-0}"
SYNC_TIMER_CALENDAR="${SYNC_TIMER_CALENDAR:-03:40}"
SRGAOXIAO_TIMER_CALENDAR="${SRGAOXIAO_TIMER_CALENDAR:-04:20}"
SRGAOXIAO_TIMER_REVIEW_MAX_PAGES="${SRGAOXIAO_TIMER_REVIEW_MAX_PAGES:-20}"
SKIP_CJK_FONT_INSTALL="${SKIP_CJK_FONT_INSTALL:-0}"
DEFAULT_DATA_REPO_URL="https://gh.lizmt.cn/CollegesChat/university-information.git"
OLD_DATA_REPO_URL="https://github.com/CollegesChat/university-information.git"
GENERATED_ADMIN_PASSWORD=""

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
COMMAND="${1:-install}"
if [ "$#" -gt 0 ]; then
  shift
fi

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

usage() {
  cat <<EOF
Usage:
  scripts/deploy.sh install      Initial deploy or reinstall. This is the default command.
  scripts/deploy.sh update       Pull latest code, rebuild, and restart the service.
  scripts/deploy.sh restart      Restart the systemd service.
  scripts/deploy.sh status       Show the systemd service status.
  scripts/deploy.sh logs         Follow service logs.
  scripts/deploy.sh sync         Sync CollegesChat data in the deployed app directory.
  scripts/deploy.sh sync-srgaoxiao
                                  Sync cached srgaoxiao school profiles.
  scripts/deploy.sh sync-srgaoxiao-full
                                  Sync all srgaoxiao school profiles once.
  scripts/deploy.sh sync-gaokao-cn [--limit=10 ...]
                                  Sync Gaokao.cn admission plans and score lines.
  scripts/deploy.sh download-xuefeng-agent [--url=...]
                                  Download and cache the Xuefeng Agent SQLite database only.
  scripts/deploy.sh sync-xuefeng-agent [--limit=10000 ...]
                                  Import Xuefeng Agent historical admission score data.
                                  Uses gh.lizmt.cn mirror first by default; override with --url if needed.
  scripts/deploy.sh sync-jiangsu-official [--query=南京大学 ...]
                                  Sync official Jiangsu EEA score lines.
  scripts/deploy.sh sync-jiangsu-official-plans [--query=苏州大学 ...]
                                  Sync official Jiangsu university admission plans.
  scripts/deploy.sh enable-sync-timer
                                  Enable daily CollegesChat data sync timer.
  scripts/deploy.sh disable-sync-timer
                                  Disable the data sync timer.
  scripts/deploy.sh enable-srgaoxiao-timer
                                  Enable daily srgaoxiao profile cache timer.
  scripts/deploy.sh disable-srgaoxiao-timer
                                  Disable the srgaoxiao profile cache timer.
  scripts/deploy.sh help         Show this help.

Common environment variables:
  APP_DIR=/opt/myqqbot           Deploy/update directory. Defaults to current checkout.
  SERVICE_NAME=myqqbot           systemd service name.
  BRANCH=main                    Git branch to deploy.
  REPO_URL=https://...           Required when cloning into a new APP_DIR and origin is unavailable.
  APP_PORT=8787                  Port written to a newly created .env.
  ADMIN_PASSWORD=...             WebUI administrator password. Auto-generated when missing.
  NODE_BIN=/usr/local/bin/node   Node binary used by systemd.
  SKIP_DATA_SYNC=1               Skip data sync during install/update.
  SYNC_DATA_ON_UPDATE=1          Also sync data during update. Default: 0.
  SYNC_TIMER_CALENDAR=03:40      systemd OnCalendar value for data sync.
  SRGAOXIAO_TIMER_CALENDAR=04:20 systemd OnCalendar value for srgaoxiao cache.
  SRGAOXIAO_TIMER_REVIEW_MAX_PAGES=20
                                  Max review pages refreshed per changed school.
  SKIP_CJK_FONT_INSTALL=1        Do not auto-install Noto CJK fonts for image replies.
  SKIP_SYSTEMD=1                 Do not install/restart systemd service.

Examples:
  sudo APP_DIR=/opt/myqqbot scripts/deploy.sh install
  sudo APP_DIR=/opt/myqqbot scripts/deploy.sh update
  sudo scripts/deploy.sh logs
EOF
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

get_env_value() {
  local file="$1"
  local key="$2"
  grep -m 1 "^${key}=" "$file" 2>/dev/null | cut -d= -f2- || true
}

random_secret() {
  node -e "console.log(require('node:crypto').randomBytes(24).toString('base64url'))"
}

resolve_app_dir() {
  if [ -z "$APP_DIR" ]; then
    APP_DIR="$SOURCE_DIR"
  else
    APP_DIR="$(mkdir -p "$(dirname "$APP_DIR")" && cd "$(dirname "$APP_DIR")" && pwd)/$(basename "$APP_DIR")"
  fi
}

pull_existing_checkout() {
  [ -d "$APP_DIR/.git" ] || fail "$APP_DIR is not a git checkout. Run install first or set APP_DIR correctly."

  log "Updating git checkout in $APP_DIR ($BRANCH)"
  git -C "$APP_DIR" fetch origin "$BRANCH"
  git -C "$APP_DIR" checkout "$BRANCH"
  git -C "$APP_DIR" pull --ff-only origin "$BRANCH"
}

prepare_app_dir_for_install() {
  resolve_app_dir

  if [ "$APP_DIR" = "$SOURCE_DIR" ]; then
    log "Using current checkout: $APP_DIR"
    if [ -d "$APP_DIR/.git" ] && [ "${UPDATE_CURRENT_ON_INSTALL:-0}" = "1" ]; then
      pull_existing_checkout
    fi
    return
  fi

  if [ -z "$REPO_URL" ]; then
    REPO_URL="$(git -C "$SOURCE_DIR" config --get remote.origin.url || true)"
  fi
  [ -n "$REPO_URL" ] || fail "REPO_URL is required when APP_DIR points to another directory."

  if [ -d "$APP_DIR/.git" ]; then
    pull_existing_checkout
  elif [ -e "$APP_DIR" ] && [ "$(find "$APP_DIR" -mindepth 1 -maxdepth 1 | wc -l)" -gt 0 ]; then
    fail "$APP_DIR exists and is not an empty git checkout."
  else
    log "Cloning $REPO_URL into $APP_DIR"
    git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
  fi
}

prepare_app_dir_for_update() {
  resolve_app_dir
  pull_existing_checkout
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

ensure_cjk_fonts() {
  if [ "$SKIP_CJK_FONT_INSTALL" = "1" ]; then
    log "Skipping CJK font check"
    return
  fi

  if command -v fc-match >/dev/null 2>&1; then
    local matched_font
    matched_font="$(fc-match 'Noto Sans CJK SC' 2>/dev/null || true)"
    if printf '%s' "$matched_font" | grep -Eiq 'NotoSansCJK|Noto Sans CJK|Source Han Sans|WenQuanYi|Microsoft YaHei|SimHei'; then
      log "CJK font available: $matched_font"
      return
    fi
  fi

  if command -v apt-get >/dev/null 2>&1; then
    log "Installing Noto CJK fonts for image replies"
    run_root env DEBIAN_FRONTEND=noninteractive apt-get update
    run_root env DEBIAN_FRONTEND=noninteractive apt-get install -y fontconfig fonts-noto-cjk
    if command -v fc-cache >/dev/null 2>&1; then
      run_root fc-cache -f >/dev/null 2>&1 || true
    fi
  else
    log "CJK font was not detected. Install Noto Sans CJK or set ONEBOT_REPLY_AS_IMAGE=false if image text renders as squares."
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
    set_env_value .env PUBLIC_BASE_URL "http://127.0.0.1:${APP_PORT}"
  else
    log "Keeping existing .env"
  fi

  if ! grep -q '^PUBLIC_BASE_URL=' .env; then
    log "Adding PUBLIC_BASE_URL to .env"
    set_env_value .env PUBLIC_BASE_URL "http://127.0.0.1:${APP_PORT}"
  fi

  if ! grep -q '^SITE_FILING_NUMBER=' .env; then
    log "Adding SITE_FILING_NUMBER to .env"
    set_env_value .env SITE_FILING_NUMBER ""
  fi

  local admin_password
  admin_password="$(get_env_value .env ADMIN_PASSWORD)"
  if [ -z "$admin_password" ] || [ "$admin_password" = "change-me-now" ]; then
    GENERATED_ADMIN_PASSWORD="$(random_secret)"
    log "Generating ADMIN_PASSWORD for WebUI"
    set_env_value .env ADMIN_PASSWORD "$GENERATED_ADMIN_PASSWORD"
  fi

  local admin_session_secret
  admin_session_secret="$(get_env_value .env ADMIN_SESSION_SECRET)"
  if [ -z "$admin_session_secret" ] || [ "$admin_session_secret" = "change-me-now" ]; then
    log "Generating ADMIN_SESSION_SECRET for WebUI sessions"
    set_env_value .env ADMIN_SESSION_SECRET "$(random_secret)"
  fi

  if ! grep -q '^ADMIN_SESSION_TTL_HOURS=' .env; then
    set_env_value .env ADMIN_SESSION_TTL_HOURS "168"
  fi

  if ! grep -q '^ONEBOT_REPLY_AS_IMAGE=' .env; then
    log "Enabling QQ image replies in .env"
    set_env_value .env ONEBOT_REPLY_AS_IMAGE "true"
  fi

  if ! grep -q '^ONEBOT_REPLY_IMAGE_TITLE=' .env; then
    log "Adding ONEBOT_REPLY_IMAGE_TITLE to .env"
    set_env_value .env ONEBOT_REPLY_IMAGE_TITLE "高校资料助手"
  fi

  if ! grep -q '^ONEBOT_REPLY_IMAGE_BADGE=' .env; then
    log "Adding ONEBOT_REPLY_IMAGE_BADGE to .env"
    set_env_value .env ONEBOT_REPLY_IMAGE_BADGE "AI 生成回复"
  fi

  if grep -q '^LLM_MAX_TOKENS=900$' .env; then
    log "Updating old LLM_MAX_TOKENS default from 900 to 1600"
    set_env_value .env LLM_MAX_TOKENS "1600"
  fi

  if grep -q '^LLM_TIMEOUT_MS=45000$' .env; then
    log "Updating old LLM_TIMEOUT_MS default from 45000 to 120000"
    set_env_value .env LLM_TIMEOUT_MS "120000"
  fi

  if ! grep -q '^DATA_REPO_URL=' .env; then
    log "Adding DATA_REPO_URL mirror to .env"
    set_env_value .env DATA_REPO_URL "$DEFAULT_DATA_REPO_URL"
  elif grep -q "^DATA_REPO_URL=${OLD_DATA_REPO_URL}$" .env; then
    log "Switching DATA_REPO_URL to gh.lizmt.cn mirror"
    set_env_value .env DATA_REPO_URL "$DEFAULT_DATA_REPO_URL"
  fi

  if ! grep -q '^SRGAOXIAO_BASE_URL=' .env; then
    log "Adding SRGAOXIAO_BASE_URL to .env"
    set_env_value .env SRGAOXIAO_BASE_URL "https://srgaoxiao.cn"
  fi

  if ! grep -q '^SRGAOXIAO_DELAY_MS=' .env; then
    log "Adding SRGAOXIAO_DELAY_MS to .env"
    set_env_value .env SRGAOXIAO_DELAY_MS "1200"
  fi

  if ! grep -q '^SRGAOXIAO_REVIEW_MAX_PAGES=' .env; then
    log "Adding SRGAOXIAO_REVIEW_MAX_PAGES to .env"
    set_env_value .env SRGAOXIAO_REVIEW_MAX_PAGES "20"
  fi
}

install_and_build() {
  cd "$APP_DIR"
  log "Installing dependencies"
  npm ci

  if [ "$SKIP_DATA_SYNC" != "1" ]; then
    log "Syncing CollegesChat university data"
    log "First sync may take a few minutes depending on GitHub/network speed"
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

install_dependencies_and_build_only() {
  cd "$APP_DIR"
  log "Installing dependencies"
  npm ci

  log "Building server and WebUI"
  npm run build

  if [ "$PRUNE_DEV_DEPS" = "1" ]; then
    log "Pruning development dependencies"
    npm prune --omit=dev
  fi
}

service_exists() {
  command -v systemctl >/dev/null 2>&1 && systemctl cat "$SERVICE_NAME" >/dev/null 2>&1
}

restart_service() {
  [ "$SKIP_SYSTEMD" != "1" ] || {
    log "Skipping systemd restart"
    return
  }

  need_cmd systemctl
  if service_exists; then
    log "Restarting systemd service: $SERVICE_NAME"
    run_root systemctl restart "$SERVICE_NAME"
  else
    log "Service $SERVICE_NAME does not exist yet; installing it now"
    install_systemd_service
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

install_sync_timer() {
  [ "$SKIP_SYSTEMD" != "1" ] || {
    log "Skipping systemd timer installation"
    return
  }

  need_cmd systemctl
  prepare_runtime_user

  local sync_service="${SERVICE_NAME}-data-sync.service"
  local sync_timer="${SERVICE_NAME}-data-sync.timer"
  local service_tmp
  local timer_tmp
  service_tmp="$(mktemp)"
  timer_tmp="$(mktemp)"

  cat >"$service_tmp" <<EOF
[Unit]
Description=Sync CollegesChat university data for ${SERVICE_NAME}
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=${APP_DIR}
Environment=NODE_ENV=production
EnvironmentFile=${APP_DIR}/.env
ExecStart=/usr/bin/env bash ${APP_DIR}/scripts/deploy.sh sync
User=${RUN_USER}
Group=${RUN_GROUP}
EOF

  cat >"$timer_tmp" <<EOF
[Unit]
Description=Daily CollegesChat university data sync for ${SERVICE_NAME}

[Timer]
OnCalendar=${SYNC_TIMER_CALENDAR}
Persistent=true
RandomizedDelaySec=20m

[Install]
WantedBy=timers.target
EOF

  log "Installing systemd timer: $sync_timer"
  run_root install -m 0644 "$service_tmp" "/etc/systemd/system/${sync_service}"
  run_root install -m 0644 "$timer_tmp" "/etc/systemd/system/${sync_timer}"
  rm -f "$service_tmp" "$timer_tmp"
  run_root systemctl daemon-reload
  run_root systemctl enable --now "$sync_timer"
}

disable_sync_timer() {
  [ "$SKIP_SYSTEMD" != "1" ] || fail "SKIP_SYSTEMD=1 is set."
  need_cmd systemctl
  local sync_service="${SERVICE_NAME}-data-sync.service"
  local sync_timer="${SERVICE_NAME}-data-sync.timer"
  run_root systemctl disable --now "$sync_timer" 2>/dev/null || true
  run_root rm -f "/etc/systemd/system/${sync_timer}" "/etc/systemd/system/${sync_service}"
  run_root systemctl daemon-reload
  log "Disabled sync timer: $sync_timer"
}

install_srgaoxiao_timer() {
  [ "$SKIP_SYSTEMD" != "1" ] || {
    log "Skipping systemd timer installation"
    return
  }

  need_cmd systemctl
  prepare_runtime_user

  local sync_service="${SERVICE_NAME}-srgaoxiao-sync.service"
  local sync_timer="${SERVICE_NAME}-srgaoxiao-sync.timer"
  local service_tmp
  local timer_tmp
  service_tmp="$(mktemp)"
  timer_tmp="$(mktemp)"

  cat >"$service_tmp" <<EOF
[Unit]
Description=Sync srgaoxiao school profile cache for ${SERVICE_NAME}
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=${APP_DIR}
Environment=NODE_ENV=production
Environment=SRGAOXIAO_SYNC_ALL=1
Environment=SRGAOXIAO_REVIEW_MAX_PAGES=${SRGAOXIAO_TIMER_REVIEW_MAX_PAGES}
EnvironmentFile=${APP_DIR}/.env
ExecStart=/usr/bin/env bash ${APP_DIR}/scripts/deploy.sh sync-srgaoxiao
User=${RUN_USER}
Group=${RUN_GROUP}
EOF

  cat >"$timer_tmp" <<EOF
[Unit]
Description=Daily srgaoxiao school profile cache sync for ${SERVICE_NAME}

[Timer]
OnCalendar=${SRGAOXIAO_TIMER_CALENDAR}
Persistent=true
RandomizedDelaySec=30m

[Install]
WantedBy=timers.target
EOF

  log "Installing systemd timer: $sync_timer"
  run_root install -m 0644 "$service_tmp" "/etc/systemd/system/${sync_service}"
  run_root install -m 0644 "$timer_tmp" "/etc/systemd/system/${sync_timer}"
  rm -f "$service_tmp" "$timer_tmp"
  run_root systemctl daemon-reload
  run_root systemctl enable --now "$sync_timer"
}

disable_srgaoxiao_timer() {
  [ "$SKIP_SYSTEMD" != "1" ] || fail "SKIP_SYSTEMD=1 is set."
  need_cmd systemctl
  local sync_service="${SERVICE_NAME}-srgaoxiao-sync.service"
  local sync_timer="${SERVICE_NAME}-srgaoxiao-sync.timer"
  run_root systemctl disable --now "$sync_timer" 2>/dev/null || true
  run_root rm -f "/etc/systemd/system/${sync_timer}" "/etc/systemd/system/${sync_service}"
  run_root systemctl daemon-reload
  log "Disabled srgaoxiao sync timer: $sync_timer"
}

print_install_summary() {
  cat <<EOF

Deploy finished.

Service:
  systemctl status ${SERVICE_NAME}
  journalctl -u ${SERVICE_NAME} -f

WebUI:
  http://<server-ip>:${APP_PORT}

Admin login:
$(if [ -n "$GENERATED_ADMIN_PASSWORD" ]; then
  printf '  password: %s\n' "$GENERATED_ADMIN_PASSWORD"
else
  printf '  password: see ADMIN_PASSWORD in %s/.env\n' "$APP_DIR"
fi)

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

print_update_summary() {
  cat <<EOF

Update finished.

Service:
  systemctl status ${SERVICE_NAME}
  journalctl -u ${SERVICE_NAME} -f

WebUI:
  http://<server-ip>:${APP_PORT}

Admin login:
$(if [ -n "$GENERATED_ADMIN_PASSWORD" ]; then
  printf '  password: %s\n' "$GENERATED_ADMIN_PASSWORD"
else
  printf '  password: see ADMIN_PASSWORD in %s/.env\n' "$APP_DIR"
fi)

EOF
}

install_command() {
  ensure_linux_and_node
  ensure_cjk_fonts
  prepare_app_dir_for_install
  prepare_env
  install_and_build
  install_systemd_service
  print_install_summary
}

update_command() {
  ensure_linux_and_node
  ensure_cjk_fonts
  prepare_app_dir_for_update
  prepare_env
  if [ "$SYNC_DATA_ON_UPDATE" = "1" ]; then
    install_and_build
  else
    log "Skipping data sync during program update. Run scripts/deploy.sh sync to update university data."
    install_dependencies_and_build_only
  fi
  restart_service
  print_update_summary
}

sync_command() {
  ensure_linux_and_node
  resolve_app_dir
  cd "$APP_DIR"
  if [ -f dist/server/scripts/sync-data.js ]; then
    node dist/server/scripts/sync-data.js
  else
    npm run sync:data
  fi
}

sync_srgaoxiao_command() {
  ensure_linux_and_node
  resolve_app_dir
  cd "$APP_DIR"
  if [ -f dist/server/scripts/sync-srgaoxiao.js ]; then
    node dist/server/scripts/sync-srgaoxiao.js
  else
    npm run sync:srgaoxiao
  fi
}

sync_srgaoxiao_full_command() {
  ensure_linux_and_node
  resolve_app_dir
  cd "$APP_DIR"
  export SRGAOXIAO_SYNC_ALL=1
  if [ -f dist/server/scripts/sync-srgaoxiao.js ]; then
    node dist/server/scripts/sync-srgaoxiao.js
  else
    npm run sync:srgaoxiao
  fi
}

sync_gaokao_cn_command() {
  ensure_linux_and_node
  resolve_app_dir
  cd "$APP_DIR"
  if [ -f dist/server/scripts/sync-gaokao-cn.js ]; then
    node dist/server/scripts/sync-gaokao-cn.js "$@"
  else
    npm run sync:gaokao-cn -- "$@"
  fi
}

sync_xuefeng_agent_command() {
  ensure_linux_and_node
  resolve_app_dir
  cd "$APP_DIR"
  if [ -f dist/server/scripts/sync-xuefeng-agent.js ]; then
    node dist/server/scripts/sync-xuefeng-agent.js "$@"
  else
    npm run sync:xuefeng-agent -- "$@"
  fi
}

download_xuefeng_agent_command() {
  ensure_linux_and_node
  resolve_app_dir
  cd "$APP_DIR"
  if [ -f dist/server/scripts/download-xuefeng-agent.js ]; then
    node dist/server/scripts/download-xuefeng-agent.js "$@"
  else
    npm run download:xuefeng-agent -- "$@"
  fi
}

sync_jiangsu_official_command() {
  ensure_linux_and_node
  resolve_app_dir
  cd "$APP_DIR"
  if [ -f dist/server/scripts/sync-jiangsu-official.js ]; then
    node dist/server/scripts/sync-jiangsu-official.js "$@"
  else
    npm run sync:jiangsu-official -- "$@"
  fi
}

sync_jiangsu_official_plans_command() {
  ensure_linux_and_node
  resolve_app_dir
  cd "$APP_DIR"
  if [ -f dist/server/scripts/sync-jiangsu-official-plans.js ]; then
    node dist/server/scripts/sync-jiangsu-official-plans.js "$@"
  else
    npm run sync:jiangsu-official-plans -- "$@"
  fi
}

systemd_command() {
  local action="$1"
  [ "$SKIP_SYSTEMD" != "1" ] || fail "SKIP_SYSTEMD=1 is set."
  need_cmd systemctl
  case "$action" in
    restart)
      run_root systemctl restart "$SERVICE_NAME"
      ;;
    status)
      systemctl status "$SERVICE_NAME"
      ;;
    logs)
      journalctl -u "$SERVICE_NAME" -f
      ;;
  esac
}

main() {
  case "$COMMAND" in
    install|deploy)
      install_command
      ;;
    update)
      update_command
      ;;
    sync)
      sync_command
      ;;
    sync-srgaoxiao)
      sync_srgaoxiao_command
      ;;
    sync-srgaoxiao-full)
      sync_srgaoxiao_full_command
      ;;
    sync-gaokao-cn)
      sync_gaokao_cn_command "$@"
      ;;
    download-xuefeng-agent)
      download_xuefeng_agent_command "$@"
      ;;
    sync-xuefeng-agent)
      sync_xuefeng_agent_command "$@"
      ;;
    sync-jiangsu-official)
      sync_jiangsu_official_command "$@"
      ;;
    sync-jiangsu-official-plans)
      sync_jiangsu_official_plans_command "$@"
      ;;
    restart|status|logs)
      systemd_command "$COMMAND"
      ;;
    enable-sync-timer)
      ensure_linux_and_node
      resolve_app_dir
      prepare_env
      install_sync_timer
      ;;
    disable-sync-timer)
      disable_sync_timer
      ;;
    enable-srgaoxiao-timer)
      ensure_linux_and_node
      resolve_app_dir
      prepare_env
      install_srgaoxiao_timer
      ;;
    disable-srgaoxiao-timer)
      disable_srgaoxiao_timer
      ;;
    help|-h|--help)
      usage
      ;;
    *)
      usage
      fail "Unknown command: $COMMAND"
      ;;
  esac
}

main "$@"
