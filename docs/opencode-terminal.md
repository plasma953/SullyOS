# 终端 · 本机 opencode 远程控制台

> 改终端 App、连接、代理前必读。这份文档讲的是**桌面「终端」App 连用户自己电脑上的
> `opencode serve`**；角色聊天里的 MCP 工具归 [`docs/mcp-client.md`](./mcp-client.md) 管。

## 用户视角

设置 →「终端 · 我的电脑」→「连接」：

1. 电脑上跑起 `opencode serve`（见下「电脑端三选一」）
2. 填 opencode 地址（如 `http://127.0.0.1:4096`），要鉴权就填用户名/密码
3. 点「测试连接」→ 调 `GET /global/health`，通了自动启用
4. 打开桌面「终端」App → 选会话 → 发任务、看改动、批确认、跑命令

终端 App 有三个 Tab：**会话**（消息流 + prompt/shell/斜杠三种输入 + 待审批卡片 +
改动抽屉）、**文件**（目录树 + 读文件 + 全文搜索）、**遥控**（操作电脑屏幕上正在跑
的那个 TUI：预填/提交 prompt、执行 TUI 命令、弹 toast、开会话/模型选择器）。

## 电脑端四选一（按推荐排序）

| 路径 | 适用 | 电脑端命令 / 操作 |
|------|------|-------------------|
| **直连**（代理 URL 留空） | 同机 / 同 Wi-Fi / 出门但手机电脑都在外网直达 | `opencode serve --port 4096 --cors http://localhost:5173`（`--cors` 填手机页面的源；`--cors` 可传多次） |
| **Tailscale 直连**（最推荐的远程） | 出门远程办公，不想暴露公网 | 两边都装 Tailscale 进同一虚拟局域网；serve 照常绑本机；手机填 `http://100.x.y.z:4096`。流量走 WireGuard 加密，不经过任何第三方代理 |
| **VPS 反向隧道**（手机零安装） | 手机 VPN 槽被占 / 不想装任何 App，有 VPS | 电脑 `ssh -R` 把端口递到 VPS，手机连 VPS。详见下节 |
| **本地代理** | serve 没起 `--cors`、又不想动它 | 电脑上跑 `node scripts/opencode-proxy.mjs`（默认 `:18062`），手机「代理 URL」填 `http://localhost:18062`（电脑浏览器） |
| **自部署 CF Worker** | 公网远程 + 电脑无公网 IP（经 Tunnel） | 见「CF Worker 代理部署」节 |

> serve 默认只绑 `127.0.0.1`。局域网另一台设备要连，起 serve 的那台保持默认即可
> （连的是它的局域网 IP，如 `http://192.168.1.5:4096`）；**只有**需要经公网/Tunnel
> 进来时才加 `--hostname 0.0.0.0`，且必须设强密码（下）。
>
> 安全说明：局域网直连是明文 HTTP（Basic Auth 的密码同 Wi-Fi 可见），
> `capacitor.config.json` 的 `cleartext` 因此必须开着——关掉会导致局域网终端功能全灭。
> 家里 Wi-Fi 还好，出门蹭网时请走 Tailscale 或 VPS 隧道，不要裸连。

## 鉴权

电脑端设密码后，serve 全接口走 HTTP Basic Auth（用户名默认 `opencode`，可用
`OPENCODE_SERVER_USERNAME` 改）：

```bash
OPENCODE_SERVER_PASSWORD=<强密码> opencode serve --port 4096
```

手机设置里填同一对用户名/密码，请求头自动带 `Authorization: Basic …`。
**不设密码 = 裸奔**：VPS 反向隧道和任何经公网的链路必须设密码。
密码只存本机 localStorage（`aetheros.opencode.connection`），随备份导出包一起走
（与 MCP token 同口径）——**备份包妥善保管**。密码永不进日志与报错文本。

## VPS 反向隧道（详细步骤）

原理：电脑主动 `ssh` 连上 VPS，把远端 `127.0.0.1:4096` 映射回本机 serve。
serve 继续绑 `127.0.0.1`（ssh 在同一台机器走回环，不用 `--hostname 0.0.0.0`）；
手机连 VPS，全程手机端零安装、不占 VPN 槽。

```mermaid
手机 --(http/https + Basic Auth)--> VPS:4096 --(ssh -R 隧道)--> 电脑 127.0.0.1:4096
```

### 1. 电脑生成专用密钥（PowerShell，一次）

```powershell
ssh-keygen -t ed25519 -f $env:USERPROFILE\.ssh\oc_tunnel -N '""'
type $env:USERPROFILE\.ssh\oc_tunnel.pub
```

把打印出的公钥追加到 VPS 的 `~/.ssh/authorized_keys`（单独一行；可选加固前缀，
sshd 认不出就去掉它）：
`permitlisten="127.0.0.1:4096" ssh-ed25519 AAAA…`。

### 2. 电脑建保活隧道（PowerShell）

存为 `$env:USERPROFILE\tunnel-oc.ps1`（把 `你的VPS` 换成地址）：

```powershell
while ($true) {
  ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 `
    -i $env:USERPROFILE\.ssh\oc_tunnel `
    -R 127.0.0.1:4096:localhost:4096 root@你的VPS
  Start-Sleep -Seconds 10
}
```

先手动跑一次验证通路（另开终端 `curl http://你的VPS:4096/global/health`
应返回 `{"healthy":true,…}`——注意这一步从**外网**测，不要在 VPS 本机测）。
通了之后注册成开机自启的计划任务：

```powershell
$action = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-NoProfile -WindowStyle Hidden -File $env:USERPROFILE\tunnel-oc.ps1"
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable
Register-ScheduledTask -TaskName "opencode-tunnel" `
  -Action $action -Trigger $trigger -Settings $settings
```

### 3. VPS 侧二选一

- **A. 直接暴露端口（简单）**：隧道绑的是 VPS 的 `127.0.0.1`，手机够不着。
  要么改第 2 步的 `-R` 为 `-R 0.0.0.0:4096:localhost:4096`（需 VPS 的
  `sshd_config` 开 `GatewayPorts yes` 并 `ufw allow 4096/tcp`），要么走 B。
- **B. Caddy 反代 + 自动 TLS（推荐）**：保持 `-R 127.0.0.1:4096`，Caddy 加一段：

```caddy
oc-phone.你的域名 {
    reverse_proxy 127.0.0.1:4096
}
```

手机填 `https://oc-phone.你的域名`——https 还顺手治好了「https 页面调 http
被浏览器拦」的问题，线上版 SullyOS 也能用。

### 4. 手机侧

终端 → 连接 → opencode 地址填 VPS 地址（A 为 `http://VPS:4096`，B 为
`https://oc-phone.你的域名`），用户名/密码照旧，测试连接。

### 排障

- 测试连接失败先看隧道活着没：电脑任务计划程序里 `opencode-tunnel` 是否在跑；
  VPS 上 `ss -ltnp | grep 4096` 有没有监听。
- 隧道通但 401：serve 密码与手机填的不一致（`OPENCODE_SERVER_PASSWORD`）。
- 隧道通但 `Failed to fetch`：`--cors` 没包含手机页面的源。

## CF Worker 代理部署（出门远程）

1. 家里电脑先有公网入口（二选一）：路由器端口映射，或 Cloudflare Tunnel 指到
   `127.0.0.1:4096`。serve 必须设强密码（上）。
2. `worker/opencode-proxy/` 部署到**你自己的** CF 账号（Dashboard 粘贴或
   `wrangler deploy`），拿到 Worker 地址。
3. `wrangler secret put PROXY_KEY`（或面板 Variables），手机「代理密钥」填同一个值。
4. 手机「opencode 地址」填公网地址，「代理 URL」填 Worker 地址。

Worker 只做透明转发 + CORS 头，不存凭据；内网目标一律拒绝（SSRF 防护，刻意保留）。
SSE 事件流（`/event`）原样透传。

## 代码地图

| 职责 | 文件 |
|------|------|
| 协议客户端（鉴权/代理/SSE/会话/消息/文件/TUI）+ 配置存储 + 备份导出导入 | `utils/opencodeClient.ts`（测试同名 `.test.ts`） |
| 终端 App（会话流/审批/diff/输入框） | `apps/TerminalApp.tsx` |
| 文件 Tab / TUI Tab | `components/terminal/FilesTab.tsx`、`TuiTab.tsx` |
| 设置连接控制台 | `components/settings/OpencodeConnectionConsole.tsx` |
| App 注册 | `types.ts`（`AppID.Terminal` + opencode 类型 + `FullBackupData.opencodeLocal`）、`constants.tsx`、`components/PhoneShell.tsx` |
| 备份导出/导入 | `utils/db.ts`（`opencodeLocal` 段） |
| 本地 CORS 代理 | `scripts/opencode-proxy.mjs`（默认 `:18062`） |
| 用户自部署 Worker 代理 | `worker/opencode-proxy/`（`worker.test.ts` 锁转发/密钥/SSRF 行为） |

## 设计要点（改之前必看）

- **只走 `prompt_async` + 轮询，不做同步长连接等待**。编码任务动辄跑几分钟；
  发完紧轮询 3 次出首字，之后靠 `GET /session/status` 忙闲表决定 2s 轮不轮询消息。
- **SSE（`GET /event`）只做推送增强**：`permission.updated` 落审批卡、
  `session.status` 翻 busy→idle 时补拉一次消息、`session.*` 刷会话列表。
  `EventSource` 设不了 `Authorization` 头，必须 fetch + reader 手工拆帧；
  断线只通知 UI（5s 后重连），不断言不断线。
- **审批默认不自动允许**。`POST /session/:id/permissions/:permissionID` 的 body 是
  `{ response: "once" | "always" | "reject" }`；拒绝要二次确认。
- **shell 返回的是裸 AssistantMessage**（不是 `{info,parts}`），输出靠随后轮询
  `GET /session/:id/message` 拿。斜杠命令返回 `{info,parts}`。
- **TUI 端点体是推测形状**（`append-prompt {text}` / `execute-command {command}` /
  `show-toast {message}`，其余 `{}`），依据是服务端 docs 页与 SDK 事件名；
  若真机联调报 400，先对 `http://<serve>/doc` 的 OpenAPI 校对，再改
  `utils/opencodeClient.ts` 的 `tuiPost` 调用处。
- **合同来源**：opencode 官方 JS SDK 类型（`packages/sdk/js/src/gen/types.gen.ts`），
  2026-09-06 抓取的关键形状见 `docs/superpowers/plans/2026-09-06-terminal-opencode-remote.md`
  「合同校准记录」。字段只增不减，运行时对未知字段宽容。
- **无新埋点**（终端是纯工具，不加统计事件）。
- **备份**：`exportOpencodeLocal/importOpencodeLocal` 原样搬运 localStorage 字符串，
  与 mcpLocal 同构；roundtrip 测试在 `utils/opencodeClient.test.ts`。

## 已知边界 / Follow-up

- 交互式 PTY（`/pty` 的 connect 数据通道协议未在 SDK 类型中定义）v1 没做：
  只读进程列表都没加（连展示价值都不大）。命令执行走 `/session/:id/shell` 已覆盖。
  等官方文档化 connect 协议后再加真·终端 I/O。
- 文件 Tab 读文件截断 20000 字；diff 抽屉左右对照只展示不合并。
- 附件（图片）part 暂不上传：prompt 只发纯文本 part。
