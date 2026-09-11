/**
 * SullyOS wake-bridge (8834) — 唤醒桥（VPS 单文件 Worker，手写，不经 esbuild）。
 *
 * 部署：cp src/index.js worker.bundle.js
 * 宿主：vps-backend/bin/sullyos-service.js（Node 22，env 全量直通）
 *
 * 职责（主代理 ↔ 推送链路桥接）：
 *   1. POST /wake —— 受信方（主代理/定时任务）请求「唤醒」前端设备：
 *      校验 X-Wake-Token == WAKE_BRIDGE_TOKEN 后，把消息转发到
 *      INSTANT_PUSH_URL 的 POST /instant-chat（instant-push 负责推送回设备，
 *      可触发角色即时回复）。请求体原样透传，message 可在此注入。
 *   2. GET /  —— 健康检查（服务名/版本/转发目标存在性，不回显密钥）。
 *   3. POST /relay —— 通用白名单转发：body { to: 'instant-push' | 'proactive-push',
 *      path, payload }，仅允许转发到本机 8831/8833 两个内部端口。
 */
'use strict';

// CORS 契约（见 docs/superpowers/specs/2026-09-11-cors-unification-design.md）：
// 预检净化回显浏览器声明的请求头/方法，新头零配置放行；单文件内联以保持可整份复制部署。
const CORS_BASE_HEADERS = 'Content-Type, Authorization, X-Wake-Token, X-Client-Token, Accept';
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

function checkWakeToken(req, env) {
  const expected = (env.WAKE_BRIDGE_TOKEN || '').trim();
  if (!expected) return null; // 未配置令牌 = 开发模式放行
  const header = req.headers.get('x-wake-token') || '';
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (header === expected || bearer === expected) return null;
  return json({ error: 'unauthorized', hint: 'X-Wake-Token required' }, 403);
}

function internalBase(env, key, fallback) {
  return (env[key] || fallback).replace(/\/+$/, '');
}

async function forward(target, path, payload, env) {
  const res = await fetch(`${target}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(env.AMSG_CLIENT_TOKEN ? { 'x-client-token': env.AMSG_CLIENT_TOKEN } : {}),
      'user-agent': 'sullyos-wake-bridge',
    },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: await res.text().catch(() => '') };
}

async function handleWake(req, env) {
  let body;
  try { body = await req.json(); } catch { return json({ error: 'invalid json' }, 400); }
  const message = String((body && body.message) || '').trim();
  const title = String((body && body.title) || '').trim();
  const instant = internalBase(env, 'INSTANT_PUSH_URL', 'http://127.0.0.1:8831');
  const payload = { ...body };
  if (message || title) {
    payload.message = title ? `${title}\n${message}` : message;
  }
  delete payload.title;
  const out = await forward(instant, '/instant-chat', payload, env);
  return json({
    ok: out.status >= 200 && out.status < 300,
    status: out.status,
    via: 'instant-push',
    detail: out.body.slice(0, 300),
  }, out.status >= 200 && out.status < 300 ? 200 : 502);
}

async function handleRelay(req, env) {
  let body;
  try { body = await req.json(); } catch { return json({ error: 'invalid json' }, 400); }
  const to = String((body && body.to) || '').trim();
  const path = String((body && body.path) || '/').trim();
  const payload = (body && body.payload) || {};
  const targets = {
    'instant-push': internalBase(env, 'INSTANT_PUSH_URL', 'http://127.0.0.1:8831'),
    'proactive-push': internalBase(env, 'PROACTIVE_PUSH_URL', 'http://127.0.0.1:8833'),
  };
  const target = targets[to];
  if (!target) return json({ error: 'to must be instant-push | proactive-push' }, 400);
  if (!path.startsWith('/')) return json({ error: 'path must start with /' }, 400);
  const out = await forward(target, path, payload, env);
  return json({ ok: out.status >= 200 && out.status < 300, status: out.status, detail: out.body.slice(0, 300) });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/wake-bridge(?=\/|$)/, '') || '/';

    if (request.method === 'OPTIONS') return corsPreflight(request);

    if (path === '/health' || path === '/') {
      return json({
        ok: true,
        service: 'wake-bridge',
        version: '1.0.0',
        instantPushConfigured: !!env.INSTANT_PUSH_URL,
        proactivePushConfigured: !!env.PROACTIVE_PUSH_URL,
        time: new Date().toISOString(),
      });
    }

    const authFail = checkWakeToken(request, env);
    if (authFail) return authFail;

    if (path === '/wake' && request.method === 'POST') return handleWake(request, env);
    if (path === '/relay' && request.method === 'POST') return handleRelay(request, env);

    return json({ error: 'not_found', path }, 404);
  },
};