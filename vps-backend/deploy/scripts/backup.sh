#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# SullyOS VPS · 双通道自动备份
#
# 通道 1（GitHub）：/opt/sullyos/sullyos-repo 自动 commit + push。
#   代码级连续性备份（.env / *.sqlite 已由 .gitignore 排除，永不入库）。
#   - 若配置了 GITHUB_BACKUP_REPO + GITHUB_PAT → 推送到专用备份仓；
#   - 否则推送到仓库自身 origin（凭据走 ~/.git-credentials）。
#
# 通道 2（WebDAV/dufs 本机盘）：/opt/sullyos/data/*.sqlite
#   → VACUUM INTO 一致性快照 → tar → AES-256-CBC 加密 → 滚动保留
#   BACKUP_KEEP（默认 7）份。文件落在 DUFS_ROOT（默认 /opt/sullyos/backups/webdav），
#   由 main-agent /webdav/* 认证注入中转对外提供。
#
# 建议 cron（避开 04:30 的 cove 清理任务）：
#   15 4 * * * /opt/sullyos/vps-backend/deploy/scripts/backup.sh >> /var/log/sullyos-backup.log 2>&1
# ═══════════════════════════════════════════════════════════════════
set -uo pipefail

ENV_FILE=/opt/sullyos/.env
if [ ! -f "$ENV_FILE" ]; then
  echo "[backup] 缺少 $ENV_FILE，退出" >&2
  exit 1
fi
# 安全读取（不 source：值可能含 JSON/空格/引号，避免被 shell 重新解析）
get_env() {
  sed -n "s/^$1=//p" "$ENV_FILE" | head -1 | tr -d "\"'"
}
GITHUB_PAT=$(get_env GITHUB_PAT)
GITHUB_BACKUP_REPO=$(get_env GITHUB_BACKUP_REPO)
DUFS_ROOT=$(get_env DUFS_ROOT)
BACKUP_KEEP=$(get_env BACKUP_KEEP)
BACKUP_ENCRYPT_PASSPHRASE=$(get_env BACKUP_ENCRYPT_PASSPHRASE)
REPO=/opt/sullyos/sullyos-repo
DATA_DIR=${AMSG_DATA_DIR:-/opt/sullyos/data}
BACKUP_DIR=${DUFS_ROOT:-/opt/sullyos/backups/webdav}
KEEP=${BACKUP_KEEP:-7}
TS=$(date -u '+%Y%m%d-%H%M%S')
FAIL=0

echo "════════ $(date -u '+%Y-%m-%d %H:%M:%S UTC') 备份开始 ════════"

# ── 通道 1：GitHub ──────────────────────────────────────────────
if [ -d "$REPO/.git" ]; then
  if (cd "$REPO" && git add -A 2>/dev/null && ! git diff --cached --quiet); then
    (cd "$REPO" && git -c user.name='sullyos-backup' -c user.email='backup@sullyos.local' \
      commit -m "backup: auto snapshot $(date -u '+%Y-%m-%d %H:%M:%S UTC')" >/dev/null 2>&1)
    echo "[backup] 通道1(GitHub): 本地已提交自动快照"
  else
    echo "[backup] 通道1(GitHub): 无本地变更"
  fi
  if [ -n "${GITHUB_BACKUP_REPO:-}" ] && [ -n "${GITHUB_PAT:-}" ]; then
    REPO_URL="${GITHUB_BACKUP_REPO#https://}"
    if (cd "$REPO" && git push "https://${GITHUB_PAT}@${REPO_URL}" HEAD:master >/dev/null 2>&1); then
      echo "[backup] 通道1(GitHub): 已推送到备份仓"
    else
      echo "[backup] 通道1(GitHub): 备份仓推送失败" >&2; FAIL=1
    fi
  else
    # 推送到自身 origin；优先用 GITHUB_PAT 内联（.git-credentials 可能存有旧令牌）
    BR=$(cd "$REPO" && git rev-parse --abbrev-ref HEAD)
    if [ -n "${GITHUB_PAT:-}" ]; then
      ORIGIN_URL=$(cd "$REPO" && git config --get remote.origin.url | sed 's|^https://||')
      if (cd "$REPO" && git push "https://${GITHUB_PAT}@${ORIGIN_URL}" "HEAD:${BR}" >/dev/null 2>&1); then
        echo "[backup] 通道1(GitHub): 已推送到 origin（PAT 内联）"
      else
        echo "[backup] 通道1(GitHub): origin 推送失败" >&2; FAIL=1
      fi
    else
      if (cd "$REPO" && git push origin "HEAD:${BR}" >/dev/null 2>&1); then
        echo "[backup] 通道1(GitHub): 已推送到 origin"
      else
        echo "[backup] 通道1(GitHub): origin 推送失败" >&2; FAIL=1
      fi
    fi
  fi
else
  echo "[backup] 通道1(GitHub): 仓库不存在，跳过" >&2
fi

# ── 通道 2：WebDAV 加密快照 ─────────────────────────────────────
mkdir -p "$BACKUP_DIR"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
COUNT=0
if [ -d "$DATA_DIR" ]; then
  for db in "$DATA_DIR"/*.sqlite; do
    [ -f "$db" ] || continue
    name=$(basename "$db")
    if node /opt/sullyos/vps-backend/deploy/scripts/vacuum-snapshot.cjs "$db" "$TMP/$name" >/dev/null 2>&1; then
      COUNT=$((COUNT + 1))
    else
      echo "[backup] 通道2: 快照失败 $name" >&2
    fi
  done
fi
if [ "$COUNT" -gt 0 ]; then
  TARBALL="$TMP/sullyos-data-$TS.tar.gz"
  if (cd "$TMP" && tar -czf "$TARBALL" ./*.sqlite 2>/dev/null); then
    if [ -n "${BACKUP_ENCRYPT_PASSPHRASE:-}" ]; then
      if openssl enc -aes-256-cbc -pbkdf2 -iter 100000 -salt \
        -pass "env:BACKUP_ENCRYPT_PASSPHRASE" \
        -in "$TARBALL" -out "$BACKUP_DIR/sullyos-data-$TS.tar.gz.enc" 2>/dev/null; then
        echo "[backup] 通道2(WebDAV): $TS → $COUNT 个库，已 AES-256 加密"
      else
        echo "[backup] 通道2(WebDAV): 加密失败" >&2; FAIL=1
      fi
    else
      if cp "$TARBALL" "$BACKUP_DIR/sullyos-data-$TS.tar.gz"; then
        echo "[backup] 通道2(WebDAV): $TS → $COUNT 个库（未加密，建议设置 BACKUP_ENCRYPT_PASSPHRASE）"
      else
        echo "[backup] 通道2(WebDAV): 拷贝失败" >&2; FAIL=1
      fi
    fi
    # 滚动清理
    ls -1t "$BACKUP_DIR"/sullyos-data-*.tar.gz* 2>/dev/null | tail -n "+$((KEEP + 1))" | xargs -r rm -f
  else
    echo "[backup] 通道2(WebDAV): 打包失败" >&2; FAIL=1
  fi
else
  echo "[backup] 通道2(WebDAV): 无 sqlite 数据，跳过"
fi

# 日志防膨胀（>5MB 截断）
LOG=/var/log/sullyos-backup.log
if [ -f "$LOG" ] && [ "$(stat -c%s "$LOG" 2>/dev/null || echo 0)" -gt 5242880 ]; then
  tail -c 1048576 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
fi

if [ "$FAIL" -eq 0 ]; then
  echo "[backup] ✔ 备份完成（$TS）"
else
  echo "[backup] ⚠ 备份完成但有失败项（$TS）"
fi
exit "$FAIL"