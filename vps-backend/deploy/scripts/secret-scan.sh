#!/usr/bin/env bash
#
# 密钥泄露扫描：提交前/部署后检查仓库与运行目录中是否有疑似明文凭证。
# 检查项：GitHub PAT、API Key、私钥头、.env 实体文件、VAPID 私钥。
#
# 用法：bash deploy/scripts/secret-scan.sh [仓库根目录]

set -uo pipefail

ROOT="${1:-$(cd "$(dirname "$0")/../../.." && pwd)}"
FOUND=0

PATTERNS=(
  'ghp_[A-Za-z0-9]{36,}'
  'github_pat_[A-Za-z0-9_]{60,}'
  'sk-[A-Za-z0-9_-]{20,}'
  'AIza[0-9A-Za-z_-]{30,}'
  '-----BEGIN (RSA|EC|OPENSSH|DSA) PRIVATE KEY-----'
  'VAPID_PRIVATE_KEY=[A-Za-z0-9_-]{20,}'
)

echo "[secret-scan] 扫描: $ROOT"
while IFS= read -r file; do
  case "$file" in
    */node_modules/*|*/.git/*|*/data/*|*/backups/*|*/logs/*|*/bundles/*|*.db|*.db-wal|*.db-shm) continue ;;
  esac
  for pat in "${PATTERNS[@]}"; do
    if grep -qEn "$pat" "$file" 2>/dev/null; then
      echo "  ✗ 疑似泄露: $file"
      grep -nE "$pat" "$file" | sed 's/^/      /' | cut -c1-160
      FOUND=1
    fi
  done
done < <(find "$ROOT" -type f 2>/dev/null)

# .env 实体文件检查（模板 .env.example 除外）
while IFS= read -r envfile; do
  echo "  ✗ 明文 env 文件: $envfile"
  FOUND=1
done < <(find "$ROOT" -type f -name '.env' -not -name '.env.example' 2>/dev/null | grep -v node_modules)

[ "$FOUND" -eq 0 ] && echo "  ✔ 未发现疑似泄露"
exit "$FOUND"