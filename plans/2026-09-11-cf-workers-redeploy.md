# CF Worker 重新部署任务卡（2026-09-11 · CORS 契约统一）

> 背景：CORS 统一改动（提交 `f346179`）已 push、VPS 已部署并验证。CF 侧还有 4 个 worker
> 需要更新到含契约的新代码。本任务卡给「拥有 Cloudflare MCP 工具的会话」执行。
> 全程**只更新代码**，不动 secrets / bindings / routes / cron。

## 目标与文件

| worker（账号内实际名字，先 list 对号入座） | 上传的文件 | 说明 |
|---|---|---|
| amsg | `worker/amsg/worker.bundle.js` | 已是可部署 ESM 产物；`worker/amsg/wrangler.toml` 里 `main` 指向它 |
| instant-push | `worker/instant-push/worker.bundle.js` | CF 面板粘贴版（Deno 版 `worker.deno.bundle.js` 本次不动） |
| post-office | `worker/post-office/worker.bundle.js` | 纯后端（彼方邮局） |
| 中心 worker（自建实例，形如 `sully-proxy.*.workers.dev`） | `worker/index.js` | 单文件 Dashboard 粘贴部署的那份 |

**先列 worker 再动手**：不确定哪个名字对哪个文件时，向用户报告后等确认，不要猜。

## 操作要求

1. 只更新脚本代码；**绝不触碰**：环境变量 / Secrets、D1 绑定、KV 绑定、Cron Triggers、Routes / 自定义域。
2. 经验（2026-09-08）：用 CF API 上传时 metadata 里不写 secret 即保留；写了空 secret 会被 10021 拒。
   MCP 部署工具若要求打包，直接上传上表 `.bundle.js`（已打包）；中心 worker 上传单文件 `worker/index.js`。
3. 不删除再重建 worker（会丢绑定/secrets）。

## 部署后验证（逐项）

- amsg：`GET {workerUrl}/config-check` → 有 `workerVersion` 与 `backgroundJobs:true`
- instant-push：`GET {workerUrl}/version` → 版本 `2026-09-08`
- post-office：`GET {workerUrl}/health` → `{ ok: true }`
- 中心 worker：`OPTIONS /` 带 `Access-Control-Request-Headers: x-future-feature` → 204 且
  `Access-Control-Allow-Headers` 回显 `x-future-feature`（这是契约判据；旧版为固定名单）

验证 URL 用用户设置里存的地址（问用户），不要用仓库默认公共域名。

## 禁止事项

- 不跑 `wrangler deploy`（本机无登录态）、不改 `wrangler.toml`
- 不动 Deno 门面（用户自己贴 Playground 的产物；仓库 `public/amsg-deno-proxy.ts` 已同步，用户需要时自取）
- 不部署 `worker/mcp-proxy`、`worker/opencode-proxy`（属于用户自部署可选件；用户重新贴上即可，代码已更新）
