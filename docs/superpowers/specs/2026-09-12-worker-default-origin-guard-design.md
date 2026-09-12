# Worker 默认地址与来源白名单 · 设计文档（2026-09-12）

> 状态：用户已批准（构建期默认 + Origin 白名单 + CF 限速；本期不做 Token）。
> 执行计划：`docs/superpowers/plans/2026-09-12-worker-default-origin-guard-plan.md`。
> 前置：CORS 契约统一（`docs/superpowers/specs/2026-09-11-cors-unification-design.md`）。

## 1. 背景

中心 worker（`worker/index.js`）是所有浏览器侧跨域联网能力的出口，默认指向作者公共实例（`DEFAULT_PROXY_WORKER = https://sullymeow.ccwu.cc`）。部署者自建实例后，目前只能在每台设备的「设置 → 自定义网络代理」手动填地址；清数据/换设备会回到公共实例。另一方面，自建实例没有任何访问控制，地址一旦被无关的人拿到即可白用。

用户诉求：让自己的部署默认走自建实例，同时限制无关调用。

## 2. 目标与非目标

**目标**

1. 构建期注入默认 worker 地址：构建环境变量 `VITE_PROXY_WORKER_URL`；未设 = 作者公共实例，仓库行为不变。
2. 中心 worker 可选 Origin 白名单（env `ALLOWED_ORIGINS`）：配置后只放行指定页面来源。
3. 自建实例挂自有 zone 的自定义域，并加 Cloudflare 限速规则。

**非目标**

- 不做共享 Token / 鉴权模型变更（留作后续档位，设计预留 `PROXY_TOKEN` 扩展位）。
- 不改 CORS 契约（预检回显、鉴权顺序）在未配置白名单时的行为。
- 不动仓库公共默认：作者公共实例、其他自部署用户零影响。

## 3. 设计

### 3.1 构建期默认地址

链路：`VITE_PROXY_WORKER_URL`（构建环境）→ `vite.config.ts` 的 `define.__PROXY_WORKER_URL__` → `utils/proxyWorker.ts` 的 `resolveDefaultProxyWorker()` → `DEFAULT_PROXY_WORKER`。

- 校验：仅接受 `http(s)://` 开头；trim、去尾斜杠；非法/空回落作者公共实例。
- 非浏览器运行时：`utils/proxyWorker.ts` 会被 esbuild 打进 amsg worker bundle，那里没有该 define。用 `typeof __PROXY_WORKER_URL__ === 'string'` 守卫（对未声明标识符的 typeof 是安全的），回落作者默认；amsg 后台本就靠 `setProxyWorkerUrlOverride()` 注入用户配置地址，不受影响。
- 设置页「恢复默认」= 清 localStorage → 回到构建期默认。
- 实际域名只存在于构建环境（Vercel 项目设置），不进仓库。

### 3.2 Origin 白名单（中心 worker）

`worker/index.js` 入口，在计算 `origin` 之后、OPTIONS 分支之前插入校验：

- `ALLOWED_ORIGINS` 逗号分隔，trim + 小写；**未配置或为空 = 完全维持现状**（兼容公共实例与旧行为）。
- 请求带 `Origin` 且不在名单 → 403 `{error:"origin_not_allowed"}`，**不返回任何 CORS 头**（预检与实请求一致拒绝）。
- 空 Origin（VPS/CF 后台任务、curl）放行——主动消息后台工具调用不经过浏览器，不受影响。
- 大小写不敏感；比对精确 Origin（scheme + host + port）。预览/新增来源需追加进 env。
- 这是显式的访问控制层，先于预检执行；仅在配置了白名单时生效，因此 `worker/corsContract.test.ts`（不带该 env）行为不变。

### 3.3 Cloudflare 部署

- 中心 worker 挂自有 zone 的自定义域（走 CF 代理；不经 VPS/Caddy，与 apex/mcp/oc 的灰云记录无冲突）。
- 限速：zone 级 `http_ratelimit` 入口规则集，匹配自定义域主机名，按 `ip.src` 计。参数按套餐实测（先 60s/600 次、封 10s；套餐不允许则下调或放弃限速，白名单仍有效）。
- `ALLOWED_ORIGINS` 值存在 CF 侧（plain_text 变量），不进仓库。

## 4. 安全边界与残余风险

- 白名单挡浏览器场景（其他网站、其他 fork 的页面）；**`curl` 伪造 Origin 或不带 Origin 仍可调用**，靠限速压量。
- 新设备/预览域名需要追加白名单，否则 403（预览域名默认不在名单）。
- 后续若需强隔离：`PROXY_TOKEN` env + 设置页「网络代理 Token」+ 全局 fetch 拦截器注入头 + 主动消息 `tool_config` 同步该 token（改动面大，另立项）。

## 5. 验收

- 单测：`utils/proxyWorker.test.ts`（默认解析纯函数）、`worker/centerWorkerOrigin.test.ts`（白名单矩阵：名单内预检/实请求通过、名单外 403 无 CORS 头、无 Origin 放行、未配置全开、大小写不敏感）。
- `worker/corsContract.test.ts` 全绿（未配置 env 时契约不变）。
- 线上探针：白名单 Origin 预检 204 + 回显自定义头；名单外 403 且无 ACAO；无 Origin 正常。
- 真机冒烟：搜索/热点、B 站链接卡、豆瓣、备份、音乐、主动消息后台。
