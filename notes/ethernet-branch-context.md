# ethernet 分支 · 项目背景与约定

> 这份文件是二改工作的长期上下文。新会话开工前先读一遍；改完记得保持内容最新（2026-09-06 记录）。

## 仓库关系

- **原版（上游）**：https://github.com/qegj567-cloud/SullyOS —— 本仓库 `origin/master` 跟踪它，分叉点 `b0f5fd24`（上游 PR #615，Android v3.4.9 时期）。
- **二改仓**：origin = plasma953/SullyOS，**`ethernet` 分支是唯一主力开发线，今后所有修改都只做在 ethernet 上**（不做别的分支，不直接改 master）。
- `ethernet` 领先上游约 78 个提交（+24811 行 / 246 文件），落后约 43 个。落后部分多为 amsg2/记忆/协同小修，不少已被同名 cherry-pick 等价移植；真正未合入的主要有：上游 `AGENTS.md` 更名、analytics 快照合并上报、amsg2 worker 2.6.0-next.26/27 的修复、上游 MCP 产品化版（协议协商）。
- 同步上游的惯例是**按提交 cherry-pick 等价改动**，而不是整分支 merge；接上游新改动前先确认 ethernet 里是否已有同名等价提交。

## ethernet 分支的侧重点

按分量排序，主题是「云端依赖搬回自己手里 + 拟真生活系统大扩张」：

1. **VPS 后端自托管（核心）**：新增 `vps-backend/`（Node 原生宿主 + Cloudflare Workers 兼容垫片，D1→SQLite，bin/config/deploy/src）。amsg2 主动消息纯 VPS 化、Instant Push UI 整体退役、主代理 MCP 循环代理、三通道备份。「ethernet」得名于此——自组网自托管。
2. **拟真商业系统**：外卖/购物双 App（OSM 真实店面 × OFF 真实商品 670 条、淘宝式界面、全 SVG 商品图）；银行拟真化（21 家银行 SVG + 品牌渐变卡面 + char 卡视图 + 代记收入 INCOME）；char 视角下单链路（ORDER 主动点单）；LLM 拟真购买记录。
3. **自习室深度改造**：EPUB 阅读器（原文/AI 总结双模式、配色主题、重复图片去重、浮动导师）、AI 分层总结、讲课模式、多字体库。
4. **角色世界观增强**：透视窗（char 查看用户真实设备操作记录，Supabase+RLS）、角色级地理位置 × 天气联动 × 中国节假日状态机、联系人关系网发散、时光契约日历化与重复规则。
5. **提示词目录化 + 预设 App**：全系统提示词目录化、注入预览与三段式标签、预设管理。
6. **MCP 增强**：公网 CORS 修复、主代理中转、连接方式选择、调用次数自定义、跨轮结果记忆。
7. **UI/桌面层**：主网格 4x4、紧凑图标、loader dots、番茄钟（水球动画+同伴鼓励+惩罚）等。

## 新增功能时的硬约定

**UI、动效、美化风格必须与 ethernet 现有风格保持一致**：动手前先看 ethernet 里同类界面的既有写法（配色、圆角、动效节奏、CSS 组织方式），在既有模式上扩展，不照抄上游新风格、不引入全新视觉语言。

## VPS 部署布局（已确认可连，2026-09-06）

**改码工作流（硬约定）：所有内容一律在本机修改 → push 到 `origin/ethernet` → VPS 上 pull + 重启生效。不在 VPS 上直接改仓库里的文件。** 只有只存在于 VPS 的运行时文件（`/opt/sullyos/.env`、systemd unit、Caddyfile、data/logs）需要改动时才在 VPS 上动手。

SSH：`root@108.165.20.235:32212`（opencode 的 vps 工具里叫 `default`）。Ubuntu 24.04，2G 内存，Node v22 + pnpm 11。

- `/opt/sullyos/sullyos-repo`：plasma953/SullyOS 的 clone，checkout 在 `ethernet`，跟着 `origin/ethernet` 走。**注意它只到 origin/ethernet——本地领先未 push 的提交不会自动生效，先 push 再上 VPS 更新。**
- `/opt/sullyos/vps-backend`：部署目录（bin/config/deploy/src + node_modules），`systemd` 服务名 `sullyos.service`，入口 `bin/run-all.js`，日志 `/opt/sullyos/logs/sullyos.log`，环境变量 `/opt/sullyos/.env`。
- 端口全部只听 127.0.0.1，由 Caddy 反代出公网：**8830 main-agent**、**8831 amsg（共享密钥鉴权）**、8832-8835 其余模块；域名 `43451695.xyz` / `mcp.43451695.xyz` / `oc.43451695.xyz`。
- `sullyos-dufs.service`：WebDAV(dufs) 备份存储（127.0.0.1，端口与凭据在 .env）。
- 机器上还有 `phone-chat-gateway.service`（/root/apps/vps-chat-gateway）及 kaleidoscope / ruota / xhs-mcp / theseus-brain 等 MCP 服务，main-agent 已把后三个 MCP 挂进工具池。
- 观察项：main-agent `/health` 显示 `llmConfigured:false, providers:0`——若按设计是凭据随请求走则正常，改主代理 LLM 配置时留意。

## 仓库现状与坑（2026-09-06 更新）

- ✅ 番茄钟手绘风改造已落地（本地 `39878aee`，已 push；纯前端，VPS 未动）：全 App 铅笔手绘风；主页设背景图/整体配色/水球单色/消息形态；可拖动角色悬浮球（轻点循环文字/语音/混合，语音自动播放）；12 周热力图（历史上限 100→500）；停止改一层轻确认后立即结束，惩罚后台生成自动落聊天+记忆，惩罚弹窗已删。
- ✅ UTF-8 乱码大修复（本地 `b19fffb9`）：8 文件 203 处 U+FFFD 截断从 git 历史逐行恢复，activeMsgRuntime 两处 `= 启动` 裸标识符（cherry-pick 出生即坏，曾致 49 个测试失败）补为 `'上线补收'`，新增 `utils/mojibakeGuard.test.ts` 全仓护栏（扫到 U+FFFD 即测试红）。
- ⚠️ **编码铁律（别再犯）**：本仓库历史上多次被 Windows AI 会话按非 UTF-8 方式写文件造成多字节截断。今后**任何写文件操作必须 UTF-8 无 BOM**；编辑含中文的行后，用 `utils/mojibakeGuard.test.ts` 或 python 字节扫 `\xef\xbf\xbd` 自查；修复乱码的套路是「逐行回溯 git 历史，按 FFFD 前后碎片匹配完好版本」（脚本模式见 2026-09-06 会话）。相关特性提交波次：f732464a/c75ffa57/ec8c983e/7a68eb2b/dcb78439/939e6525。
- 🧷 **AI 防乱码操作清单（2026-09-06 实测结论）**：乱码分两层——①显示层：PowerShell 5.1 输出管线把 UTF-8 中文解码成问号状替换符（U+FFFD）（git 里的字节是干净的，`git log` 经 python 验过 `utf8-ok=True`），只污染眼睛；②文件层：真正的 U+FFFD 进源码，来自 shell 写文件或引用了被显示层污染的文本。遵守：写文件只用 Write/Edit 工具，绝不用 shell 重定向/`Set-Content`/`echo` 写文件；含中文的 oldString 只从 Read 工具输出逐字取，bash 输出里的中文只看行号、不复制文字；bash 命令参数避免中文（搜中文用 Grep 工具）；commit message 用英文；绝不在 Write/Edit 参数里放 U+FFFD 字符本身做示意（护栏认字不认意图），用“U+FFFD”文字描述代替；每次动过含中文文件后跑 `pnpm vitest run utils/mojibakeGuard.test.ts` + 字节扫 FFFD（诊断只打印 ASCII）。
- ✅ 上游 MCP 产品化合并已收尾（本地 `53dc9664`，已 push、已同步 VPS）：`collectMcpFireServers` 双方融合（ethernet relay 物化 + 上游 destructive 过滤/完整工具载荷），Settings 标题保留 ethernet StatusBadge，`APP_VERSION` 维持 `v3.8 (Slimdown)` 不随上游。上游 8df8e594 的等价合入到此完成。
- 本机开发环境：pnpm 不在 PATH，用 `corepack pnpm@9.15.9`（lockfile v9）；项目 `.npmrc` 指向腾讯镜像但经常 502，装依赖加 `--registry=https://registry.npmjs.org/`。git 身份仅本仓库配置为 **plasma953 / plasma953@users.noreply.github.com**（与 `18fd25f8` 一致）。
- ⚠️ 身份教训：Tosd0（ID 65720409）是真实存在的 GitHub 账号，是上游部分提交的**作者**，但 ethernet 的**提交者**必须是 plasma953。挑身份只认 `committer` 里 plasma953 的那条，不许从最近几条 log 照抄（2026-09-06 顶上 4 个 Tosd0 署名提交保持不动，不再改写）。
- tsc 全量有 48 个**存量**错误（MemoryPalaceApp/CompanionHome/activeMsgRuntime 等，含历史中文乱码），与 MCP 无关；判据：本次触碰的文件在 tsc 输出里零命中。
- 工作区几百个「已修改」文件是 **CRLF 噪音**（`core.autocrlf=true`），不是真实改动；commit 时只加真正动过的文件。
- 本仓库仍是 `CLAUDE.md` + docs 体系（上游已改叫 `AGENTS.md`，ethernet 未跟随）；项目事实以本文与 CLAUDE.md 文档地图为准。
