# opencode.ai 上游身份头（x-opencode-session）— 设计与执行计划

日期：2026-09-08 · 状态：已批准，执行中

## 问题

开主代理中转 + 主动消息 2.0（自部署 worker）后，聊天窗口正常，但即时对话等几分钟后收到
系统通知「模型接口拒了这次请求：Error from provider (Console Go): Request is missing
x-opencode-session and cannot be routed efficiently…」。

## 根因

opencode.ai Go 上游防滥用要求：请求必须带可识别 `User-Agent` + `x-opencode-session`
（提示词缓存亲和）。两条路径满足情况不同：

- 浏览器聊天：全局拦截器（`context/OSContext.tsx:1152-1174`）把 `/chat/completions`
  改发 VPS 主代理，main-agent worker 自动补头（`worker/main-agent/src/index.js:217-231`）→ 正常。
- 云端 worker（即时对话 / 定时主动消息 / 情绪评估 / fireKinds / instant-push）：凭据行存
  原始供应商地址（`utils/amsgLlmCredentials.ts:55`），上游 SDK 的 `callLlm`
  （`node_modules/@rei-standard/amsg-shared/dist/index.mjs:158-172`）只发
  `Content-Type` + `Authorization` **直连** opencode.ai → 被拒 → `LLM_CALL_FAILED` →
  `utils/amsg2Tasks.ts:414` 转成人话通知。等几分钟是上游 fire 管线重试耗尽。

上游所有 LLM 调用（agentic 循环、message-processor、情绪评估
`utils/emotionEvalCore.ts:162`）都走 `globalThis.fetch`，无自定义 fetch 注入口；
node_modules 不可改。

## 方案

镜像 main-agent 的既有做法：两个 worker（amsg、instant-push）入口装一个模块级 fetch
补丁——命中 `opencode.ai` 域 + `POST /chat/completions` 时补 `user-agent` +
`x-opencode-session`，其余请求原样放行。CF Worker 出站可自定义 UA（`worker/index.js`
先例）。

## 改动清单

| 文件 | 动作 |
|---|---|
| `utils/llmIdentity.ts` | 新建（零依赖叶子，补丁本体） |
| `utils/llmIdentity.test.ts` | 新建（回归守卫） |
| `worker/amsg/src/index.ts` | import 块后安装，UA `SullyOS-AmsgWorker/1.0` |
| `worker/instant-push/src/index.ts` | import 块后安装，UA `SullyOS-InstantPush/1.0` |
| `utils/amsgBundleVersion.ts` / `utils/instantWorkerVersion.ts` | → `2026-09-08` |
| `worker/amsg/worker.bundle.js` + `public/instant-worker*.bundle.js` | build 产物随源码提交 |

补丁规则：幂等（globalThis flag）；session 为 isolate 级稳定 UUID（懒生成，
`crypto.randomUUID` 优先）；只处理 `(string|URL, init?)` 形态（全部 LLM 调用点都是这个
形态，Request 形态放行避免 body 流锁死）；整段 try/catch fail-open；补头只在不存在时
set，不覆盖已有；method 非 POST 放行。

## 部署（CF API，用户提供 key）

- `sullyos-amsg`（账户 `ba96b10471b6226a083cee8b6cd92e54`）：multipart PUT，
  main_module `worker.bundle.js`，compat `2026-01-01` + flag
  `global_fetch_strictly_public`，bindings 整表回放（secret_text 不带 text 保留原值），
  **不带 migrations**（DO namespace 已应用）。
- `instant-push`：同法，bindings 为空。
- 验证：`GET /config-check`（amsg）与 `GET /version`（instant-push），版本 = `2026-09-08`
  且 secrets/DB/DO 均被认出。
- key 只存在于会话命令，不进仓库、不进提交。

## 否掉的备选

- worker 改走 VPS 主代理中转：需 main-agent 加 OpenAI 兼容直通、凭据语义变化、CF 引入
  VPS 依赖。
- `/self-update`：拉的是上游官方成品包，会冲掉 ethernet 定制代码。
- 设置页一键重装：重新生成 AMSG_MASTER_KEY，旧 D1 数据解不开。

## 验收

- `corepack pnpm@9.15.9 vitest run` 全量绿；mojibakeGuard 绿。
- `corepack pnpm@9.15.9 build:workers` 成功；`npx tsc --noEmit` 触碰文件零命中；
  触碰文件字节扫 EF BF BD = 0。
- 部署后用户手机端重发即时对话端到端验证。
