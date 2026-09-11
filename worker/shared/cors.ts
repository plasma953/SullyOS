/**
 * CORS 契约参考实现（见 docs/superpowers/specs/2026-09-11-cors-unification-design.md）。
 * 行为：OPTIONS 204（鉴权前）+ ACAO * + 净化回显请求头/方法 + Max-Age 86400。
 * 单文件 worker 内联同一段逻辑（保持复制即部署）；一致性由 worker/corsContract.test.ts 锁死。
 */

export const CORS_BASE_HEADERS = ['Content-Type', 'Authorization', 'X-Client-Token', 'Accept'];
export const CORS_BASE_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];

const MAX_ECHO_HEADERS = 16;
const MAX_HEADER_LENGTH = 64;
const MAX_METHOD_LENGTH = 16;
const HEADER_NAME_RE = /^[A-Za-z0-9-]+$/;
const METHOD_RE = /^[A-Z]+$/;

export function sanitizeRequestedHeaders(raw: string | null): string[] {
  if (!raw) return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean)
    .slice(0, MAX_ECHO_HEADERS)
    .filter((s) => s.length <= MAX_HEADER_LENGTH && HEADER_NAME_RE.test(s));
}

export function sanitizeRequestedMethod(raw: string | null): string | null {
  if (!raw) return null;
  const m = raw.trim();
  return m.length <= MAX_METHOD_LENGTH && METHOD_RE.test(m) ? m : null;
}

export function corsHeaders(
  request: Request,
  opts: { expose?: string; extraHeaders?: string[] } = {},
): Record<string, string> {
  const requested = sanitizeRequestedHeaders(request.headers.get('Access-Control-Request-Headers'));
  const method = sanitizeRequestedMethod(request.headers.get('Access-Control-Request-Method'));
  const allowHeaders = Array.from(new Set([...CORS_BASE_HEADERS, ...(opts.extraHeaders || []), ...requested]));
  const allowMethods = Array.from(new Set([...CORS_BASE_METHODS, ...(method ? [method] : [])]));
  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': allowHeaders.join(', '),
    'Access-Control-Allow-Methods': allowMethods.join(', '),
    'Access-Control-Max-Age': '86400',
  };
  if (opts.expose) headers['Access-Control-Expose-Headers'] = opts.expose;
  return headers;
}

export function preflightResponse(
  request: Request,
  opts: { expose?: string; extraHeaders?: string[] } = {},
): Response {
  return new Response(null, { status: 204, headers: corsHeaders(request, opts) });
}
