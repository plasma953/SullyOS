#!/usr/bin/env node
/**
 * SullyOS VPS · 全服务编排入口。
 *
 * 按 config/services.js 清单 fork 各服务进程（node bin/sullyos-service.js --service X）。
 * 进程级隔离：单个 worker 崩溃不影响其他模块；崩溃后指数退避自动重启。
 *
 * 用法：
 *   node bin/run-all.js                    # 启动全部 enabled 服务
 *   node bin/run-all.js --only instant-push,amsg
 *   node bin/run-all.js --list             # 只列清单，不启动
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

import { loadEnvFile, resolveEnvFilePath } from '../src/shim/env.js';
import { createLogger } from '../src/shim/logger.js';
import { services } from '../config/services.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const runner = path.join(here, 'sullyos-service.js');
const log = createLogger('run-all');

// ── 参数 ─────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { only: null, list: false };
  for (const a of argv) {
    if (a === '--list') out.list = true;
    else if (a === '--only' ) out.only = ''; // 下一个参数是列表
    else if (a.startsWith('--only=')) out.only = a.slice('--only='.length);
    else if (out.only === '' ) out.only = a;
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log('用法: node bin/run-all.js [--only a,b] [--list]');
  process.exit(0);
}

// env 先加载，子进程直接继承
const envPath = resolveEnvFilePath();
loadEnvFile(envPath);

// ── 挑选服务 ─────────────────────────────────────────────────
const only = args.only ? args.only.split(',').map((s) => s.trim()).filter(Boolean) : null;
const chosen = services.filter((s) => (only ? only.includes(s.name) : s.enabled));

if (args.list) {
  for (const s of services) {
    const state = s.enabled ? 'enabled' : 'disabled';
    const bundle = s.bundle && existsSync(s.bundle) ? 'bundle✓' : 'bundle✗';
    console.log(`  ${s.name.padEnd(15)} :${String(s.port).padEnd(6)} ${state.padEnd(9)} ${bundle}`);
  }
  process.exit(0);
}

if (chosen.length === 0) {
  log.warn('没有可启动的服务（全部 enabled=false 或 --only 未命中）。用 --list 查看清单。');
  process.exit(0);
}

// ── fork + 重启 ─────────────────────────────────────────────
/** @type {Map<string, {proc:any, restarts:number, backoff:number}>} */
const children = new Map();

function startService(svc) {
  const st = children.get(svc.name) ?? { restarts: 0, backoff: 1000, proc: null };
  children.set(svc.name, st);

  if (!svc.bundle || !existsSync(svc.bundle)) {
    log.warn(`[${svc.name}] bundle 不存在（${svc.bundle ?? '未配置'}）——跳过。该模块尚未移植。`);
    return;
  }

  log.info(`[${svc.name}] 启动（端口 ${svc.port}）…`);
  const proc = spawn(process.execPath, [runner, '--service', svc.name], {
    stdio: 'inherit',
    env: { ...process.env, SULLYOS_SERVICE: svc.name },
  });
  st.proc = proc;

  proc.on('exit', (code, signal) => {
    if (shuttingDown) return;
    st.restarts += 1;
    const delay = Math.min(st.backoff * 2 ** Math.min(st.restarts - 1, 5), 30000);
    log.error(`[${svc.name}] 退出（code=${code} signal=${signal}），${delay}ms 后第 ${st.restarts} 次重启`);
    setTimeout(() => startService(svc), delay).unref();
  });
}

let shuttingDown = false;
async function shutdown(sig) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info(`收到 ${sig}，向所有子服务发送 SIGTERM…`);
  for (const [, st] of children) {
    if (st.proc && !st.proc.killed) st.proc.kill('SIGTERM');
  }
  setTimeout(() => {
    for (const [, st] of children) {
      if (st.proc && !st.proc.killed) st.proc.kill('SIGKILL');
    }
    process.exit(0);
  }, 8000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

log.info(`启动清单（${chosen.length} 个）: ${chosen.map((s) => s.name).join(', ')}`);
for (const svc of chosen) startService(svc);