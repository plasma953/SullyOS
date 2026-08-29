/**
 * 零依赖 .env 加载器（Cloudflare Env 兼容层 · 配置来源）。
 *
 * 规则：
 *  - 每行 KEY=VALUE，忽略空行与 # 注释；
 *  - 支持双引号/单引号包裹；引号内转义 \" 与 \'；
 *  - 已存在的 process.env 变量默认不覆盖（部署时系统环境优先）；
 *  - 值中支持 ${VAR} 展开（引用同一文件里的变量）。
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/** 解析 .env 文本，返回 key/value 对象。 */
export function parseEnvText(text) {
  const out = {};
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      const quote = value[0];
      value = value
        .slice(1, -1)
        .replace(new RegExp(`\\\\${quote}`, 'g'), quote)
        .replace(/\\n/g, '\n');
    } else {
      // 未加引号的值：去掉行内注释
      const hash = value.indexOf(' #');
      if (hash >= 0) value = value.slice(0, hash).trim();
    }
    out[key] = value;
  }
  return out;
}

/** 展开 ${VAR}（仅引用 parse 结果自身 + process.env，绝不引用文件系统）。 */
export function expandEnvVars(entries, seen = new Set()) {
  const out = {};
  for (const [k, v] of Object.entries(entries)) {
    out[k] = String(v).replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (m, name) => {
      if (seen.has(name)) return m; // 防循环
      if (name in entries) {
        const sub = new Set(seen); sub.add(name);
        return expandEnvVars({ [name]: entries[name] }, sub)[name];
      }
      return process.env[name] ?? m;
    });
  }
  return out;
}

/**
 * 从文件加载环境变量。
 * @param {string} filePath
 * @param {{override?: boolean, quiet?: boolean}} [opts]
 * @returns {Record<string, string>} 解析结果（含展开后的值）
 */
export function loadEnvFile(filePath, opts = {}) {
  const { override = false, quiet = false } = opts;
  if (!existsSync(filePath)) {
    if (!quiet) console.warn(`[env] ${filePath} 不存在，跳过（将只使用进程环境）`);
    return {};
  }
  const parsed = expandEnvVars(parseEnvText(readFileSync(filePath, 'utf8')));
  for (const [k, v] of Object.entries(parsed)) {
    if (override || !(k in process.env)) process.env[k] = v;
  }
  if (!quiet) console.log(`[env] 已加载 ${Object.keys(parsed).length} 个变量 ← ${filePath}`);
  return parsed;
}

/**
 * 部署/本地统一的 .env 定位：
 *  1. 显式 ENV_FILE 环境变量
 *  2. /opt/sullyos/.env（VPS 部署标准位置）
 *  3. 工程根 .env（本地开发）
 */
export function resolveEnvFilePath() {
  if (process.env.ENV_FILE) return process.env.ENV_FILE;
  if (existsSync('/opt/sullyos/.env')) return '/opt/sullyos/.env';
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '../../.env');
}
