/**
 * CORS 契约（见 docs/superpowers/specs/2026-09-11-cors-unification-design.md）：
 * 净化回显浏览器声明的请求头/方法，新头零配置放行。
 *
 * 这些函数在 Vercel 部署时与前端同源、本来不需要 CORS 头；统一实现在这里，
 * 是为消除各函数手写 setCors 导致的放行头漂移（minimax 同族端点曾不一致）。
 */

const BASE_HEADERS = 'Content-Type, Authorization, Accept, xi-api-key, model, X-MiniMax-Region, X-MiniMax-API-Key, X-MiniMax-Group-Id';
const BASE_METHODS = 'GET, POST, OPTIONS';

export function applyCors(req: any, res: any): void {
  const rawHeader = req?.headers?.['access-control-request-headers'];
  const raw = Array.isArray(rawHeader) ? rawHeader.join(',') : String(rawHeader || '');
  const picked = raw.split(',').map((s: string) => s.trim()).filter(Boolean)
    .slice(0, 16)
    .filter((s: string) => s.length <= 64 && /^[A-Za-z0-9-]+$/.test(s));
  const methodRaw = req?.headers?.['access-control-request-method'];
  const method = String(Array.isArray(methodRaw) ? methodRaw[0] : methodRaw || '').trim();
  const allowMethods = Array.from(new Set([...BASE_METHODS.split(',').map((s) => s.trim()), ...(method.length <= 16 && /^[A-Z]+$/.test(method) ? [method] : [])]));
  const allowHeaders = Array.from(new Set([...BASE_HEADERS.split(',').map((s) => s.trim()), ...picked]));
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', allowMethods.join(', '));
  res.setHeader('Access-Control-Allow-Headers', allowHeaders.join(', '));
  res.setHeader('Access-Control-Max-Age', '86400');
}
