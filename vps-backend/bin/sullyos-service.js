#!/usr/bin/env node
/**
 * SullyOS VPS · 单服务运行器（Cloudflare Worker → Node 宿主桥）。
 *
 * 用法：
 *   node bin/sullyos-service.js --service instant-push
 *   node bin/sullyos-service.js --service instant-push --port 8831 --host 127.0.0.1
 *
 * 职责链：
 *   1. 加载 .env（/opt/sullyos/.env 优先，其次工程根 .env）——见 src/shim/env.js
 *   2. 通过 data: URL 动态 import 加载 worker.bundle.js（强制 ESM）——见 src/shim/bundle-loader.js
 *   3. 构造 CF 兼容 env：全量 vars 直通 + 可选 D1（better-sqlite3 适配器）绑定
 *   4. 内置 HTTP 服务器：每请求 → worker.fetch(request, env, ctx)，响应流式回写（SSE 友好）
 *   5. node-cron → worker.scheduled(event, env)，替代 CF Cron Triggers
 *   6. SIGTERM/SIGINT 优雅退出（drain ctx → 关 cron → 关 DB → 关 HTTP）
 */

import http from 'node:http';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

import { loadEnvFile, resolveEnvFilePath } from '../src/shim/env.js';
import { createLogger } from '../src/shim/logger.js';
import { createCfContext } from '../src/shim/cf-context.js';
import { loadWorkerBundle } from '../src/shim/bundle-loader.js';
import { createD1Adapter } from '../src/shim/d1.js';
import { CronRegistry } from '../src/shim/cron.js';
import { getService } from '../config/services.js';

// ── 参数解析 ─────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { service: process.env.SULLYOS_SERVICE ?? null, port: null, host: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--service' && argv[i + 1]) out.service = argv[++i];
    else if (a.startsWith('--service=')) out.service = a.slice('--service='.length);
    else if (a === '--port' && argv[i + 1]) out.port = Number(argv[++i]);
    else if (a.startsWith('--port=')) out.port = Number(a.slice('--port='.length));
    else if (a === '--host' && argv[i + 1]) out.host = argv[++i];
    else if (a.startsWith('--host=')) out.host = a.slice('--host='.length);
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

// ── 主流程 ───────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.service) {
    console.log('用法: node bin/sullyos-service.js --service <name> [--port N] [--host 127.0.0.1]');
    process.exit(args.help ? 0 : 2);
  }

  // 1) env 必须在 import manifest 之后、构造 cfEnv 之前加载
  const envPath = resolveEnvFilePath();
  loadEnvFile(envPath);

  const svc = getService(args.service);
  const host = args.host ?? process.env.HOST ?? '127.0.0.1';
  const port = args.port ?? svc.port;

  const log = createLogger(svc.name);

  // 2) 加载 bundle
  if (!svc.bundle || !existsSync(svc.bundle)) {
    throw new Error(
      `[${svc.name}] bundle 不存在: ${svc.bundle ?? '(未配置)'}\n` +
        (svc.enabled ? '该服务尚未移植到 VPS，请先在 config/services.js 中确认。' : '该服务未随 run-all 启动（enabled=false）。'),
    );
  }
  log.info(`加载 bundle: ${svc.bundle}`);
  const { worker } = await loadWorkerBundle(svc.bundle);

  // 3) 构造 CF 兼容 env：全量 vars 直通（Worker 按需取用），DB 单独绑定
  const cfEnv = { ...process.env };
  delete cfEnv.DB;
  // 宿主自报：VPS 兼容层托管的 worker 都没有 DO（定时任务由 node-cron 兜底）。
  // amsg 的 /config-check 把它转发成 runtime 字段，前端据此按 VPS 模式放行即时对话。
  cfEnv.SULLYOS_RUNTIME = 'vps';

  let dbAdapter = null;
  let dbBound = false;
  if (svc.db && (svc.db.enableIf ?? (() => true))(process.env)) {
    const dbPath = path.resolve(process.env[svc.db.pathEnv] || svc.db.defaultPath);
    try {
      dbAdapter = createD1Adapter(dbPath);
      // schema 初始化：worker 依赖的建表语句（等价 CF 的 wrangler d1 migrations）
      if (svc.db.schemaPath && existsSync(svc.db.schemaPath)) {
        const { readFileSync } = await import('node:fs');
        await dbAdapter.exec(readFileSync(svc.db.schemaPath, 'utf8'));
        log.info(`schema 已应用: ${svc.db.schemaPath}`);
      }
      cfEnv[svc.db.bindKey] = dbAdapter;
      dbBound = true;
      log.info(`D1 已绑定（better-sqlite3）: ${dbPath}`);
    } catch (err) {
      // 与 CF「未绑定 D1」语义一致：Worker 内部应自行回退（如 multipart）
      log.warn(`D1 绑定失败，按未绑定处理: ${err.message}`);
    }
  }

  // 4) Cron 注册（替代 CF Cron Triggers）
  let cronReg = null;
  if (typeof worker.scheduled === 'function' && (svc.crons ?? []).length > 0) {
    cronReg = new CronRegistry();
    for (const c of svc.crons) {
      // 修复：CF scheduled 签名是 (event, env, ctx)，ctx.waitUntil 是后台任务钩子。
      // 此前漏传第三参数，worker 内 ctx.waitUntil(...) 直接 TypeError。
      cronReg.add(c.expr, () => {
        const { ctx } = createCfContext({ onError: (e) => log.error('waitUntil 任务失败:', e) });
        return worker.scheduled({ cron: c.expr, scheduledTime: new Date() }, cfEnv, ctx);
      }, { name: c.name });
    }
    cronReg.start();
    log.info(`已注册 ${svc.crons.length} 个 cron: ${svc.crons.map((c) => c.expr).join(', ')}`);
  }

  // 5) HTTP 服务器
  const server = http.createServer(async (req, res) => {
    const startedAt = Date.now();
    try {
      const hostHeader = req.headers.host || `${host}:${port}`;
      const url = new URL(req.url ?? '/', `http://${hostHeader}`);

      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (v === undefined) continue;
        if (Array.isArray(v)) for (const x of v) headers.append(k, x);
        else headers.append(k, v);
      }

      const method = (req.method ?? 'GET').toUpperCase();
      let body;
      if (method !== 'GET' && method !== 'HEAD') {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        body = Buffer.concat(chunks);
      }

      const init = { method, headers };
      if (body && body.length > 0) init.body = body;
      const request = new Request(url, init);

      const { ctx, drain } = createCfContext({ onError: (e) => log.error('waitUntil 任务失败:', e) });
      const resp = await worker.fetch(request, cfEnv, ctx);

      const outHeaders = {};
      for (const [k, v] of resp.headers) {
        if (['transfer-encoding', 'connection', 'keep-alive', 'content-length'].includes(k.toLowerCase())) continue;
        outHeaders[k] = v;
      }
      res.writeHead(resp.status ?? 200, outHeaders);

      if (resp.body) {
        await pipeline(Readable.fromWeb(resp.body), res); // 流式回写，SSE 不缓冲
      } else {
        res.end();
      }
      await drain();
      log.debug(`${method} ${url.pathname} → ${resp.status} (${Date.now() - startedAt}ms)`);
    } catch (err) {
      log.error(`请求处理失败: ${req.method} ${req.url} —`, err);
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'internal_error', detail: String(err?.message ?? err) }));
      } else {
        res.end();
      }
    }
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      log.error(`端口 ${port} 被占用，启动失败: ${err.message}`);
      process.exit(3);
    }
    throw err;
  });

  await new Promise((resolve) => server.listen(port, host, resolve));
  log.info(`✔ ${svc.name} 已启动: http://${host}:${port}${dbBound ? '（D1 已绑定）' : ''}`);

  // 6) 优雅退出
  let shuttingDown = false;
  async function shutdown(sig) {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`收到 ${sig}，优雅退出中…`);
    cronReg?.stop();
    await new Promise((resolve) => server.close(resolve)).catch(() => {});
    dbAdapter?.close?.();
    log.info('已退出');
    process.exit(0);
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[sullyos-service] 启动失败:', err);
  process.exit(1);
});