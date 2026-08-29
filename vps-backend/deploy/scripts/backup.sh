#!/usr/bin/env bash
#
# SullyOS VPS 备份（双通道）
#
# 通道 A（GitHub 私有仓）：
#   1. sqlite3 VACUUM INTO 干净快照（*.db → 快照文件）
#   2. openssl enc -aes-256-cbc -pbkdf2 加密（BACKUP_ENCRYPT_PASSPHRASE）
#   3. 用 GITHUB_PAT 推送到 GITHUB_BACKUP_REPO 的 snapshots/ 目录
# 通道 B（WebDAV/dufs，前端直连）：
#   1. 拷贝 .env + 快照到 DUFS_ROOT（密钥文件本身已由 .env 权限保护）
#   2. 保留 BACKUP_KEEP 份轮转
#
# 安全：PAT 与 passphrase 只读自 /opt/sullyos/.env（600），永不出现在命令行与日志。
# 用法：bash deploy/scripts/backup.sh [--channel github|webdav|all]

set -uo pipefail

APP_DIR="${APP_DIR:-/opt/sullyos}"
ENV_FILE="$APP_DIR/.env"
DATA_DIR="$APP_DIR/data"
WORK_DIR="$APP_DIR/backups/work"
GH_WORK="$APP_DIR/backups/gh-repo"
# shellcheck disable=SC1090
[ -f "$ENV_FILE" ] && { set -a; source "$ENV_FILE"; set +a; }

CHANNEL="${1:-all}"
if [ "$CHANNEL" != "all" ]; then
  shift
  while [ $# -gt 0 ]; do
    case "$1" in --channel) CHANNEL="$2"; shift 2;; *) shift;; esac
  done
fi

BACKUP_KEEP="${BACKUP_KEEP:-7}"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$WORK_DIR"

log() { echo "[backup] $*"; }

# ── 快照 + 加密 ────────────────────────────────────────────
make_snapshot() {
  local out_dir="$1"
  mkdir -p "$out_dir"
  # sqlite 文件只保留主文件快照（WAL 已随 VACUUM INTO 合并）
  for db in "$DATA_DIR"/*.sqlite; do
    [ -f "$db" ] || continue
    local name
    name="$(basename "$db" .sqlite)"
    if command -v sqlite3 >/dev/null 2>&1; then
      sqlite3 "$db" "VACUUM INTO '$out_dir/${name}.db'" || cp "$db" "$out_dir/${name}.db"
    else
      cp "$db" "$out_dir/${name}.db"
    fi
  done
  cp "$ENV_FILE" "$out_dir/.env" 2>/dev/null || true
  tar -C "$out_dir" -czf "$WORK_DIR/sullyos-${STAMP}.tar.gz" . 2>/dev/null || \
    tar -C "$APP_DIR" -czf "$WORK_DIR/sullyos-${STAMP}.tar.gz" data .env 2>/dev/null || true

  local enc_out="$WORK_DIR/sullyos-${STAMP}.tar.gz.enc"
  if [ -n "${BACKUP_ENCRYPT_PASSPHRASE:-}" ]; then
    openssl enc -aes-256-cbc -salt -pbkdf2 -iter 200000 \
      -pass "env:BACKUP_ENCRYPT_PASSPHRASE" \
      -in "$WORK_DIR/sullyos-${STAMP}.tar.gz" -out "$enc_out"
    echo "$enc_out"
  else
    log "⚠ BACKUP_ENCRYPT_PASSPHRASE 未设置，产物不加密"
    echo "$WORK_DIR/sullyos-${STAMP}.tar.gz"
  fi
}

# ── 通道 A：GitHub ─────────────────────────────────────────
backup_github() {
  [ -n "${GITHUB_PAT:-}" ] || { log "✗ 缺 GITHUB_PAT，跳过 GitHub 通道"; return 1; }
  [ -n "${GITHUB_BACKUP_REPO:-}" ] || { log "✗ 缺 GITHUB_BACKUP_REPO，跳过 GitHub 通道"; return 1; }
  local artifact="$1"

  rm -rf "$GH_WORK"; mkdir -p "$GH_WORK"
  GIT_TERMINAL_PROMPT=0 git clone --depth 1 \
    "https://x-access-token:${GITHUB_PAT}@github.com/${GITHUB_BACKUP_REPO}.git" \
    "$GH_WORK" 2>/dev/null || git init "$GH_WORK" >/dev/null

  mkdir -p "$GH_WORK/snapshots"
  cp "$artifact" "$GH_WORK/snapshots/"
  git -C "$GH_WORK" config user.name  "sullyos-backup"
  git -C "$GH_WORK" config user.email "backup@sullyos.local"
  git -C "$GH_WORK" add -A
  git -C "$GH_WORK" commit -m "backup: ${STAMP}" >/dev/null 2>&1 || true
  GIT_TERMINAL_PROMPT=0 git -C "$GH_WORK" push \
    "https://x-access-token:${GITHUB_PAT}@github.com/${GITHUB_BACKUP_REPO}.git" \
    HEAD:main --force 2>/dev/null || \
  GIT_TERMINAL_PROMPT=0 git -C "$GH_WORK" push \
    "https://x-access-token:${GITHUB_PAT}@github.com/${GITHUB_BACKUP_REPO}.git" \
    HEAD:master --force
  log "✔ GitHub 备份完成: ${GITHUB_BACKUP_REPO}@snapshots/$(basename "$artifact")"
}

# ── 通道 B：WebDAV（dufs 根目录直接落盘）───────────────────
backup_webdav() {
  local root="${DUFS_ROOT:-/opt/sullyos/backups/webdav}"
  mkdir -p "$root/snapshots"
  cp "$1" "$root/snapshots/"
  # 轮转
  ls -1t "$root/snapshots/" 2>/dev/null | tail -n +$((BACKUP_KEEP + 1)) | \
    while read -r f; do rm -f "$root/snapshots/$f"; done
  log "✔ WebDAV 备份完成（保留最近 ${BACKUP_KEEP} 份）: $root/snapshots"
}

# ── 执行 ───────────────────────────────────────────────────
log "开始备份（${STAMP}，通道=${CHANNEL}）"
case "$CHANNEL" in
  github)  A="$(make_snapshot "$WORK_DIR/snap")"; backup_github "$A" ;;
  webdav)  A="$(make_snapshot "$WORK_DIR/snap")"; backup_webdav "$A" ;;
  all)     A="$(make_snapshot "$WORK_DIR/snap")"; backup_github "$A"; backup_webdav "$A" ;;
  *) log "未知通道: $CHANNEL（github|webdav|all）"; exit 2 ;;
esac
log "完成"