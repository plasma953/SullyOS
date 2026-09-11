/**
 * SullyOS heartbeat (8835) — 独立心跳收集器（VPS 单文件 Worker，手写，不经 esbuild）。
 *
 * 部署：cp src/index.js worker.bundle.js
 * 宿主：vps-backend/bin/sullyos-service.js（Node 22，env 全量直通 + DB better-sqlite3 D1 适配器）
 *
 * 职责（与 proactive-push 内嵌心跳互补，不干扰）：
 *   1. POST /ping  —— 端点报活：{ endpoint, charId? } → upsert last_heartbeat。
 *   2. GET /stats  —— 全局存活视图：{ alive, total, windowMs }。
 *   3. GET /alive  —— 存活端点清单（供主代理/告警查询）。
 *   4. scheduled（每分钟 cron）—— 清理 2× 窗口无心跳的死条目。
 *   5. 严格鉴权：X-Client-Token（或 Authorization: Bearer）== AMSG_CLIENT_TOKEN。
 */
'use strict';

const WINDOW_FALLBACK_MS = 300000; // 5 分钟

// CORS 契约（见 docs/superpowers/specs/2026-09-11-cors-unification-design.md）：
// 预检净化回显浏览器声明的请求头/方法，新头零配置放行；单文件内联以保持可整份复制部署。
const CORS_BASE_HEADERS = 'Content-Type, Authorization, X-Client-Token, Accept';
const CORS_BASE_METHODS = 'GET, POST, OPTIONS';

function corsPreflight(request) {
  const raw = String(request?.headers?.get('access-control-request-headers') || '');
  const picked = raw.split(',').map((s) => s.trim()).filter(Boolean)
    .slice(0, 16)
    .filter((s) => s.length <= 64 && /^[A-Za-z0-9-]+$/.test(s));
  const method = String(request?.headers?.get('access-control-request-method') || '').trim();
  const allowMethods = Array.from(new Set([...CORS_BASE_METHODS.split(',').map((s) => s.trim()), ...(method.length <= 16 && /^[A-Z]+$/.test(method) ? [method] : [])]));
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': [CORS_BASE_HEADERS, ...picked].join(', '),
      'access-control-allow-methods': allowMethods.join(', '),
      'access-control-max-age': '86400',
    },
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
    },
  });
}

function checkAuth(req, env) {
  const expected = (env.AMSG_CLIENT_TOKEN || '').trim();
  if (!expected) return null; // 未配置令牌 = 开发模式放行
  const header = req.headers.get('x-client-token') || '';
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (header === expected || bearer === expected) return null;
  return json({ error: 'unauthorized', hint: 'X-Client-Token required' }, 403);
}

function windowMs(env) {
  const parsed = parseInt(env.HEARTBEAT_WINDOW_MS || env.HEARTBEAT_INTERVAL_SEC * 1000 || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : WINDOW_FALLBACK_MS;
}

async function handlePing(req, env) {
  let body;
  try { body = await req.json(); } catch { return json({ error: 'invalid json' }, 400); }
  const endpoint = String((body && body.endpoint) || '').trim();
  if (!endpoint) return json({ error: 'endpoint required' }, 400);
  const charId = String((body && body.charId) || '').trim();
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO heartbeats (endpoint, char_id, last_heartbeat, created_at)
     VALUES (?1, ?2, ?3, ?3)
     ON CONFLICT(endpoint) DO UPDATE SET last_heartbeat = excluded.last_heartbeat`
  ).bind(endpoint, charId, now, now).run();
  return json({ ok: true, endpoint, lastHeartbeat: now });
}

async function handleStats(env) {
  const win = windowMs(env);
  const now = Date.now();
  const rows = (await env.DB.prepare('SELECT last_heartbeat FROM heartbeats').all()).results;
  const total = rows.length;
  const alive = rows.filter((r) => now - r.last_heartbeat <= win).length;
  return json({ ok: true, alive, total, windowMs: win, now });
}

async function handleAlive(env) {
  const win = windowMs(env);
  const now = Date.now();
  const rows = (await env.DB.prepare('SELECT endpoint, char_id, last_heartbeat FROM heartbeats').all()).results;
  const alive = rows
    .filter((r) => now - r.last_heartbeat <= win)
    .map((r) => ({ endpoint: r.endpoint, charId: r.char_id || null, lastHeartbeat: r.last_heartbeat }));
  return json({ ok: true, alive });
}

async function sweepDead(env) {
  if (!env.DB) return;
  const win = windowMs(env);
  const cutoff = Date.now() - win * 2;
  await env.DB.prepare('DELETE FROM heartbeats WHERE last_heartbeat < ?1').bind(cutoff).run();
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/heartbeat(?=\/|$)/, '') || '/';

    if (request.method === 'OPTIONS') return corsPreflight(request);

    if (path === '/health' || path === '/') {
      return json({
        ok: true,
        service: 'heartbeat',
        version: '1.0.0',
        windowMs: windowMs(env),
        time: new Date().toISOString(),
      });
    }

    const authFail = checkAuth(request, env);
    if (authFail) return authFail;

    if (path === '/ping' && request.method === 'POST') return handlePing(request, env);
    if (path === '/stats' && request.method === 'GET') return handleStats(env);
    if (path === '/alive' && request.method === 'GET') return handleAlive(env);

    return json({ error: 'not_found', path }, 404);
  },

  async scheduled(_event, env) {
    await sweepDead(env);
  },
};