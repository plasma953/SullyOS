# Worker 默认地址与来源白名单 · 执行计划（2026-09-12）

> 设计：`docs/superpowers/specs/2026-09-12-worker-default-origin-guard-design.md`。
> 本计划按「弱执行者」标准编写：每步有文件路径、定位、代码意图、验收命令与预期。
> 铁律：
> 1. `ALLOWED_ORIGINS` 未配置时中心 worker 行为零变化；
> 2. 真实域名只进 CF / Vercel 配置，不进仓库（包含测试与文档，一律用 example 域）；
> 3. 全程不触碰另一条线的塔罗文件：`apps/TarotApp.tsx`、`apps/tarot/*`、`plans/2026-09-11-tarot-*`。

## 0. 前提

- 分支必须是 `ethernet`；包管理器 `corepack pnpm@9.15.9`。
- 写文件只用工具，不用 shell 重定向；含中文的 oldString 只从 Read 输出逐字取。
- 门禁命令（收尾一起跑）：
  - 全量：`corepack pnpm@9.15.9 vitest run`（已知 storageOptimize / networkFailureDiagnosis 全量并发抖动，单跑能过即视为通过，汇报里写明）
  - 构建：`corepack pnpm@9.15.9 build:workers`
  - 类型：`corepack pnpm@9.15.9 exec tsc --noEmit`（判据：本次触碰文件零命中）
  - 乱码：`corepack pnpm@9.15.9 vitest run utils/mojibakeGuard.test.ts`

## 1. 前端：构建期默认地址

### Step 1.1 `vite.config.ts` 增加 define

- 定位：`define` 块（`__BUILD_BADGE_VISIBLE__` 之后）。
- 改法：加一行
  ```ts
  __PROXY_WORKER_URL__: JSON.stringify(process.env.VITE_PROXY_WORKER_URL || ''),
  ```
- 验收：`vite.config.ts` 中搜 `__PROXY_WORKER_URL__` 命中一行。

### Step 1.2 `vite-env.d.ts` 声明

- 在 `declare const __BUILD_BADGE_VISIBLE__: boolean;` 后加：
  ```ts
  declare const __PROXY_WORKER_URL__: string;
  ```

### Step 1.3 `utils/proxyWorker.ts` 默认值解析

- 定位：第 26 行 `export const DEFAULT_PROXY_WORKER = 'https://sullymeow.ccwu.cc';`。
- 改法：替换为
  ```ts
  /** 作者公共实例：构建期未注入 `VITE_PROXY_WORKER_URL` 时的默认值。 */
  export const FALLBACK_PROXY_WORKER = 'https://sullymeow.ccwu.cc';

  /**
   * 解析构建期注入的默认 Worker 地址（`VITE_PROXY_WORKER_URL` → `__PROXY_WORKER_URL__`）。
   * 非法值（非 http/https）回落作者公共实例。纯函数，单测直接覆盖。
   */
  export function resolveDefaultProxyWorker(envValue?: string): string {
    const url = String(envValue || '').trim().replace(/\/+$/, '');
    return /^https?:\/\//i.test(url) ? url : FALLBACK_PROXY_WORKER;
  }

  // 非浏览器运行时（amsg worker bundle 走 esbuild，没有该 define）：
  // typeof 读取未声明标识符是安全的，回落作者默认即可——后台地址由
  // setProxyWorkerUrlOverride() 在运行时注入。
  const injectedDefault = typeof __PROXY_WORKER_URL__ === 'string' ? __PROXY_WORKER_URL__ : '';
  export const DEFAULT_PROXY_WORKER = resolveDefaultProxyWorker(injectedDefault);
  ```
- 同时更新文件头注释第 17-19 行：补一句「部署者可通过构建环境变量 `VITE_PROXY_WORKER_URL` 让默认指向自建实例」。
- 验收：`utils/proxyWorker.test.ts` 全绿；`import.meta.env` 不受影响（本方案不用它）。

### Step 1.4 `utils/proxyWorker.test.ts` 增加用例

- 新 describe：`resolveDefaultProxyWorker（构建期默认地址）`
  - 合法 https 地址（带尾斜杠）→ 原样返回并去尾斜杠；
  - `http://` 地址接受；
  - 空 / 非法（`my-worker.example.com`）→ 回落 `FALLBACK_PROXY_WORKER`。
- 验收：`corepack pnpm@9.15.9 vitest run utils/proxyWorker.test.ts` 全绿。

## 2. 中心 worker：Origin 白名单

### Step 2.1 `worker/index.js` 入口校验

- 定位：`export default { async fetch(request, env, ctx) {`（2431 行起），在 `const origin = request.headers.get("Origin") || "*";`（2434 行）之后、`// CORS preflight`（2436 行）之前插入：
  ```js
  // Origin 白名单（可选，设计见 docs/superpowers/specs/2026-09-12-worker-default-origin-guard-design.md）：
  // env.ALLOWED_ORIGINS 逗号分隔；未配置 = 维持现状全开（公共实例/旧行为）。
  // 浏览器请求带 Origin 且不在名单 → 403 且不回 CORS 头；无 Origin（后台任务/curl）放行。
  const allowedOrigins = String((env && env.ALLOWED_ORIGINS) || "")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (allowedOrigins.length > 0 && origin !== "*" && !allowedOrigins.includes(origin.toLowerCase())) {
    return new Response(JSON.stringify({ error: "origin_not_allowed" }), {
      status: 403,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
  ```
- 验收：Step 2.2 测试全绿；`worker/corsContract.test.ts` 中心 worker 用例不受影响（该测试不带 env）。

### Step 2.2 新建 `worker/centerWorkerOrigin.test.ts`

- 覆盖矩阵：
  1. 名单内 Origin 的 OPTIONS → 204 且 ACAO 回显该 Origin、回显自定义请求头；
  2. 名单外 Origin 的 OPTIONS / GET → 403 且 `Access-Control-Allow-Origin` 为 null；
  3. 名单内 Origin 的 GET `/api/health` → 200（XHS 探活端点，无需 cookie）；
  4. 无 Origin 的 GET `/api/health` → 200（后台任务）；
  5. `env` 不带 `ALLOWED_ORIGINS` → 任意 Origin 照常（回归保护）；
  6. Origin 大小写不敏感。
- 测试里所有域名用 `example.com` 一类，不写真实域名。
- 验收：`corepack pnpm@9.15.9 vitest run worker/centerWorkerOrigin.test.ts worker/corsContract.test.ts` 全绿。

## 3. 门禁

- Step 3.1：`corepack pnpm@9.15.9 vitest run utils/proxyWorker.test.ts worker/centerWorkerOrigin.test.ts worker/corsContract.test.ts`。
- Step 3.2：`corepack pnpm@9.15.9 build:workers`（`utils/proxyWorker.ts` 进 amsg bundle，产物会变；确认 diff 只含默认值逻辑）。
- Step 3.3：全量 vitest + tsc（触碰文件零命中）+ mojibake（动过中文文件）。

## 4. Cloudflare 部署（自建实例 sully-proxy）

> 真实域名/值只在 CF 侧，记录进运行时，不进仓库。

- Step 4.1 重传 `worker/index.js`：metadata 的 bindings 加 plain_text `ALLOWED_ORIGINS`（值 = 部署者 Vercel 站点域 + 本地开发来源），保留 compatibility_date / flags。
- Step 4.2 挂自有 zone 自定义域（`PUT /accounts/{id}/workers/domains`，service=sully-proxy，environment=production）。
- Step 4.3 zone 级 `http_ratelimit` 入口规则：expression 匹配该自定义域主机名，`ip.src`，先 60s/600 次、封 10s；套餐不允许则下调或跳过。
- Step 4.4 探针（在 VPS 上 curl）：
  - 白名单 Origin 的 OPTIONS → 204 + ACAO + 自定义头回显；
  - 名单外 Origin 的 OPTIONS/GET → 403 且无 ACAO；
  - 无 Origin 的 GET `/api/health` → 200。
- 回滚：清掉 `ALLOWED_ORIGINS`（上传不带该变量）即恢复全开；删除自定义域不影响 workers.dev 地址。

## 5. 收尾

- Step 5.1 `notes/ethernet-branch-context.md` 记录一条（构建期默认 + 白名单 + 部署事实，域名用占位）。
- Step 5.2 用户侧：
  - Vercel 项目环境变量 `VITE_PROXY_WORKER_URL = https://<worker 自定义域>` → 重新部署；
  - 手机「设置 → 自定义网络代理」改成同一地址（或「恢复默认」随 env 生效）；
  - 真机冒烟：搜索/热点、B 站链接卡、豆瓣、备份、音乐、主动消息后台。
