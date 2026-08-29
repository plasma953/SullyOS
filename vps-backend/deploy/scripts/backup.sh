#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# SullyOS VPS · 三通道自动备份
#
# 通道 1（GitHub · 代码）：/opt/sullyos/sullyos-repo 自动 commit + push
#   origin（.env / *.sqlite 已由 .gitignore 排除，永不入库）。
#
# 通道 2（WebDAV/dufs · 本机盘）：/opt/sullyos/data/*.sqlite
#   → VACUUM INTO 一致性快照 → tar → AES-256-CBC 加密 → 滚动保留
#   BACKUP_KEEP（默认 7）份，落在 DUFS_ROOT（默认 /opt/sullyos/backups/webdav），
#   由 main-agent /webdav/* 认证注入中转对外提供。
#
# 通道 3（GitHub 备份仓 · 异机容灾）：把同一份加密包经 contents API
#   上传到 GITHUB_BACKUP_REPO 的 vps/ 目录（时间戳命名的新增文件，
#   绝不覆盖备份仓既有内容；滚动保留 BACKUP_KEEP 份）。
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
GITHUB_BACKUP_PAT=$(get_env GITHUB_BACKUP_PAT)
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
  # 代码连续性：推送自身 origin（PAT 内联；.git-credentials 可能存有旧令牌）
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
        -pass "pass:${BACKUP_ENCRYPT_PASSPHRASE}" \
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
    # ── 通道 3：GitHub 备份仓（contents API 上传加密包到 vps/ 目录）──
    # 新增文件、时间戳命名：绝不覆盖备份仓既有内容，无需 workflow scope
    if [ -n "${GITHUB_BACKUP_REPO:-}" ] && [ -n "${GITHUB_BACKUP_PAT:-}" ]; then
      REPO_SLUG=$(printf '%s' "$GITHUB_BACKUP_REPO" | sed -E 's|^https://github.com/||; s|\.git$||; s|/$||')
      ENC_NAME="sullyos-data-$TS.tar.gz.enc"
      ENC_PATH="$BACKUP_DIR/$ENC_NAME"
      if [ ! -f "$ENC_PATH" ]; then
        # 未配置加密口令时退级上传未加密包（仍建议配置 BACKUP_ENCRYPT_PASSPHRASE）
        ENC_NAME="sullyos-data-$TS.tar.gz"
        ENC_PATH="$BACKUP_DIR/$ENC_NAME"
      fi
      if [ -f "$ENC_PATH" ]; then
        # 大文件经 node 生成 JSON 载荷写入临时文件，避免 ARG_MAX 超限；
        # 响应体含 base64 回显，统一落盘后 grep，避免内存膨胀
        PAYLOAD="$TMP/gh-payload.json"
        node -e "
const fs=require('fs');
const b64=fs.readFileSync('$ENC_PATH').toString('base64');
fs.writeFileSync('$PAYLOAD', JSON.stringify({message:'backup: ${TS}', content:b64}));
" && \
        curl -s -m 300 -X PUT \
          -H "Authorization: Bearer ${GITHUB_BACKUP_PAT}" \
          -H 'User-Agent: sullyos-backup' -H 'Content-Type: application/json' \
          "https://api.github.com/repos/${REPO_SLUG}/contents/vps/${ENC_NAME}" \
          --data-binary "@$PAYLOAD" -o "$TMP/gh-resp.json"
        if grep -q '"sha"' "$TMP/gh-resp.json" 2>/dev/null; then
          echo "[backup] 通道3(GitHub备份仓): 已上传 vps/${ENC_NAME}"
          # 滚动清理：仅删除 vps/ 目录下我们自己上传的过期文件
          LIST=$(curl -s -m 30 -H "Authorization: Bearer ${GITHUB_BACKUP_PAT}" -H 'User-Agent: sullyos-backup' \
            "https://api.github.com/repos/${REPO_SLUG}/contents/vps")
          printf '%s' "$LIST" | node -e "
let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
  let items=[];
  try{items=JSON.parse(d)}catch(e){}
  items=items.filter(i=>i&&i.name&&i.name.startsWith('sullyos-data-')).sort((a,b)=>a.name<b.name?1:-1);
  items.slice(${KEEP}).forEach(i=>console.log(i.sha+' '+i.name));
});
" | while read -r SHA NAME; do
            curl -s -m 30 -X DELETE \
              -H "Authorization: Bearer ${GITHUB_BACKUP_PAT}" -H 'User-Agent: sullyos-backup' \
              "https://api.github.com/repos/${REPO_SLUG}/contents/vps/${NAME}" \
              -d "{\"message\":\"backup: rotate ${NAME}\",\"sha\":\"${SHA}\"}" >/dev/null 2>&1 \
              && echo "[backup] 通道3(GitHub备份仓): 滚动清理 ${NAME}"
          done
        else
          echo "[backup] 通道3(GitHub备份仓): 上传失败（$(head -c 200 "$TMP/gh-resp.json" 2>/dev/null)）" >&2; FAIL=1
        fi
      fi
    fi

    # 滚动清理（本地 WebDAV）
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