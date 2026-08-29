/**
 * Worker Bundle 加载器。
 *
 * 已确认各 worker.bundle.js 为单文件 ESM 产物（末尾 export default { fetch, scheduled }），
 * 且不含 cloudflare:* 导入。通过 data: URL 导入可 100% 强制按 ESM 解析，
 * 不受 bundle 所在目录最近的 package.json "type" 字段影响。
 */

import { readFile } from 'node:fs/promises';

/**
 * @param {string} absPath bundle 绝对路径
 * @returns {Promise<{ worker: any, mod: any, source: string }>}
 */
export async function loadWorkerBundle(absPath) {
  let source = await readFile(absPath, 'utf8');
  // Cloudflare 协议导入替换：Node ESM loader 不识别 cloudflare: scheme。
  // 已确认 amsg bundle 顶层 `import { DurableObject } from "cloudflare:workers"`：
  //   - 该 bundle 仅把 DurableObject 当「名义基类」extends（实例经 new Cls(state, env)
  //     注入 state/env，与 src/shim/do.js 的 DO 命名空间契约一致）；
  //   - 因此替换为空基类即可，真实 DO RPC 场景再启用 shim/do.js 的 SQLite 命名空间。
  // 其他 cloudflare:* 导入（如 cloudflare:email）按未使用处理，整行剥除。
  source = source.replace(
    /import\s*\{[^}]*\}\s*from\s*["']cloudflare:workers["']\s*;?/g,
    'const DurableObject = class {};',
  );
  source = source.replace(
    /import\s*\{[^}]*\}\s*from\s*["']cloudflare:[a-z]+["']\s*;?/g,
    '',
  );
  const dataUrl = `data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`;
  const mod = await import(dataUrl);
  const worker = mod?.default ?? mod?.worker ?? null;
  if (!worker || typeof worker.fetch !== 'function') {
    throw new Error(`Bundle 未导出 fetch 处理器: ${absPath}`);
  }
  return { worker, mod, source };
}
