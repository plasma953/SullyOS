/**
 * SullyOS main-agent — VPS 单文件 Worker bundle（手写，不经 esbuild）。
 *
 * 部署：cp src/index.js worker.bundle.js（bundle 为宿主加载的产物）。
 * 宿主：vps-backend/bin/sullyos-service.js（Node 22，全量 env 直通 + SSE 流式回写）。
 *
 * 职责：
 *   1. POST /v1/chat/completions —— OpenAI 兼容 SSE 聊天端点（stream 默认 true）；
 *      内部执行 MCP 工具循环：LLM tool_calls → MCP tools/call → 结果回填，
 *      直到无工具调用或达到 MCP_MAX_LOOPS（默认 12）。
 *   2. 多供应商 fallback：LLM_BASE_URL 主供应商 + LLM_FALLBACKS JSON 数组，按序切换。
 *   3. 参考类工具钉住：MCP_PINNED_TOOLS（逗号分隔工具名）从第 2 轮起始终携带，
 *      其余工具仅首轮下发（省上下文）。
 *   4. GET /v1/tools —— 汇总全部 MCP 工具清单。
 *   5. /webdav/* —— dufs（本机 WebDAV）认证注入中转，供代理调用备份文件。
 *   6. 严格鉴权：X-Client-Token（或 Authorization: Bearer）== AMSG_CLIENT_TOKEN。
 */
'use strict';

const DONE_MARKER = '[DONE]';

// ─────────────────────── 基础工具 ───────────────────────
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'Content-Type, Authorization, X-Client-Token',
      'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS, PROPFIND, MKCOL',
    },
  });
}

function corsPreflight() {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'Content-Type, Authorization, X-Client-Token, Depth',
      'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS, PROPFIND, MKCOL',
      'access-control-max-age': '86400',
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

function getJsonEnv(env, key, fallback) {
  const raw = (env?.[key] || '').trim();
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

// ─────────────────────── LLM 供应商 ───────────────────────
function providersOf(env) {
  const out = [];
  const primary = {
    baseUrl: (env.LLM_BASE_URL || '').trim(),
    apiKey: (env.LLM_API_KEY || '').trim(),
    model: (env.LLM_MODEL || '').trim(),
  };
  if (primary.baseUrl && primary.model) out.push(primary);
  const fbs = getJsonEnv(env, 'LLM_FALLBACKS', []);
  if (Array.isArray(fbs)) {
    for (const f of fbs) {
      if (f && f.baseUrl && f.model) {
        out.push({ baseUrl: String(f.baseUrl), apiKey: String(f.apiKey || ''), model: String(f.model) });
      }
    }
  }
  return out;
}

// ─────────────────────── MCP 客户端（streamable HTTP）───────────────────────
function mcpServersOf(env) {
  const list = getJsonEnv(env, 'MCP_SERVERS', []);
  if (!Array.isArray(list)) return [];
  return list
    .filter((s) => s && s.url)
    .map((s) => ({
      name: s.name || (() => { try { return new URL(s.url).hostname; } catch { return s.url; } })(),
      url: s.url,
      token: s.token || '',
      sessionId: null,
      tools: null,
    }));
}

function parseMcpResponse(text) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{')) {
    try { return JSON.parse(trimmed); } catch { /* fallthrough to SSE */ }
  }
  let last = null;
  for (const line of trimmed.split(/\r?\n/)) {
    const m = line.match(/^data:\s*(.*)$/);
    if (!m) continue;
    try {
      const parsed = JSON.parse(m[1]);
      if (parsed && (parsed.result !== undefined || parsed.error !== undefined)) last = parsed;
    } catch { /* 跳过非 JSON data 行 */ }
  }
  return last;
}

async function mcpPost(server, method, params) {
  const headers = {
    'content-type': 'application/json',
    'accept': 'application/json, text/event-stream',
  };
  if (server.token) headers['authorization'] = `Bearer ${server.token}`;
  if (server.sessionId) headers['mcp-session-id'] = server.sessionId;
  const res = await fetch(server.url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: (crypto.randomUUID && crypto.randomUUID()) || String(Date.now()) + Math.random(),
      method,
      params,
    }),
  });
  const sid = res.headers.get('mcp-session-id');
  if (sid) server.sessionId = sid;
  const text = await res.text();
  const parsed = parseMcpResponse(text);
  if (!res.ok) {
    // 会话被服务端回收 → 下次调用自动重新 initialize
    if (res.status === 404) server.sessionId = null;
    throw new Error(`MCP ${server.name} ${method} → HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  if (parsed && parsed.error) {
    if (String(parsed.error.message || '').toLowerCase().includes('session')) server.sessionId = null;
    throw new Error(`MCP ${server.name} ${method} → ${parsed.error.message || JSON.stringify(parsed.error)}`);
  }
  return parsed ? parsed.result : null;
}

async function ensureSession(server) {
  if (!server.sessionId) {
    await mcpPost(server, 'initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'sullyos-main-agent', version: '1.0.0' },
    });
  }
}

async function serverTools(server) {
  if (server.tools) return server.tools;
  await ensureSession(server);
  const res = await mcpPost(server, 'tools/list', {});
  server.tools = Array.isArray(res && res.tools) ? res.tools : [];
  return server.tools;
}

async function callMcpTool(server, toolName, args) {
  await ensureSession(server);
  return mcpPost(server, 'tools/call', { name: toolName, arguments: args ?? {} });
}

// ─────────────────────── 内置工具 ───────────────────────
const BUILTIN_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'time_now',
      description: '返回当前 UTC 时间与 Unix 毫秒时间戳（无需参数）。',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
];

async function callBuiltin(name) {
  if (name === 'time_now') {
    return { utc: new Date().toISOString(), unixMs: Date.now() };
  }
  return { error: `unknown builtin tool: ${name}` };
}

// ─────────────────────── LLM 流式调用 ───────────────────────
async function llmStream(provider, messages, tools, timeoutMs, emitText) {
  const url = `${provider.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 120000);
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(provider.apiKey ? { authorization: `Bearer ${provider.apiKey}` } : {}),
        accept: 'text/event-stream',
      },
      body: JSON.stringify({
        model: provider.model,
        messages,
        tools: tools && tools.length ? tools : undefined,
        stream: true,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    throw new Error(`LLM 连接失败 (${provider.baseUrl}): ${err.message}`);
  }
  if (!res.ok || !res.body) {
    clearTimeout(timer);
    const body = await res.text().catch(() => '');
    throw new Error(`LLM HTTP ${res.status} (${provider.baseUrl}): ${body.slice(0, 300)}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const acc = { text: '', toolCalls: [], finishReason: null };
  const tcMap = new Map();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === DONE_MARKER) { acc.finishReason = acc.finishReason || 'stop'; continue; }
        let chunk;
        try { chunk = JSON.parse(data); } catch { continue; }
        const choice = chunk && chunk.choices && chunk.choices[0];
        if (!choice) continue;
        const delta = choice.delta || {};
        if (typeof delta.content === 'string' && delta.content) {
          acc.text += delta.content;
          if (emitText) emitText(delta.content);
        }
        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const i = tc.index ?? 0;
            const slot = tcMap.get(i) || { id: '', name: '', arguments: '' };
            if (tc.id) slot.id = tc.id;
            if (tc.function && tc.function.name) slot.name += tc.function.name;
            if (tc.function && tc.function.arguments) slot.arguments += tc.function.arguments;
            tcMap.set(i, slot);
          }
        }
        if (choice.finish_reason) acc.finishReason = choice.finish_reason;
      }
    }
  } finally {
    clearTimeout(timer);
    try { reader.cancel(); } catch { /* 忽略 */ }
  }
  acc.toolCalls = [...tcMap.values()].map((tc) => {
    let args = {};
    try { args = tc.arguments ? JSON.parse(tc.arguments) : {}; } catch { args = { _raw: tc.arguments }; }
    return { id: tc.id || `call_${Math.random().toString(36).slice(2)}`, name: tc.name, arguments: args };
  });
  return acc;
}

// ─────────────────────── SSE 输出 ───────────────────────
function makeSse() {
  const encoder = new TextEncoder();
  let controller;
  const stream = new ReadableStream({ start(c) { controller = c; } });
  const send = (event, data) => {
    try {
      let payload = '';
      if (event && event !== 'message') payload += `event: ${event}\n`;
      const lines = String(data).split(/\r?\n/);
      for (const line of lines) payload += `data: ${line}\n`;
      payload += '\n';
      controller.enqueue(encoder.encode(payload));
    } catch { /* 客户端断开 */ }
  };
  const close = () => { try { controller.close(); } catch { /* 已关闭 */ } };
  return { stream, send, close };
}

// ─────────────────────── Agent 循环（核心）───────────────────────
async function runAgentLoop(env, messages, emit) {
  const maxLoops = Math.max(1, parseInt(env.MCP_MAX_LOOPS || '12', 10) || 12);
  const providers = providersOf(env);
  if (providers.length === 0) {
    throw new Error('未配置 LLM 供应商（LLM_BASE_URL + LLM_MODEL 或 LLM_FALLBACKS 均为空）');
  }
  const servers = mcpServersOf(env);
  const pinnedRaw = (env.MCP_PINNED_TOOLS || '').split(',').map((s) => s.trim()).filter(Boolean);

  // 收集工具：内置 + 各 MCP 服务器（逐个容错）
  //   collected  —— 按 name 分发的注册表（含 server/builtin 标记）
  //   openaiTools —— 发给 LLM 的 OpenAI functions 格式清单
  const collected = [];
  const openaiTools = [];
  const toolErrors = [];
  for (const b of BUILTIN_TOOLS) {
    collected.push({ name: b.function.name, builtin: true });
    openaiTools.push(b);
  }
  for (const srv of servers) {
    try {
      const tools = await serverTools(srv);
      for (const t of tools) {
        collected.push({ name: t.name, server: srv });
        openaiTools.push({
          type: 'function',
          function: {
            name: t.name,
            description: t.description || '',
            parameters: t.inputSchema || { type: 'object', properties: {} },
          },
        });
      }
    } catch (e) {
      toolErrors.push({ server: srv.name, error: String(e.message || e) });
    }
  }
  const byName = new Map(collected.map((c) => [c.name, c]));
  // 钉住工具（参考类）：第 2 轮起仍携带；其余工具仅首轮
  const pinnedNames = new Set(pinnedRaw);
  const stats = { loops: 0, toolCalls: 0, maxLoops, toolErrors, servers: servers.map((s) => s.name) };
  const timeoutMs = parseInt(env.LLM_TIMEOUT_MS || '120000', 10) || 120000;
  let providerIdx = 0;

  for (let loop = 0; loop < maxLoops; loop++) {
    stats.loops = loop + 1;
    const toolsThisTurn = loop === 0 ? openaiTools : openaiTools.filter((t) => pinnedNames.has(t.function.name));

    // 供应商 fallback 重试
    let outcome = null;
    let attempts = 0;
    while (attempts < providers.length) {
      const provider = providers[providerIdx % providers.length];
      try {
        outcome = await llmStream(provider, messages, toolsThisTurn, timeoutMs, (txt) => emit({ type: 'delta', content: txt }));
        break;
      } catch (err) {
        attempts++;
        providerIdx = (providerIdx + 1) % providers.length;
        emit({ type: 'system', content: `LLM 供应商切换：${String(err.message).slice(0, 160)}` });
      }
    }
    if (!outcome) throw new Error('全部 LLM 供应商不可用');

    const assistantMsg = { role: 'assistant', content: outcome.text || null };
    if (outcome.toolCalls.length) {
      assistantMsg.tool_calls = outcome.toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
      }));
    }
    messages.push(assistantMsg);

    if (!outcome.toolCalls.length) {
      emit({ type: 'done', stats, finishReason: outcome.finishReason || 'stop' });
      return { messages, stats };
    }

    for (const tc of outcome.toolCalls) {
      const entry = byName.get(tc.name);
      emit({ type: 'tool_call', name: tc.name, server: (entry && entry.server && entry.server.name) || 'builtin', arguments: tc.arguments });
      let result;
      try {
        if (!entry) result = { error: `未知工具: ${tc.name}` };
        else if (entry.builtin) result = await callBuiltin(tc.name, tc.arguments);
        else result = await callMcpTool(entry.server, tc.name, tc.arguments);
        stats.toolCalls++;
      } catch (e) {
        result = { error: String(e.message || e) };
      }
      const content = JSON.stringify(result).slice(0, 20000);
      messages.push({ role: 'tool', tool_call_id: tc.id, content });
      emit({ type: 'tool_result', name: tc.name, ok: !(result && result.error), preview: content.slice(0, 300) });
    }
  }
  emit({ type: 'done', stats, finishReason: 'max_loops', note: `达到 MCP_MAX_LOOPS=${maxLoops} 上限` });
  return { messages, stats };
}

// ─────────────────────── WebDAV (dufs) 认证注入中转 ───────────────────────
async function webdavProxy(req, env, pathSuffix) {
  const auth = (env.DUFS_AUTH || '').trim();
  if (!auth) return json({ error: 'dufs 未配置（DUFS_AUTH 为空）' }, 503);
  const port = env.DUFS_PORT || '8890';
  const target = `http://127.0.0.1:${port}/${pathSuffix}`;
  const headers = new Headers();
  for (const [k, v] of req.headers) {
    if (['host', 'authorization', 'content-length', 'transfer-encoding', 'connection', 'x-client-token'].includes(k.toLowerCase())) continue;
    headers.set(k, v);
  }
  headers.set('authorization', `Basic ${btoa(auth)}`);
  let res;
  try {
    res = await fetch(target, {
      method: req.method,
      headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : await req.arrayBuffer(),
    });
  } catch (err) {
    return json({ error: `dufs 不可达: ${err.message}` }, 502);
  }
  const out = new Headers(res.headers);
  out.set('access-control-allow-origin', '*');
  out.set('access-control-expose-headers', '*');
  return new Response(res.body, { status: res.status, headers: out });
}

// ─────────────────────── 处理器 ───────────────────────
async function handleChat(req, env) {
  let body;
  try { body = await req.json(); } catch { return json({ error: 'invalid json' }, 400); }
  const messages = Array.isArray(body && body.messages) ? body.messages : null;
  if (!messages || messages.length === 0) return json({ error: 'messages required' }, 400);
  const stream = body.stream !== false;

  if (!stream) {
    const out = { text: '' };
    const res = await runAgentLoop(env, [...messages], (ev) => {
      if (ev.type === 'delta') out.text += ev.content;
    });
    return json({
      id: `chatcmpl-${Date.now().toString(36)}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: (env.LLM_MODEL || 'sullyos-main-agent'),
      choices: [{ index: 0, message: { role: 'assistant', content: out.text }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      _meta: { stats: res.stats },
    });
  }

  const sse = makeSse();
  const chatId = `chatcmpl-${Date.now().toString(36)}`;
  runAgentLoop(env, [...messages], (ev) => {
    if (ev.type === 'delta') {
      sse.send('message', JSON.stringify({
        id: chatId, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000),
        model: env.LLM_MODEL || 'sullyos-main-agent',
        choices: [{ index: 0, delta: { content: ev.content }, finish_reason: null }],
      }));
    } else if (ev.type === 'tool_call') {
      sse.send('tool_call', JSON.stringify({ id: chatId, name: ev.name, server: ev.server, arguments: ev.arguments }));
    } else if (ev.type === 'tool_result') {
      sse.send('tool_result', JSON.stringify({ name: ev.name, ok: ev.ok, preview: ev.preview }));
    } else if (ev.type === 'system') {
      sse.send('system', JSON.stringify({ content: ev.content }));
    } else if (ev.type === 'done') {
      sse.send('done', JSON.stringify({ stats: ev.stats, finishReason: ev.finishReason, note: ev.note || null }));
      sse.send('message', DONE_MARKER);
      sse.close();
    }
  }).catch((err) => {
    try { sse.send('error', JSON.stringify({ error: String(err.message || err) })); } catch { /* 忽略 */ }
    try { sse.close(); } catch { /* 忽略 */ }
  });
  return new Response(sse.stream, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'connection': 'keep-alive',
      'x-accel-buffering': 'no',
      'access-control-allow-origin': '*',
    },
  });
}

async function handleToolsList(env) {
  const collected = [];
  const errors = [];
  for (const b of BUILTIN_TOOLS) {
    collected.push({ name: b.function.name, server: 'builtin', description: b.function.description, inputSchema: b.function.parameters });
  }
  for (const srv of mcpServersOf(env)) {
    try {
      const tools = await serverTools(srv);
      for (const t of tools) {
        collected.push({ name: t.name, server: srv.name, description: t.description || '', inputSchema: t.inputSchema || null });
      }
    } catch (e) {
      errors.push({ server: srv.name, error: String(e.message || e) });
    }
  }
  return json({ ok: true, tools: collected, errors });
}

// ─────────────────────── 路由 ───────────────────────
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    let path = url.pathname;
    // Caddy /agent/* 会剥前缀；同时兼容裸路径与带前缀路径
    const plain = path.replace(/^\/agent(?=\/|$)/, '') || '/';

    if (request.method === 'OPTIONS') return corsPreflight();

    if (plain === '/health' || plain === '/') {
      const providers = providersOf(env);
      return json({
        ok: true,
        service: 'main-agent',
        version: '1.0.0',
        llmConfigured: providers.length > 0,
        providers: providers.length,
        mcpServers: mcpServersOf(env).map((s) => s.name),
        mcpMaxLoops: parseInt(env.MCP_MAX_LOOPS || '12', 10) || 12,
        time: new Date().toISOString(),
      });
    }

    const authFail = checkAuth(request, env);
    if (authFail) return authFail;

    if (plain === '/v1/chat/completions') return handleChat(request, env);
    if (plain === '/v1/tools') return handleToolsList(env);

    if (plain.startsWith('/webdav')) {
      const suffix = plain.replace(/^\/webdav\/?/, '');
      return webdavProxy(request, env, suffix);
    }

    return json({ error: 'not_found', path }, 404);
  },
};
