#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# SullyOS VPS · 备份恢复
#
# 用法：
#   restore.sh <备份文件>           # 预览模式：解密/解压到临时目录，不落盘
#   restore.sh --auto <备份文件>    # 自动模式：停 sullyos → 覆盖 data/*.sqlite → 重启
#
# 支持 backup.sh 产物：sullyos-data-*.tar.gz 或 .tar.gz.enc
# ═══════════════════════════════════════════════════════════════════
set -uo pipefail

ENV_FILE=/opt/sullyos/.env
[ -f "$ENV_FILE" ] || { echo "缺少 $ENV_FILE" >&2; exit 1; }
# 安全读取（不 source：值可能含 JSON/空格/引号）
get_env() {
  sed -n "s/^$1=//p" "$ENV_FILE" | head -1 | tr -d "\"'"
}
BACKUP_ENCRYPT_PASSPHRASE=$(get_env BACKUP_ENCRYPT_PASSPHRASE)
AMSG_DATA_DIR=$(get_env AMSG_DATA_DIR)

AUTO=0
TARGET="${1:-}"
if [ "$TARGET" = "--auto" ]; then AUTO=1; TARGET="${2:-}"; fi
if [ -z "$TARGET" ] || [ ! -f "$TARGET" ]; then
  echo "用法: restore.sh [--auto] <sullyos-data-*.tar.gz|.tar.gz.enc>" >&2
  exit 2
fi

DATA_DIR=${AMSG_DATA_DIR:-/opt/sullyos/data}
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
PLAIN="$TMP/data.tar.gz"

case "$TARGET" in
  *.tar.gz.enc)
    [ -n "${BACKUP_ENCRYPT_PASSPHRASE:-}" ] || { echo "需要 BACKUP_ENCRYPT_PASSPHRASE 解密" >&2; exit 1; }
    openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 -salt \
      -pass "env:BACKUP_ENCRYPT_PASSPHRASE" -in "$TARGET" -out "$PLAIN" || { echo "解密失败" >&2; exit 1; }
    ;;
  *.tar.gz)
    cp "$TARGET" "$PLAIN" || exit 1
    ;;
  *)
    echo "不支持的备份格式（需 .tar.gz 或 .tar.gz.enc）" >&2; exit 2
    ;;
esac

tar -xzf "$PLAIN" -C "$TMP" || { echo "解压失败" >&2; exit 1; }
SQLITES=$(find "$TMP" -maxdepth 1 -name '*.sqlite' | wc -l)
echo "发现 $SQLITES 个 sqlite 快照："
ls -la "$TMP"/*.sqlite 2>/dev/null | awk '{print "  " $5, $9}'

if [ "$AUTO" -eq 1 ]; then
  systemctl stop sullyos.service 2>/dev/null || true
  mkdir -p "$DATA_DIR"
  for db in "$TMP"/*.sqlite; do
    [ -f "$db" ] || continue
    name=$(basename "$db")
    echo "恢复 $name ..."
    cp -f "$db" "$DATA_DIR/$name"
    rm -f "$DATA_DIR/$name-wal" "$DATA_DIR/$name-shm" 2>/dev/null || true
    chmod 600 "$DATA_DIR/$name"
  done
  systemctl start sullyos.service 2>/dev/null || true
  echo "✔ 恢复完成，sullyos 服务已重启"
else
  echo "预览模式完成：快照已解压于临时目录。确认后执行: restore.sh --auto $TARGET"
fi