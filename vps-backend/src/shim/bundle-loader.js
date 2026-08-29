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
  const source = await readFile(absPath, 'utf8');
  const dataUrl = `data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`;
  const mod = await import(dataUrl);
  const worker = mod?.default ?? mod?.worker ?? null;
  if (!worker || typeof worker.fetch !== 'function') {
    throw new Error(`Bundle 未导出 fetch 处理器: ${absPath}`);
  }
  return { worker, mod, source };
}
