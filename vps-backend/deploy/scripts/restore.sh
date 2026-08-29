#!/usr/bin/env bash
#
# SullyOS VPS 恢复
#
# 用法：
#   bash deploy/scripts/restore.sh <加密备份文件> [--passphrase 环境变量 BACKUP_ENCRYPT_PASSPHRASE]
#   bash deploy/scripts/restore.sh webdav   # 自动取 WebDAV 目录最新一份
#
# 步骤：解密（如需）→ 解包 → 覆盖 data/*.sqlite 与 /opt/sullyos/.env → 提示重启 sullyos。

set -uo pipefail

APP_DIR="${APP_DIR:-/opt/sullyos}"
ENV_FILE="$APP_DIR/.env"
DATA_DIR="$APP_DIR/data"
TMP="$APP_DIR/backups/restore.tmp"
# shellcheck disable=SC1090
[ -f "$ENV_FILE" ] && { set -a; source "$ENV_FILE"; set +a; }

log() { echo "[restore] $*"; }

SRC="$1"
if [ "$SRC" = "webdav" ]; then
  ROOT="${DUFS_ROOT:-/opt/sullyos/backups/webdav}"
  SRC="$(ls -1t "$ROOT/snapshots/" 2>/dev/null | head -1)"
  [ -n "$SRC" ] || { echo "[restore] ✗ WebDAV 目录无备份" >&2; exit 1; }
  SRC="$ROOT/snapshots/$SRC"
fi
[ -f "$SRC" ] || { echo "[restore] ✗ 备份文件不存在: $SRC" >&2; exit 1; }

rm -rf "$TMP"; mkdir -p "$TMP"

# 解密（.enc 结尾才需要）
if [[ "$SRC" == *.enc ]]; then
  [ -n "${BACKUP_ENCRYPT_PASSPHRASE:-}" ] || { echo "[restore] ✗ 缺 BACKUP_ENCRYPT_PASSPHRASE（无法解密）" >&2; exit 1; }
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
    -pass "env:BACKUP_ENCRYPT_PASSPHRASE" \
    -in "$SRC" -out "$TMP/plain.tar.gz"
  TARBALL="$TMP/plain.tar.gz"
else
  TARBALL="$SRC"
fi

tar -xzf "$TARBALL" -C "$TMP" || { echo "[restore] ✗ 解包失败" >&2; exit 1; }

log "恢复 sqlite → $DATA_DIR"
mkdir -p "$DATA_DIR"
find "$TMP" -name '*.db' | while read -r f; do
  cp "$f" "$DATA_DIR/$(basename "$f" .db).sqlite"
done
if [ -f "$TMP/.env" ]; then
  cp "$TMP/.env" "$ENV_FILE"; chmod 600 "$ENV_FILE"
  log "已恢复 $ENV_FILE"
fi

rm -rf "$TMP"
log "✔ 恢复完成。重启服务: systemctl restart sullyos"