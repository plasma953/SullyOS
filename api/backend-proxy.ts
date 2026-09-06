/**
 * 同源后端中转（Vercel serverless）。
 *
 * 背景：某些网络直连后端 TLS 会被 RST，而托管域名本身可达。前端把后端绝对地址
 * 映射成同源 `/agent/*`、`/amsg/*`（见 utils/networkFailureDiagnosis.ts），
 * vercel.json 把这两段 rewrite 到本函数，由边缘侧代为转发，浏览器不直连后端。
 *
 * 后端地址来自服务端环境变量 BACKEND_HOST（只填 host，如 backend.example.com，
 * 可带端口），绝不写进仓库——写进仓库等于把后端域名公开。后端路径前缀由查询
 * 参数 ns（agent/amsg）决定，其余查询参数原样透传。
 *
 * 透明转发：method/headers/body/CORS 由上游决定，这里只做 transport（流式
 * passthrough，不断 SSE）。平台自身的函数时长上限仍然适用。
 */

import { Readable } from 'node:stream';

const NS_PREFIX: Record<string, string> = {
  agent: '/agent/',
  amsg: '/amsg/',
};

// hop-by-hop + fetch 会自己算的，透传时去掉
const DROP_REQUEST_HEADERS = new Set([
  'host', 'connection', 'content-length', 'transfer-encoding', 'upgrade',
]);

function resolveBackendHost(): string | null {
  const raw = (process.env.BACKEND_HOST || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  if (!raw || !/^[a-z0-9.-]+(:\d+)?$/i.test(raw)) return null;
  return raw;
}

export default async function handler(req: any, res: any) {
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const host = resolveBackendHost();
  if (!host) {
    res.status(500).json({
      error: 'Backend not configured. Set BACKEND_HOST env var on the deployment (bare host, e.g. backend.example.com).',
    });
    return;
  }

  const query = req.query || {};
  const ns = Array.isArray(query.ns) ? query.ns[0] : query.ns;
  const restRaw = Array.isArray(query.rest) ? query.rest[0] : query.rest;
  const prefix = NS_PREFIX[String(ns || '')];
  if (!prefix) {
    res.status(400).json({ error: 'Unknown proxy namespace. Want ns=agent or ns=amsg.' });
    return;
  }
  const rest = String(restRaw || '').replace(/^\/+/, '');
  if (!rest) {
    res.status(400).json({ error: 'Missing proxied path.' });
    return;
  }

  const forwardQuery = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (k === 'ns' || k === 'rest') continue;
    if (Array.isArray(v)) v.forEach((x) => forwardQuery.append(k, String(x)));
    else if (v !== undefined) forwardQuery.append(k, String(v));
  }
  const qs = forwardQuery.toString();
  const targetUrl = `https://${host}${prefix}${rest}${qs ? `?${qs}` : ''}`;

  const fwdHeaders: Record<string, string> = {};
  const incoming = req.headers || {};
  for (const [k, v] of Object.entries(incoming)) {
    if (DROP_REQUEST_HEADERS.has(String(k).toLowerCase())) continue;
    if (typeof v === 'string' && v) fwdHeaders[k] = v;
  }

  let body: unknown = undefined;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    body = typeof req.body === 'string' || Buffer.isBuffer(req.body) || req.body instanceof Uint8Array
      ? req.body
      : req.body === undefined
        ? undefined
        : JSON.stringify(req.body);
  }

  try {
    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers: fwdHeaders,
      body: body as BodyInit | undefined,
    });
    res.status(upstream.status);
    const ct = upstream.headers.get('content-type');
    if (ct) res.setHeader('Content-Type', ct);
    const cc = upstream.headers.get('cache-control');
    if (cc) res.setHeader('Cache-Control', cc);
    if (!upstream.body) {
      res.end();
      return;
    }
    await new Promise<void>((resolve, reject) => {
      Readable.fromWeb(upstream.body as import('node:stream/web').ReadableStream)
        .on('error', reject)
        .on('end', resolve)
        .pipe(res);
    });
  } catch (e: any) {
    if (!res.headersSent) {
      res.status(502).json({ error: `Backend unreachable: ${e?.message || e}` });
    } else {
      try { res.end(); } catch { /* already streaming */ }
    }
  }
}
