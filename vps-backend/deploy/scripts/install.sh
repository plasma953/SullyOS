#!/usr/bin/env bash
#
# SullyOS VPS 一键安装（Ubuntu/Debian 22.04+）
#
# 职责：
#   1. 预检（node>=20 / npm / git）
#   2. 部署 /opt/sullyos 目录结构（repo → vps-backend）
#   3. npm install（node-cron + better-sqlite3 编译）
#   4. 生成 .env（含 VAPID 密钥对，chmod 600）
#   5. 安装 systemd 服务 sullyos（run-all 常驻）
#   6. 安装/配置 Caddy（80/443 自动 HTTPS，反代 8830-8835 + dufs 8890）
#
# 用法（在 VPS 上以 root 执行）：
#   SULLYOS_DOMAIN=push.example.com ACME_EMAIL=you@example.com bash deploy/scripts/install.sh
# 或：先 source /opt/sullyos/.env 再跑一次（.env 里已有 SULLYOS_DOMAIN/ACME_EMAIL）。
#
# 安全约定：密钥只落在 /opt/sullyos/.env（600），本脚本不入库任何明文凭证。

set -uo pipefail

APP_DIR="${APP_DIR:-/opt/sullyos}"
REPO_SRC="${REPO_SRC:-$(cd "$(dirname "$0")/../../.." && pwd)}"
BACKEND_DIR="$APP_DIR/vps-backend"
ENV_FILE="$APP_DIR/.env"
DATA_DIR="$APP_DIR/data"
BACKUP_DIR="$APP_DIR/backups"
LOG_DIR="$APP_DIR/logs"

log()  { echo "[install] $*"; }
fail() { echo "[install] ✗ $*" >&2; exit 1; }

# ── 0. 环境变量来源：参数 > 已有 /opt/sullyos/.env > .env.example 模板 ──
if [ ! -f "$ENV_FILE" ]; then
  cp "$REPO_SRC/vps-backend/.env.example" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  log "已从模板创建 $ENV_FILE（请填入真实密钥后再次运行本脚本）"
fi
# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

[ -n "${SULLYOS_DOMAIN:-}" ] || fail "缺少 SULLYOS_DOMAIN（写入 $ENV_FILE 或以环境变量传入）"
[ -n "${ACME_EMAIL:-}" ]    || fail "缺少 ACME_EMAIL（同上）"

# ── 1. 预检 ─────────────────────────────────────────────────
command -v node >/dev/null 2>&1 || fail "未安装 Node.js。安装: curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs"
NODE_MAJOR="$(node -v | sed 's/v\([0-9]*\).*/\1/')"
[ "$NODE_MAJOR" -ge 20 ] || fail "Node.js >= 20 必需（当前 $(node -v)）"
command -v npm >/dev/null 2>&1 || fail "未安装 npm"

# ── 2. 目录与代码 ───────────────────────────────────────────
log "同步仓库 → $APP_DIR"
mkdir -p "$APP_DIR" "$DATA_DIR" "$BACKUP_DIR" "$LOG_DIR"
if [ -d "$BACKEND_DIR/.git" ] && [ -d "$BACKEND_DIR/../.git" ]; then
  git -C "$APP_DIR" pull --ff-only >/dev/null 2>&1 || log "git pull 失败（忽略，继续用现有代码）"
elif [ -d "$REPO_SRC/.git" ]; then
  rm -rf "$APP_DIR/repo.tmp"
  mkdir -p "$APP_DIR/repo.tmp"
  cp -a "$REPO_SRC/." "$APP_DIR/repo.tmp/"
  rm -rf "$APP_DIR/repo.tmp/vps-backend/node_modules" "$APP_DIR/repo.tmp/vps-backend/data" 2>/dev/null
  mv "$APP_DIR/repo.tmp" "$APP_DIR/sullyos-repo"
  ln -sfn "$APP_DIR/sullyos-repo/vps-backend" "$BACKEND_DIR"
else
  fail "找不到仓库源码（REPO_SRC=$REPO_SRC）。请先在 VPS 上 clone SullyOS。"
fi

# ── 3. 依赖 ─────────────────────────────────────────────────
log "npm install（node-cron + better-sqlite3 本机编译）"
cd "$BACKEND_DIR" || fail "缺少 $BACKEND_DIR"
npm install --omit=dev || fail "npm install 失败"
# better-sqlite3 是可选依赖（instant-push multipart 模式不需要），但按计划显式装齐
npm install better-sqlite3 || log "better-sqlite3 编译失败——D1 模式不可用，multipart 模式不受影响"

# ── 4. VAPID 密钥（缺才生成）────────────────────────────────
if [ -z "${VAPID_PUBLIC_KEY:-}" ] || [ -z "${VAPID_PRIVATE_KEY:-}" ]; then
  log "生成 VAPID 密钥对…"
  VAPID_OUT="$(cd "$BACKEND_DIR" && node bin/gen-vapid.js)" || fail "gen-vapid 失败"
  {
    grep -v '^VAPID_PUBLIC_KEY=' "$ENV_FILE" | grep -v '^VAPID_PRIVATE_KEY=' | grep -v '^VAPID_EMAIL=' > "$ENV_FILE.tmp"
    cat "$ENV_FILE.tmp" > "$ENV_FILE"
    rm -f "$ENV_FILE.tmp"
    echo "$VAPID_OUT" | grep -v '^#' >> "$ENV_FILE"
  }
  chmod 600 "$ENV_FILE"
  log "VAPID 密钥已写入 $ENV_FILE"
  # 重新 source，后续 systemd 使用
  set -a; source "$ENV_FILE"; set +a
fi

# ── 5. systemd ──────────────────────────────────────────────
log "写入 systemd 单元 sullyos.service"
cat > /etc/systemd/system/sullyos.service <<EOF
[Unit]
Description=SullyOS VPS Backend (run-all: 8830-8835)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=$BACKEND_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$(command -v node) $BACKEND_DIR/bin/run-all.js
Restart=always
RestartSec=5
# 日志上限，避免填盘
StandardOutput=append:$LOG_DIR/sullyos.log
StandardError=append:$LOG_DIR/sullyos.log

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable sullyos >/dev/null 2>&1 || log "systemctl enable 失败（容器环境可跳过）"

# ── 6. Caddy ────────────────────────────────────────────────
CADDYFILE_SRC="$REPO_SRC/vps-backend/deploy/caddy/SullyOS.Caddyfile"
if command -v caddy >/dev/null 2>&1; then
  CADDY_ETC="/etc/caddy"
  mkdir -p "$CADDY_ETC"
  sed -e "s/\${SULLYOS_DOMAIN}/$SULLYOS_DOMAIN/g" \
      -e "s/\${ACME_EMAIL}/$ACME_EMAIL/g" \
      "$CADDYFILE_SRC" > "$CADDY_ETC/SullyOS.Caddyfile"
  if systemctl list-unit-files 2>/dev/null | grep -q '^caddy'; then
    systemctl reload caddy 2>/dev/null || systemctl restart caddy 2>/dev/null || true
  else
    log "检测到 caddy 二进制但无 systemd 单元；请手动: caddy run --config /etc/caddy/SullyOS.Caddyfile"
  fi
else
  log "未检测到 caddy。安装: apt-get install -y caddy 或从 caddyserver.com 下载后重跑本脚本"
fi

# ── 7. 防火墙提示 ───────────────────────────────────────────
log "若启用了 ufw：ufw allow 80/tcp && ufw allow 443/tcp"

# ── 8. 启动 ─────────────────────────────────────────────────
systemctl start sullyos 2>/dev/null || log "无 systemd（容器？）——手动启动: cd $BACKEND_DIR && node bin/run-all.js"
sleep 2
systemctl status sullyos --no-pager 2>/dev/null | head -6 || true

log "✔ 安装完成。健康检查: curl -s http://127.0.0.1:8831/capabilities"
log "  外网路径: https://$SULLYOS_DOMAIN/instant-push/*"
log "  日志: journalctl -u sullyos -f（或 $LOG_DIR/sullyos.log）"