# 终端（OpenCode 远程控制台）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在小手机桌面新增「终端」App，直连用户自己电脑上的 `opencode serve`，实现会话管理、发 prompt、文件浏览、diff、permission 审批、TUI 遥控、shell 执行的完整远程遥控。

**Architecture:** 复用 MCP 三件套模式——`utils/opencodeClient.ts` 做协议客户端（Basic Auth + `?target=` 代理约定），设置页管连接，`apps/TerminalApp.tsx` 做控制台 UI，`scripts/opencode-proxy.mjs` + `worker/opencode-proxy/` 解决 CORS/公网。与角色聊天零耦合，不碰 ContextBuilder。

**Tech Stack:** React + TS + fetch 流式读取；vitest（mock fetch）；Node 裸 http 代理脚本；CF Worker 透明转发。

**Spec:** 本计划即 spec（bounded 路径，in-chat 设计已获批准）。opencode 合同以官方 SDK 类型为准：
`https://raw.githubusercontent.com/sst/opencode/dev/packages/sdk/js/src/gen/types.gen.ts`
（2026-09-06 已抓取关键形状，见 Task 1 校准记录）。用户决策：只连一台电脑（单连接存储）、Shell 并入底部输入框模式切换、2s 轮询。

## Global Constraints

- 包管理器只用 pnpm；测试跑 `pnpm vitest run <文件>`。
- 动过含中文文件后字节级自查 `EF BF BD`（U+FFFD），写文件只用专用工具、UTF-8 无 BOM。
- 不新增统计埋点（`docs/analytics.md` 要求；本工具不需要）。
- 密码永不进日志/报错文本；备份包内含密码（与 MCP token 同口径），文档中明示妥善保管。
- 流量绝不经过中心 sfworker；CF Worker 必须部署在用户自己账号，且保留内网目标拦截。
- opencode JSON 字段形状以 SDK 类型为准（Task 1 校准记录），不硬猜；运行时对未知字段宽容（optional chaining）。

## 合同校准记录（2026-09-06，SDK types.gen.ts）

- `Session { id, projectID, directory, title, version, time: { created, updated } }`
- `POST /session` body `{ parentID?, title? }` → 200 Session
- `GET /session/status` → 200 `{ [sessionID]: SessionStatus }`；`SessionStatus = {type:'idle'}|{type:'retry',...}|{type:'busy'}`
- `DELETE /session/{id}` → boolean；`GET /session/{id}` → Session；`PATCH /session/{id}` body `{title?}`
- `POST /session/{id}/abort` → boolean
- `GET /session/{id}/message?limit?` → 200 `Array<{ info: Message, parts: Part[] }>`
- `POST /session/{id}/message` body `{ messageID?, model?: {providerID, modelID}, agent?, noReply?, system?, tools?, parts: (TextPartInput|FilePartInput|AgentPartInput|SubtaskPartInput)[] }` → `{ info: AssistantMessage, parts }`
- `POST /session/{id}/prompt_async`（同 body）→ 204 void
- `POST /session/{id}/command` body `{ messageID?, agent?, model?: string, arguments, command }` → `{ info: AssistantMessage, parts }`
- `POST /session/{id}/shell` body `{ agent, model?, command }` → 200 AssistantMessage（裸消息，不是 {info,parts}）
- `POST /session/{id}/permissions/{permissionID}` body `{ response: "once"|"always"|"reject" }`
- `GET /session/{id}/diff` → `FileDiff[]`（`{ file, before, after, additions, deletions }`）
- 文件：`GET /file?path=` → `FileNode[] { name, path, absolute, type: 'file'|'directory', ignored }`；`GET /file/content?path=` → `FileContent { type: 'text'|'binary', content, ... }`；`GET /find?pattern=`、`GET /find/file?query=`、`GET /find/symbol?query=`
- 事件：`GET /event`（SSE）。`GlobalEvent = { directory, payload: Event }`；关键 type：`server.connected`、`message.updated`、`message.part.updated`（带 `delta?: string`）、`permission.updated`（`Permission { id, type, pattern?, sessionID, messageID, title, ... }`）、`session.status`、`session.idle`、`session.created/updated/deleted`、`session.diff`、`session.error`、`todo.updated`、`file.edited`
- TUI：`POST /tui/append-prompt`、`open-help`、`open-sessions`、`open-themes`、`open-models`、`submit-prompt`、`clear-prompt`、`execute-command {command}`、`show-toast {title?, message, variant?}`
- 健康：`GET /global/health` → `{ healthy, version }`
- PTY（`/pty` 创建/列表/删除）v1 只做进程列表展示，不做交互式 PTY I/O（connect 协议未在 SDK 类型中定义，盲写风险高；命令执行走 `/session/:id/shell`）。记为 follow-up。

## 文件清单

新建：`utils/opencodeClient.ts`、`utils/opencodeClient.test.ts`、`apps/TerminalApp.tsx`、`components/settings/OpencodeConnectionConsole.tsx`、`scripts/opencode-proxy.mjs`、`worker/opencode-proxy/worker.js`、`worker/opencode-proxy/wrangler.toml`、`worker/opencode-proxy/README.md`、`docs/opencode-terminal.md`。
修改：`types.ts`（`AppID.Terminal` + 连接/会话类型 + `FullBackupData.opencodeLocal`）、`constants.tsx`（`Terminal` 图标 + `INSTALLED_APPS` 注册）、`components/PhoneShell.tsx`（`APP_BY_ID`）、`apps/Settings.tsx`（连接板块）、`utils/db.ts`（备份导出/导入）、`utils/buildInfo.ts`（版本号）、`CLAUDE.md`（文档地图加一行）。

### Task 1：类型与 App 注册

**Files:**
- Modify: `types.ts`（AppID + 类型 + FullBackupData）
- Modify: `constants.tsx`（图标 + INSTALLED_APPS）
- Modify: `components/PhoneShell.tsx`（APP_BY_ID）

**Interfaces:**
- Produces: `AppID.Terminal = 'terminal'`、`OpencodeConnection { id, name, baseUrl, username, password, proxyUrl?, proxyKey?, enabled, updatedAt }`、`OpencodeSessionInfo`（Session 子集）、`OpencodeMessageItem { info: Message, parts: Part[] }`（Message/Part/Permission/SessionStatus/Event/FileNode/FileContent 按校准记录定义最小可用形状，`[key: string]: unknown` 兜底）。

- [ ] **Step 1: types.ts 加 AppID。** 在 `Pomodoro` 行后加 `Terminal = 'terminal', // 终端 — 本机 opencode 远程控制台`。
- [ ] **Step 2: types.ts 加 opencode 类型 + FullBackupData.opencodeLocal。**
- [ ] **Step 3: constants.tsx 注册。** import 加 `TerminalWindow`；`Icons` 加 `Terminal: ({ className }) => <TerminalWindow className={className} weight="regular" />`；`INSTALLED_APPS` 加 `{ id: AppID.Terminal, name: '终端', icon: 'Terminal', color: 'emerald' }`（放设置附近）。
- [ ] **Step 4: PhoneShell.tsx 加 APP_BY_ID 映射**（懒加载 import 照抄相邻行；不进 APP_IDLE_PRELOAD_ORDER，低频 App）。
- [ ] **Step 5: 验证。** Run: `pnpm vitest run utils/backupRoundtrip.test.ts` Expected: PASS；类型检查（build 脚本内 tsc 步骤）通过。
- [ ] **Step 6: Commit。**

### Task 2：客户端核心——配置、鉴权、fetch 封装、测试连接

**Files:**
- Create: `utils/opencodeClient.ts`
- Create: `utils/opencodeClient.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `OpencodeConnection`。
- Produces: `loadOpencodeConnection/saveOpencodeConnection/clearOpencodeConnection`（单连接，键 `aetheros.opencode.connection`）、`basicAuthHeader(conn): string`、`buildOpencodeUrl(conn, path): string`、`opencodeFetch(conn, path, init?): Promise<Response>`（30s 超时，401→`OpencodeAuthError`，网络失败→`OpencodeNetworkError`，密码永不进 message）、`testOpencodeConnection(conn): Promise<{ version: string }>`（`GET /global/health`）。

- [ ] **Step 1: 写失败测试**（mock globalThis.fetch）：直连拼 URL；代理拼 `?target=` + 透传 Authorization；401 抛 OpencodeAuthError；Failed to fetch 抛 OpencodeNetworkError。
- [ ] **Step 2: 跑测试确认失败。** Run: `pnpm vitest run utils/opencodeClient.test.ts` Expected: FAIL（模块不存在）。
- [ ] **Step 3: 最小实现。**
- [ ] **Step 4: 跑测试确认通过。** Expected: PASS。
- [ ] **Step 5: Commit。**

### Task 3：会话 API

**Files:** Modify `utils/opencodeClient.ts`；Extend `utils/opencodeClient.test.ts`
**Interfaces:** Produces `listSessions/createSession/getSession/renameSession/deleteSession/abortSession/getSessionStatus/getSessionDiff/respondPermission(sessionID, permissionID, 'once'|'always'|'reject')`。

- [ ] **Step 1: 写失败测试**（六个端点的方法+路径+body，照校准记录）。
- [ ] **Step 2: 跑测试确认失败。** Expected: FAIL。
- [ ] **Step 3: 最小实现**（薄封装，原样返回 JSON）。
- [ ] **Step 4: 跑测试确认通过。** Expected: PASS。
- [ ] **Step 5: Commit。**

### Task 4：消息与 Shell API（只走 async+轮询单路径）

**Files:** Modify `utils/opencodeClient.ts`；Extend `utils/opencodeClient.test.ts`
**Interfaces:** Produces `sendPromptAsync(sessionID, text, opts?: { model?, agent? })`（parts `[{type:'text',text}]`，204 不解析 body）、`listSessionMessages(sessionID, limit?)`、`runShellCommand(sessionID, command, agent='general')`（返回 AssistantMessage）、`runSlashCommand(sessionID, command, args)`。

- [ ] **Step 1: 写失败测试。** `prompt_async` 期望 204；messages 拼 `?limit=`；shell body 含 `{agent, command}`。
- [ ] **Step 2–4: 红→绿。**
- [ ] **Step 5: Commit。**

### Task 5：文件与 TUI API

**Files:** Modify `utils/opencodeClient.ts`；Extend `utils/opencodeClient.test.ts`
**Interfaces:** Produces `listFiles(path?)`、`readFileContent(path)`、`searchText(pattern)`、`findFile(query)`、`tuiAppendPrompt/tuiSubmitPrompt/tuiClearPrompt/tuiExecuteCommand/tuiShowToast/tuiOpenSessions/tuiOpenModels`。

- [ ] **Step 1: 写失败测试**（querystring 编码 + 九个 `/tui/*` 路径）。
- [ ] **Step 2–4: 红→绿。Step 5: Commit。**

### Task 6：SSE 事件流（fetch 流式读，不用 EventSource）

**Files:** Modify `utils/opencodeClient.ts`；Extend `utils/opencodeClient.test.ts`
**Interfaces:** Produces `subscribeOpencodeEvents(conn, onEvent: (e: { type: string, properties: unknown }) => void, signal: AbortSignal): Promise<void>`（`GET /event`，Accept: text/event-stream，手工拆帧，`server.connected` 首事件，断线 reject 通知调用方，不自动重连）。

- [ ] **Step 1: 写失败测试**（mock 分片 ReadableStream：拼片+JSON 解析+abort 后 cancel reader）。
- [ ] **Step 2–4: 红→绿。** 约束：EventSource 设不了 Authorization 头，必须 fetch+getReader。
- [ ] **Step 5: Commit。**

### Task 7：设置页「终端连接」板块

**Files:** Create `components/settings/OpencodeConnectionConsole.tsx`；Modify `apps/Settings.tsx`
**Interfaces:** Consumes Task 2 全部函数。

- [ ] **Step 1: 写组件。** 照抄 `McpConnectionConsole.tsx` 骨架：单连接表单（名称/baseUrl/用户名/密码/代理URL/代理密钥/启用开关）、改字即落盘（照抄 Settings 里 MCP 的 800ms 节流模式）、「测试连接」调 `testOpencodeConnection` 展示版本/401/CORS 三态（诊断复用 `utils/networkFailureDiagnosis.ts` 的 `classifyFetchFailure`）。
- [ ] **Step 2: 验证。** 类型检查通过（React 在纯 Node vitest 跑不了渲染，功能验收并入 Task 8 真机）。
- [ ] **Step 3: Commit。**

### Task 8：终端 App——会话列表 + 对话 + 审批（MVP 可用线）

**Files:** Create `apps/TerminalApp.tsx`
**Interfaces:** Consumes Task 2/3/4/6。

- [ ] **Step 1: 写 UI。** 顶栏（连接状态点 + 新建会话）；会话列表（`listSessions` + SSE `session.*` 刷新）；主区消息流（`listSessionMessages` 2s 轮询追加，busy 状态显示 abort）；底部输入框三模式（prompt / `/command` / shell，模式切换器）；`diff` 抽屉只读展示；permission 待审批卡片（允许本次/总是允许/拒绝 → `respondPermission`，默认不自动允许）。
- [ ] **Step 2: 真机验收**（用户侧或 dev 环境）：`opencode serve --port 4096 --cors http://localhost:5173` + `pnpm dev`：建会话→发 prompt→等回复→abort→看 diff→permission 批准/拒绝各一遍。
- [ ] **Step 3: Commit。**

### Task 9：文件 Tab + TUI Tab（超 600 行拆 `components/terminal/`）

**Files:** Modify `apps/TerminalApp.tsx`
**Interfaces:** Consumes Task 5。

- [ ] **Step 1: 文件 Tab。** 树形懒加载 + 点击读内容（大文件截断提示）+ 搜索框。
- [ ] **Step 2: TUI Tab。** 九个按钮直调 + 红字提示（遥控本机正在跑的 TUI）。
- [ ] **Step 3: 真机验收 + Commit。**

### Task 10：两条代理（本地脚本 + CF Worker）

**Files:** Create `scripts/opencode-proxy.mjs`、`worker/opencode-proxy/worker.js`、`wrangler.toml`、`README.md`
**Interfaces:** 约定 `<代理URL>?target=<url-encoded>`（与 MCP 一致）。

- [ ] **Step 1: 本地脚本。** 抄 `scripts/mcp-proxy.mjs` 通用转发骨架，删 SPA 预热，CORS 允许 `Authorization`，Expose 补 `WWW-Authenticate`，默认端口 `18062`。验证：`node scripts/opencode-proxy.mjs --target http://127.0.0.1:4096` 后 curl 经代理打 health（本机 curl 可用，不走被杀的 loopback？注意沙箱可能杀 loopback 连接——验证步骤若在沙箱跑不通，转用户真机验收）。
- [ ] **Step 2: CF Worker。** 抄 `worker/mcp-proxy/worker.js`，保留 `blockedTargetReason` 内网拦截，加测试（mock fetch，照抄仓库 worker 测试套路）。
- [ ] **Step 3: Commit。**

### Task 11：备份 + 文档 + 收尾

**Files:** Modify `utils/db.ts`、`utils/buildInfo.ts`、`CLAUDE.md`；Create `docs/opencode-terminal.md`

- [ ] **Step 1: 备份。** `opencodeClient.ts` 加 `exportOpencodeLocal/importOpencodeLocal`（照抄 mcpLocal 在 `db.ts` 导出段/导入段接线），补 roundtrip 测试（照抄 `backupRoundtrip.test.ts` 模式）。
- [ ] **Step 2: 文档。** `docs/opencode-terminal.md`：服务端三选一（局域网直连 / Tailscale 最推荐 / 公网暴露必须 `--hostname 0.0.0.0`+强密码+防火墙）、`OPENCODE_SERVER_PASSWORD`、`--cors` 取值、Worker 部署+`PROXY_KEY`、备份含密码警示、PTY follow-up；`CLAUDE.md` 地图加一行；`buildInfo.ts` 升版本号。
- [ ] **Step 3: 全量验证。** `pnpm vitest run` 全仓 + 含中文新文件字节自查（`EF BF BD`）+ Task 8/9 真机验收重放。
- [ ] **Step 4: Commit。**
