/**
 * SullyOS VPS 后端 · 服务清单（端口矩阵唯一事实来源）。
 *
 * 每个服务两种宿主形态：
 *  - bundle 存在  → bin/sullyos-service.js 以「Cloudflare 兼容层」托管 worker.bundle.js；
 *  - bundle 不存在 → run-all 打印跳过原因（尚未移植）。
 *
 * 端口矩阵（与 /opt/sullyos/.env、deploy/caddy/SullyOS.Caddyfile 三处保持一致）：
 *   main-agent      8830   主代理（LLM 多供应商 + MCP 循环重构版）
 *   instant-push    8831   Step 1 里程碑（本文件当前唯一 enabled）
 *   amsg            8832   定时消息（AES-GCM）
 *   proactive-push  8833   主动消息
 *   wake-bridge     8834   唤醒桥
 *   heartbeat       8835   心跳
 *
 * 所有服务仅监听 127.0.0.1，由 Caddy 统一反代 80/443（自动 HTTPS）。
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** 仓库根目录（vps-backend 的上一级）。 */
export const repoRoot = path.resolve(here, '../..');

/** vps-backend 数据目录（sqlite 落盘位置）。 */
export const dataDir = path.resolve(here, '../data');

/**
 * @typedef {object} ServiceDef
 * @property {string} name        服务名（进程名 / --service 参数）
 * @property {number} port        监听端口
 * @property {boolean} enabled    是否随 run-all 启动
 * @property {string} [bundle]    worker.bundle.js 绝对路径
 * @property {string[]} [envKeys] 直通给 Worker 的环境变量（文档用途；实际为全量直通 + DB 单独绑定）
 * @property {{bindKey:string, pathEnv?:string, defaultPath:string, enableIf?: (p:NodeJS.ProcessEnv)=>boolean}} [db]
 * @property {{expr:string, name?:string}[]} [crons]
 */

/** @type {ServiceDef[]} */
export const services = [
  {
    name: 'main-agent',
    port: 8830,
    enabled: false, // Step 3：MCP 循环重构（MAX_LOOPS=12、参考类工具钉住）落地后开启
    bundle: path.join(repoRoot, 'worker/main-agent/worker.bundle.js'),
    envKeys: [
      'LLM_BASE_URL', 'LLM_API_KEY', 'LLM_MODEL', 'LLM_FALLBACKS',
      'LLM_TIMEOUT_MS', 'MCP_MAX_LOOPS', 'AMSG_CLIENT_TOKEN',
      'INSTANT_PUSH_URL', 'AMSG_URL', 'PROACTIVE_PUSH_URL',
    ],
    crons: [],
  },
  {
    name: 'instant-push',
    port: 8831,
    enabled: true, // ★ Step 1 里程碑
    bundle: path.join(repoRoot, 'worker/instant-push/worker.bundle.js'),
    envKeys: [
      'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_EMAIL',
      'AMSG_CLIENT_TOKEN', 'AMSG_OVERSIZE_TRANSPORT', 'AMSG_ENABLE_D1_BLOBSTORE',
    ],
    // D1 BlobStore 可选：仅当 AMSG_ENABLE_D1_BLOBSTORE=true 才创建 better-sqlite3 适配器；
    // 缺省 multipart 模式完全不需要 DB（与 CF 行为一致：无绑定 → 优雅回退）。
    db: {
      bindKey: 'DB',
      pathEnv: 'AMSG_DB_PATH',
      defaultPath: path.join(dataDir, 'instant-push.sqlite'),
      enableIf: (p) => p.AMSG_ENABLE_D1_BLOBSTORE === 'true',
    },
    crons: [
      // 原 CF 面板上的 scheduled trigger：D1 过期 blob 清理（未启用 D1 时为空操作，安全）
      { expr: '0 * * * *', name: 'd1-blob-sweeper' },
    ],
  },
  {
    name: 'amsg',
    port: 8832,
    enabled: false, // Step 2：确认其 bundle 依赖面后开启
    bundle: path.join(repoRoot, 'worker/amsg/worker.bundle.js'),
    envKeys: ['AMSG_SECRET_KEY', 'AMSG_DB_PATH', 'AMSG_CLIENT_TOKEN'],
    db: {
      bindKey: 'DB',
      pathEnv: 'AMSG_DB_PATH',
      defaultPath: path.join(dataDir, 'amsg.sqlite'),
      enableIf: () => true,
    },
    crons: [{ expr: '* * * * *', name: 'amsg-due-check' }],
  },
  {
    name: 'proactive-push',
    port: 8833,
    enabled: false, // Step 2
    bundle: path.join(repoRoot, 'worker/proactive-push/worker.bundle.js'),
    envKeys: ['AMSG_CLIENT_TOKEN', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_EMAIL'],
    db: {
      bindKey: 'DB',
      pathEnv: 'AMSG_DB_PATH',
      defaultPath: path.join(dataDir, 'proactive-push.sqlite'),
      enableIf: () => true,
    },
    crons: [{ expr: '*/5 * * * *', name: 'proactive-sweep' }],
  },
  {
    name: 'wake-bridge',
    port: 8834,
    enabled: false, // Step 3（主代理联动）
    bundle: path.join(repoRoot, 'worker/wake-bridge/worker.bundle.js'),
    envKeys: ['WAKE_BRIDGE_TOKEN'],
    crons: [],
  },
  {
    name: 'heartbeat',
    port: 8835,
    enabled: false, // Step 3
    bundle: path.join(repoRoot, 'worker/heartbeat/worker.bundle.js'),
    envKeys: ['AMSG_CLIENT_TOKEN', 'HEARTBEAT_INTERVAL_SEC'],
    db: {
      bindKey: 'DB',
      pathEnv: 'AMSG_DB_PATH',
      defaultPath: path.join(dataDir, 'heartbeat.sqlite'),
      enableIf: () => true,
    },
    crons: [{ expr: '*/1 * * * *', name: 'heartbeat-ping' }],
  },
];

/** @param {string} name */
export function getService(name) {
  const svc = services.find((s) => s.name === name);
  if (!svc) throw new Error(`未知服务: ${name}（可选: ${services.map((s) => s.name).join(', ')}）`);
  return svc;
}
