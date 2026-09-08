# ethernet 全系统筛查报告（2026-09-08）

> 方法：7 个只读 explore 子会话分域筛查（Wave 1-7）+ 主会话基线（Wave 0）。
> 分级：P0 数据丢失/计费事故 · P1 功能断链 · P2 边角/降级路径 · P3 文档漂移/死代码。
> 类别：bug / 契约偏离 / 文档漂移 / 死代码 / 安全隐患。
> 本报告只报不改；修复另起修复 plan。

## 0. 基线（Wave 0，主会话执行，2026-09-08）

- `corepack pnpm@9.15.9 vitest run --reporter=dot`：**421 文件 / 5069 用例，全部通过**（95s）
- `tsc --noEmit`：**48 行 `error TS`**，与存量记录一致（本次触碰文件：仅新增报告 md，无命中）
- `mojibakeGuard`：**通过**（全仓无 U+FFFD）
- `pnpm build:workers` 后 `git diff --stat -- worker/`：仅 `worker/post-office/worker.bundle.js` 1 文件 2+/3-（见下）
- 基线跑在**脏工作区**上：预先存在 5 个未提交修改（`apps/TerminalApp.tsx`、`components/terminal/FilesTab.tsx`、`types.ts`、`utils/opencodeClient.ts`、`utils/opencodeClient.test.ts`，终端功能 WIP，非本次产生，未动）

### Wave 0 追加发现（构建产物漂移，P2 安全隐患）

- 位置：`worker/post-office/src/index.ts`（`isAdmin` 去掉 `?token=` query 鉴权，只认 Bearer）vs 已提交的 `worker/post-office/worker.bundle.js`
- 现象：源码安全收紧（`fc0495be` 前后）后 bundle 未重建就提交了；本次 `build:workers` 补出 diff（`isAdmin(req,_url,env)`，删 token 查询分支）。若线上 Worker 按旧 bundle 部署，`?token=` 管理员鉴权仍有效（token 进 URL 易落日志）。
- 修法方向：本次重建产物已留在工作区（未提交），review 后随第三批提交；以后改 `worker/*/src` 必须同提交重建 bundle（`pnpm build:workers` 后 `git diff --stat -- worker/` 为空或预期内）。
- 验证：`corepack pnpm@9.15.9 run build:workers && git diff --stat -- worker/`

### Wave 3 发现 4 勘误

- 重建后 amsg bundle **零 diff**：bundle 与源码注释一致（均为"以前…定格 12 分钟…心跳压到 ~90s"过去时叙事），不存在"bundle 旧、源码新"的不一致。误导风险低，降为纯注释 polish（P3 不变，修法方向改为：不动；若仍担心误读，把"定格在 12 分钟"一句并入上一行"以前"之后）。

## 1. 汇总：P1（4 项，建议立修）

### P1-1 `/continue` 续跑绕过双通道 race，catch 直判 failed
- 位置：`utils/instantToolRunner.ts:214-238`
- 现象：Round-2 `/continue` 直接 `await reiClient.consumeInstantStream(...'/continue')`，外层 try/catch 抛错即 `emitToolStatus(failed)+return false`。iOS 切后台强杀 SSE（`TypeError: Load failed`，见 `docs/instant-push-dual-channel.md:33-36`）时，即使 worker 侧 `backupPush:'on'` 经 Web Push 把终态送到 SW，这条路也已提前判死。
- 根因假设：Round-2 runner 复用了旧语义（JSDoc 称 reject 为 canonical error），没接入 `deliver()+observed(active-msg-received)` 双通道判定。
- 验证：`rg -n "consumeInstantStream|sendInstantPushAndAwaitReply|pushArrived|observed" utils/instantPushClient.ts utils/instantToolRunner.ts docs/instant-push-dual-channel.md`
- 修法方向：`/continue` 同样走 `deliver({delivery:{mode:'observed',observed}})` 或等价 race＋8s grace，只看 `active-msg-received`；SSE reject 只 absorb 不判死。

### P1-2 中心 Worker 五处代理 SSRF 首检可被重定向绕过
- 位置：`worker/index.js:2665-2668`（`/expand-url`）、`:3030-3038`（`/fetch-webpage`）、`:2509-2515`（`/webdav`）、`:2775-2778`（`/bilibili/asset`）、`:2952-2955`（`/social/img`）
- 现象：首次 URL 都过 `isUnsafeFetchTarget()`，但出站 fetch 全部允许重定向跟随（前两处显式 `redirect:'follow'`，后三处默认 follow），无一处对 `res.url` 做二次校验。公网 URL 首检放行、302 跳 `169.254.169.254`/`127.0.0.1` 即可让 Worker 代打内网。
- 修法方向：统一 `redirect:'manual'`，手跟 1 跳并对每跳 Location 重跑 `isUnsafeFetchTarget`，超限/命中内网直接 400。
- 验证：`rg -n "redirect|res\.url|upstream\.url|isUnsafeFetchTarget" worker/index.js`

### P1-3 备份导出漏脱敏 `realtimeConfig` 全量 + `braveKey`
- 位置：`context/OSContext.tsx:4148,4263-4269` 进包；`utils/backupSecrets.ts:59-96` 脱敏清单无此两项
- 现象：`text_only`/`full` 包原样带出 `realtimeConfig` 全量和 `browserConfig.braveKey`。能填但导出不抹：`weatherApiKey/amapApiKey/newsApiKey(Brave)/notionApiKey(+databaseId)/feishuAppSecret(+三Id)/xhsMcpConfig.cookie/rnoteApiKey/userXsecToken`/透视窗随包字段/`braveKey`。备份包按设计会被到处传 = 明文密钥扩散。
- 根因：`realtimeConfig` 是后加配置簇，`backupSecrets.ts` 头注释"新增密钥先补这里"没被执行。
- 修法方向：加 `stripRealtimeConfig` + `browserConfig.braveKey` 清空（只清值留结构），先给 `backupSecrets.test.ts` 补用例；存量外发包无法召回，只修增量。

### P1-4 `memory_vectors` 不在备份口径内，静默丢失
- 位置：`utils/db.ts:391-394`（DB_VERSION=74 建表）vs `utils/backupCoverage.ts:15-89`（KNOWN/EXCLUDED 均无）
- 现象：按 `findUnregisteredBackupStores` 语义"不在 KNOWN 不进包"，备份丢整库向量。
- 修法方向（二选一并写进注释）：KNOWN 加 `memory_vectors` 并实现恢复映射，或 EXCLUDED 加它并注明"恢复后按 memory_nodes 重嵌"。当前静默丢失最差。

## 2. 汇总：P2（12 项）

| # | 位置 | 现象一句话 | 修法方向 |
|---|------|-----------|---------|
| 1 | `utils/opencodeClient.ts:173` | `buildOpencodeUrl` 硬拼 `?target=`，proxyUrl 自带 query 时双 `?` | 照抄 `mcpClient.ts:366-374` 的 sep 逻辑 + 补单测 |
| 2 | `apps/VoiceDesignerApp.tsx:316` | bake 用裸 `fetch('/api/minimax/bake-voice')`，自建 worker/静态部署无此路由 | 中心 worker 加 `/minimax/bake-voice` 编排；短期先加明确 toast |
| 3 | `utils/cityPlaces.ts:199-223` 等 | 城市镜像冷启动/清 localStorage/导入恢复不回填，上云 `userCity` 缺失 | 启动加载 + 导入恢复后各调一次 `writeUserCityMirror` |
| 4 | `utils/charOrder.ts:106-115` vs `BankApp.tsx:355` | `refund` 分类进今日支出统计虚增 `todaySpent`（现被 ownerId 过滤，仅口径隐患） | refund 归 `income` 或支出统计排除 refund + 单测 |
| 5 | `utils/memoryPalace/pipeline.ts:1175-1188` | legacy 兼容模式关宫殿不清空注入字段（脏数据躺 characters 行） | `!memoryPalaceEnabled` 时先置空再 return |
| 6 | `applyAssistantPostProcessing.ts:1709,1733` 等 | `[[XHS_SHARE: 1 ]]`（]] 前空格）检测/剥离双双失败，卡片静默不出 | 四处 `(\d+)\]\]` 改 `(\d+)\s*\]\]`，RECALL 同理 |
| 7 | `emotionEvalCore.ts:118`、`charMusicPersona.ts:37` + apps 约 40 处 | 裸 `fetch+res.json()` 无 SSE 整包兜底（关开关时代理强回流式即抛错） | 换 `safeFetchJson`（同 avatarTouch/companionStartup 形态） |
| 8 | `utils/safeApi.ts:536` | `extractContent` 只回退 reasoning_content，不认 reasoning/thinking | 回退链补齐与拼装器对齐 |
| 9 | `utils/instantToolRunner.ts:223-227` | `/continue` onError 当场置 failed，与"终态以 SW 广播为准"相悖 | onError 只 warn+trace，不置 failed |
| 10 | `utils/chatParser.ts:383-386` | musicHooks 为空时 MUSIC_ACTION 零日志蒸发 | 加 `console.warn`（与 375 行 snap 分支对齐） |
| 11 | `utils/bleToolBridge.ts:89,91,105` | 指纹 key 取归一化前，alias 写法 60s 内可重复下发 | resolve 后以 `device.id\|command.id` 覆盖 key + 补单测 |
| 12 | `vps-backend/deploy/scripts/secret-scan.sh:13-20` | 只扫 6 类通用 key，漏本仓 9 类（r8_/lat_sk_/ntn_/eyJ/amap/CLIENT_TOKEN 等）+ `sk-none` 误报 | 按设置页字段补模式，占位入白名单 |

另：`utils/charLedger.ts` 头注释失实（Phase 4 未调统一写入）归 P2 文档；Shopping/Takeout `fmtMoney` toFixed(1) 与 2 位口径不一致归 P2（展示统一 `formatMoney`）。

## 3. 汇总：P3（14 项，文档漂移/死代码/低风险）

1. `notes/ethernet-branch-context.md:42`：8831 端口错位一位（写 amsg，实为 instant-push；真相以 `services.js:57-83` + Caddyfile 为准）。只改文档。
2. `plans/amsg2-instant-chat-contract.md:160`：`serialize_group=charId` 未同步 `charId#kind`。改契约。
3. `worker/amsg/worker.bundle.js:14094`：残留"claimLeaseMs 定格 12 分钟"旧注释（源码+测试已是过去时+守卫）。重建 bundle（Wave 0 顺带确认）。
4. `utils/scheduleChange.test.ts:50`：注释"拼回不带空格"与 `applyAssistantPostProcessing.ts:326` 带空格实现相反。改注释+加带空格用例。
5. `utils/charLedger.ts:1-10` 头注释：Phase 4 只复用 `charDefaultCard` 未调统一写入。改注释或统一写入。
6. `types.ts:3338-3339`：注入字段"不持久化"注释失实（`saveCharacter` 原样 put，`context.ts` 自认）。改注释为"随整行持久化，读取侧过开关"。
7. `constants.tsx:141-143`：HIDDEN_APP_NAMES 漏 VoiceDesigner（统计盲区）。加一行，不动桌面注册。
8. `types.ts:760-807` vs `utils/realtimeContext.ts:54-99`：RealtimeConfig 双声明漂移（feishu 5 字段必填性、xhsEnabled、perspective 7 字段、`bluetoothEnabled`、`xhsMcpConfig` 形态）。以 types 为准，realtimeContext 改 import type。
9. `D:\sullyos\netlify\functions\webdav-proxy.ts`：全仓零调用方（已有两条 WebDAV 通道）。删或标废弃（先 git log 确认无外部部署依赖）。
10. `infra/Caddyfile` vs `vps-backend/deploy/caddy/SullyOS.Caddyfile`：重名误会（infra 是 umami 统计服务）。给 infra 首行加一句说明。
11. `server/bake-voice-middleware.ts` vs `api/minimax/bake-voice.ts`：178 行逐字重复双实现。按 `docs/code-organization-review.md:121` 既定方案抽核心（认领已知债 D4）。
12. `utils/proactivePushConfig.ts:24-25`：明文弱口令（FORCE_DISABLED=true 无流量）。服务端轮换作废 + 源码删常量 + secret-scan 加兜底。
13. `apps/CallApp.tsx:188-191` vs 共享层：TTS 错误中文化只活在 CallApp 私有链。搬进 `utils/minimaxTts.ts` 共享，Fish/ElevenLabs 对齐。
14. `worker/sw-keep-alive.ts:684-687`：default 未知 kind 落 content 写气泡。仅 `messageKind==null` 回落 content，未知非空 kind 改丢弃/dead-letter。
15. `worker/amsg/src/index.ts:3050-3088`：`/config-check` 免鉴权（有意设计，信息性，无需修；收紧可选限频或 `missing` 脱名）。
16. `utils/cityPlaces.ts:110-151`：多城缓存无 LRU 上限（配额 fragile 下可接受）。加 20 城上限即可。

## 4. 核实无问题（误报排除清单）

- Wave 1：`timelyByWorker` 门控完整（448/512/420/491/818）；flags 8 个全有下游；MCP 结果记忆双链注入是有意设计；指定四处 `stream:false` 全走 safeFetchJson；13 步注释与代码一致；RECALL 冒号后空格可匹配；SseAssembler 心跳/[DONE]/tool_calls/三 reasoning 方言/数组 thinking 全支持；volatileTailIndex -1 有回退；`skipSecondPassLLM+directives=[]` 属 Phase 1 设计。
- Wave 2：无 `/agent/v1/health` 调用；全部 `?target=` 生产拼接经编码；relay 常量名两端一致；backend-proxy 缺 BACKEND_HOST 必 500 与 README 一致；opencode 三要素单点带全；TTS 三家 key 不落 env。
- Wave 3：主路径已是 observed race；`send-failed` 映射仅 transport 死分支；SW 七分支齐全无错配；202 前 D1 落盘 + supersedesUuid 原子顶替；HMAC 常时比较 + UUID v4 强制；600s/60s 自洽；SW 兜底完整、失败不重投。
- Wave 4：主计算链统一 roundMoney/sumMoney；账本 ownerId 视口无错位；注入读取侧三处全被开关把关；除 memory_vectors 外无第二处漏备；TTL 逻辑与测试一致。
- Wave 5：AppID 全有 case；PersonaSim/DreamTheater 是活代码；番茄钟零风格违例；BLE 只记成功成立；豆瓣三失败全降级；WebDAV/TTS/STT/定位分叉均有意；VITE_ 六常量齐套。
- Wave 6：CORS 白名单齐（中心 + instant-push + amsg + 原样回显兜底）；无 Bearer 明文；.env.example 干净；stripBackupSecrets 已有覆盖 + 单测；最近提交无冲突。
- Wave 7：TTS 链完整；音乐跟随正确；冻歌字段对齐；生图门控有意（防烧额度）；latent/replicate key 透传；音频 Blob 持久化；协同库有独立备份路径。

## 5. 需真机/用户验证（代码层面只能查到逻辑正确）

1. 蓝牙：配对→枚举→写值→订阅→保存指令→角色触发全链（需桌面 Chrome + 真 BLE 设备）。
2. 推送：设置页「发送测试通知」端到端（用户亲手点）。
3. 手机端 API 预设换 opencode.ai 套餐后，自发一句即时对话触发凭据重登记。

## 7. 修复状态（2026-09-08 当晚，P1×4 + P2×14 + P3×13 全修，未提交）

- 全量回归：**427 文件 / 5109 用例全过**（基线 421/5069，新增 6 测试文件 +40 用例）
- `tsc --noEmit`：仍 48 行存量错误，与基线完全一致；本次触碰文件零新增（pipeline.ts 2 条 TS18048 经 stash 对照确认为改前即存在）
- `mojibakeGuard`：通过

| 编号 | 修复内容 | 文件 |
|------|---------|------|
| P1-1+P2-9 | /continue 改 observed deliver+race，onError 不再置 failed | instantToolRunner.ts + 新建测试 |
| P1-2 | 五处代理 redirect manual + 跳后复检 helper（Jina 保持 follow+注释） | worker/index.js + webdavProxy.test.ts |
| P1-3 | stripRealtimeConfig（15 字段清值留键）+ braveKey | backupSecrets.ts(.test.ts) |
| P1-4 | KNOWN 加 memory_vectors（方案 A，现成恢复链） | backupCoverage.ts(.test.ts) |
| P2-1 | proxyUrl 自带 query 时改 & 拼接 | opencodeClient.ts(.test.ts，主会话亲修） |
| P2-2 | 新增 POST /minimax/bake-voice + 前端优先 worker/回退相对路径/失败 toast | worker/index.js、VoiceDesignerApp、新建 minimaxBakeVoice.ts×2 测试 |
| P2-3 | 启动加载 + 导入恢复后回填城市镜像 | OSContext.tsx、cityPlaces.test.ts |
| P2-4 | refund category 改 income（一行）+ 新建 charOrder.test.ts | charOrder.ts |
| P2-5 | 宫殿关闭先清两注入字段再 return | pipeline.ts、trace.test.ts |
| P2-6 | 7+5 处正则 `]]` 前补 `\s*`（含主会话补的 MY_PROFILE 5 处） | applyAssistantPostProcessing.ts |
| P2-7 | emotionEvalCore 本地 SSE 拼装（零依赖叶子，不引 safeFetchJson）/ charMusicPersona + Chat.llmTranslate 换 safeFetchJson | emotionEvalCore.ts、charMusicPersona.ts、Chat.tsx |
| P2-8 | extractContent 回退补 reasoning/thinking | safeApi.ts |
| P2-10 | MUSIC_ACTION 无 hooks 加 warn | chatParser.ts |
| P2-11 | 指纹 key 改 resolve 后 device.id\|command.id | bleToolBridge.ts(.test.ts) |
| P2-12 | secret-scan 补 6 模式 + sk-none 白名单 | secret-scan.sh |
| P2-doc | charLedger 头注释修正；Shopping/Takeout 删本地 fmtMoney 走 formatMoney | charLedger.ts、ShoppingApp、TakeoutApp |

修复中转出的新发现（已修）：BankApp 今日支出未按 ownerId 过滤，角色负数流水漏进用户支出——353 行加载统计加 ownerId 排除（删除路径 434 行本就排除），charOrder.test.ts 加用例锁死。

### P3 修复（同日）

| 编号 | 修复内容 | 文件 |
|------|---------|------|
| P3-1 | 8831 端口文档错位修正（instant-push/amsg/余下三模块） | notes/ethernet-branch-context.md |
| P3-2 | 契约 serialize_group 补 charId#kind + 指向扩张篇 | plans/amsg2-instant-chat-contract.md |
| P3-4 | 测试注释"不带空格"改"带空格" + 加带空格解析用例 | scheduleChange.test.ts |
| P3-7 | HIDDEN_APP_NAMES 补 VoiceDesigner（统计盲区） | constants.tsx |
| P3-9 | 删除零调用 netlify webdav-proxy（配置/文档均无引用） | netlify/functions/webdav-proxy.ts（删） |
| P3-10 | infra/Caddyfile 首行注明统计专用、与 VPS 反代无关 | infra/Caddyfile |
| P3-11 | bake-voice 双实现抽共用核心 + 5 用例；worker 路由保持 edge 独立实现 | api/minimax/_bakeVoiceCore.ts（新）、api/minimax/bake-voice.ts、server/bake-voice-middleware.ts、_bakeVoiceCore.test.ts |
| P3-12 | 口令维持 kill-switch 不动；注释钉死"已泄露，重启用前必须服务端轮换"步骤 | proactivePushConfig.ts（仅注释） |
| P3-13 | MiniMax 映射下沉共享层（聊天/见面/番茄钟自动中文化）；鱼声对齐 ElevenLabs 风格 | minimaxTts.ts(+test)、CallApp.tsx（委托）、fishAudioTts.ts |
| P3-14 | SW 未知 kind 改丢弃+trace（缺字段老 worker 仍走 content） | worker/sw-keep-alive.ts（无单测：export 手术不值得，已逐行复核） |
| P3-16 | 城市缓存 20 城 LRU（淘汰失败不影响写入） | cityPlaces.ts(.test.ts) |
| P3-6/8 | 未动：types.ts 有终端 WIP，RealtimeConfig 双声明 + 注入注释两处留给 WIP 合并时顺手收 | — |

## 6. 修复分批建议

- 第一批（P1 四项 + P2 安全两项：proactivePush 明文轮换、secret-scan 补模式）。
- 第二批（P2 功能类 10 项）。
- 第三批（P3 文档/死代码，可一次 PR 清完）。
- 工作区现遗留 1 个未提交的构建产物更新（`worker/post-office/worker.bundle.js`，Wave 0 重建，含 isAdmin 收紧）：review 后可单独提交（英文 message），不属于筛查发现本身。
- 报告外：`pnpm build:workers` 漂移在 Wave 0 确认后若属实，随第三批重建提交。
