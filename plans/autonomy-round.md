# AI 自主生活（自主回合）· 设计与执行计划

> 状态：**定稿 v4，待执行**（2026-09-09 设计定稿，融入性分析修订已并入）
> 一句话：角色在用户不在线时按调度自主醒来一轮——冲浪/玩游戏(MCP)/记经历，大事才推送，
> 用户下次说话时用角色自己的口吻转述，转述即记忆形成路径。
> 借鉴来源：WrenWen（唤醒/欲望/落账纪律）、ai-surf-when-bored（选题框架/反刍闸/文案纪律）。

---

## 0. 现状与依赖（全部复用，不新造轮子）

| 机制 | 位置 | 本计划怎么用 |
|---|---|---|
| cron 每分钟一跳 | `utils/cfProvision.ts:37`（`crons: ['* * * * *']`） | 自主调度器挂在同一跳上 |
| 后台任务链 | `utils/activeMsgClient.ts:2469-2532`（scheduleBackgroundJob）→ `worker/amsg/src/fireKinds.ts:104-107`（注册表，现仅 plate）→ emitResult → 收件箱 → `utils/amsgResults.ts:66-133` 分发 | 新 kind `autonomous_round` 照 plate 样板接 |
| 串行分组 | `worker/amsg/src/index.ts:2559-2564`（`serializeBy charId#kind`） | 自主回合 `charId#autonomous_round` 自成一组，不挡聊天 |
| fire 工具循环 | `worker/amsg/src/index.ts:2449-2457` 三去处分派（排程三件套 / `mcp__` 直连 / 内置）；轮预算 `worker/amsg/src/agentic.ts:102-114`（无 MCP 5 轮 / 有 MCP 12 轮） | 自主回合复用同一循环 |
| fire_pack | `utils/activeMsgClient.ts:625`（buildFirePack）；内容 = 完整人格模板 + 最近 30 条对话（`utils/amsgFirePack.ts:112`）+ `lastUserMsgAt`（`:358`）；每轮聊完重传：`utils/amsgStateSync.ts:189`（flushAmsgState）→ `:232`（syncCharFirePacks） | 自主回合的 base prompt、对话尾巴、设置载体全从它来 |
| 结果推送 | emitResult 落收件箱 + 视通知策略推送（`worker/amsg/src/plateFire.ts:127-136` 样板） | big 经验推送走这条，无二次 LLM |
| 防打扰作废闸 | `utils/amsg2ExpireGuard.ts:64-80`（10 分钟窗口内有用户消息作废） | 作用于自主推送：用户活跃时推送作废、经历留 outbox 由转述块带出 |
| 未知 resultKind 兜底 | `utils/amsgResults.ts:117-127`（留着不销账，28 天保留） | 前端旧于 worker 时结果不丢 |
| IndexedDB 建表 | `utils/db.ts:219+`（版本化 onupgradeneeded） | 新增 outbox / heartbeat 两个 store |
| D1 懒建表先例 | `worker/post-office/src/index.ts:103-141`（`CREATE TABLE IF NOT EXISTS`） | amsg worker 的 schema 归上游 amsg-server 管（`worker/amsg/src/index.ts:2937-2939`），自主两张表在自主模块内懒建，不碰上游 schema 自查 |
| 失败熔断先例 | `utils/vrWorld/scheduler.ts:178-260`（VRScheduler：失败计数/熔断/reconcile，`:243-253` 对账教训） | 自主调度器同构 |
| 时区 | AMSG_SLOT_* 按角色 tzId 现算（`docs/character-timezone.md:66-68`） | 静默段/节奏按角色时区 |

---

## 1. 设计与取舍

### 1.1 已定稿的决策

- **系统排班一步到位**（用户选定）：调度器在 worker，不依赖角色自排；角色自排（`nextSuggest` /
  现有排程工具）作为叠加出口保留，不是主触发。
- **大事才推送**（用户选定）：小事只落 outbox 等转述；big 且当日推送配额未满才推。
- **人格保留三原则**（用户确认）：
  1. 自主回合 base prompt = fire_pack 的人格全文，框定语（TA 没在等你 / 属于你自己的一小会儿 /
     不用哄谁不用交代）**追加在后，不得以短 system 替代人格**；
  2. 任何会到用户眼前的话必须产自人格在场的轮；反刍闸换题的小调用允许无人格（输出只是搜索词，纯管道）；
  3. 转述发生在正常聊天（人格/情绪 buff/记忆全在场），转述风格格只管"怎么讲"不管"你是谁"。
- **自由度条款**（用户选定）：选题 prompt 明写「允许无聊、允许记碎、不追求有用」——把"记碎的、
  没用的"合法化，避免每条 note 都写成信息卡片；"做不做"由「歇」出口承担，条款不给软化指令。
- **note 信封规则**：输出契约里 JSON 只做信封，note 必须是第一人称随手记散文（口语、具体、有画面）；
  语气示例随模板预填（`noteStyleHint`）。
- **设置载体 = fire_pack 可选字段 `pack.autonomy`**（修订：原 v3 走 tool_config，但 tool_config 是
  全局 namespace（`utils/amsgToolPack.ts:25`、`amsg:global`），装不下按角色的设置；fire_pack 本就
  每轮聊完重传、带退避+底账（`utils/amsgStateSync.ts:365-422` 同套路已在），worker 对未知字段天然
  忽略 → 旧 worker + 新前端 = 自主关闭，优雅降级）。
- **自主回合前提：主动消息 2.0 已开启**（`activeMsg2Config.enabled`）。推送/凭据/fire 管线全来自
  2.0；不要求已排任务（这正是要拓宽的门，见 A3b）。
- **记忆路径**：经历落日记（走正常水位），转述后的对话轮被现有提取管线自然消化——**不做** fire 直写
  记忆宫殿的口子（单次写入远不够水位线，`utils/memoryPalace/waterline.ts:12-16`；转述即形成）。

### 1.2 借鉴映射（ai-surf-when-bored → 本计划）

| ai-surf 的做法 | 本计划落点 |
|---|---|
| 三句 system（她没在等你…） | B2 框定语，追加在人格全文后 |
| 「歇」出口（`<歇/>`） | 输出契约 `rest: true` → 只记心跳 |
| topic_hints（最近对话末 8 句×80 字，"没有就当没看见"） | B2 选题块，从 fire_pack 的最近对话取；缺包降级兴趣词 |
| 反刍闸（96h/12 页/撞 2 页拦）+ burnt lines 指名道姓 + 换题一次 | `autonomyRumination.ts` 纯函数，读 D1 experiences 表 |
| 禁清嗓子 + 洗链接 + 整句收笔（full_stop） | B2 后处理三件 |
| max_tokens 按理想长度×2 | B2 调用参数 |
| 喂回分寸语（别报流水账、别每轮都提） | C2 转述块固定分寸语 |
| 不搬：`:online` 调用（小手机已有 web_search 工具链）、暗标正则替代 tools（本项目 function calling 已通） | — |

### 1.3 已否决/修正

- ~~推送复用 maxUnansweredSends~~：result 推送不走 fire 的 self_log 计数（`amsgFirePack.ts:626-679`
  只数角色发出的消息），通道不同硬凑是错配。护栏改为：big-only + 每日配额 + 推送冷却 + 静默段。
- ~~转述块进 buildVolatileCoreState~~：那是全入口共享（见面/通话/群聊/520 都读），P0 只挂私聊主链
  （`utils/chatRequestPayload.ts` 非 timelyByWorker 分支）。
- ~~told 在 payload 构建时标~~：buildChatRequestPayload 会被重复跑（重新生成等），改为回复成功落库后标
  （applyAssistantPostProcessing），消息 metadata 记消费 id，重试幂等。
- ~~欲望九维仲裁~~：YAGNI，排班制已满足；留给后续演进。

---

## 2. 契约

### 2.1 AutonomySettings（随 fire_pack 上云，字符级字段见代码步骤）

```ts
type RetellStyle = 'battle'|'brief'|'casual'|'coquettish'|'diary'|'teaser'|'plain'|'custom';

interface AutonomySettings {
  enabled: boolean;                    // 默认 false；前提 activeMsg2Config.enabled
  templateId: 'night_player'|'morning_brief'|'surf_share'|'custom';
  overrides: AutonomyOverrides;        // 与模板的 diff；mergeAutonomySettings() 出终值
  version: 1;
}

interface AutonomyOverrides {
  cadence?: { minHours: number; maxHours: number };   // 随机窗口，默认 2–4h
  quietHours?: { start: string; end: string };        // 角色时区 "HH:mm"
  maxRoundsPerDay?: number;                            // 默认 2
  interests?: string[];                                // 兴趣词（无对话尾巴时的兜底）
  avoidTopics?: string[];
  retell?: { style: RetellStyle; maxItems: number /*5*/; maxChars: number /*800*/;
             opener?: boolean /*允许开场主动提起*/; customHint?: string };
  push?: { mode: 'off'|'big'; maxPerDay: number /*1*/; cooldownMinutes: number /*60*/ };
  tools?: { mcpAllow: string[] /*serverId 白名单*/; writable: boolean /*默认 false*/ };
  noteStyleHint?: string;                              // note 语气示例，随模板预填
  dailyTokenBudget?: number;                           // 默认常量兜底
}
```

四模板预填（`AUTONOMY_TEMPLATES`）：`night_player`（深夜玩家：2–4h、无静默、转述 battle、push big/1、
noteStyleHint 口语有画面）、`morning_brief`（情报早报：清晨窗口、转述 brief、push big/1）、
`surf_share`（冲浪分享：3–5h、转述 casual、push off、noteStyleHint 随手写给自己的）、
`custom`（全空）。模板只增数据不增执行分支。

### 2.2 D1（自主模块内懒建，`CREATE TABLE IF NOT EXISTS`，不碰上游 schema 自查）

```sql
CREATE TABLE IF NOT EXISTS autonomy_experiences (
  id TEXT PRIMARY KEY, char_id TEXT NOT NULL, created_at INTEGER NOT NULL,
  q TEXT NOT NULL, note TEXT NOT NULL, kind TEXT NOT NULL,
  importance TEXT NOT NULL,            -- 'big' | 'small'
  pushed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_autonomy_exp_char ON autonomy_experiences(char_id, created_at);

CREATE TABLE IF NOT EXISTS autonomy_state (
  char_id TEXT PRIMARY KEY,
  last_round_at INTEGER, last_push_at INTEGER,
  fail_streak INTEGER NOT NULL DEFAULT 0,
  rounds_date TEXT, rounds_today INTEGER NOT NULL DEFAULT 0,
  tokens_date TEXT, tokens_today INTEGER NOT NULL DEFAULT 0
);
```

保留期：调度器每跳顺带 `DELETE FROM autonomy_experiences WHERE created_at < now-7d`（反刍闸窗口
96h 的余量）。told 状态**不上云**（worker 不知道也不需要知道；fire 侧块取近几条不问 told）。

### 2.3 kind / resultKind

- 任务行：`metadata.amsgKind = 'autonomous_round'`、`messageSubtype: 'job'`（不进任务清单，
  `utils/amsgTaskKinds.ts:38-44` 语义）、输入走 `amsg:job`（TTL 3 天，`:56-62`）、
  `credRefs` 按现有每角色三行（`utils/amsgLlmCredentials.ts`）。
- 模型输出（两层容错解析，项目惯例）：
  `{ experiences?: [{ q, note, kind, importance }], rest?: true, nextSuggest?: 排程参数 }`。
  `usage` 不由模型报——取 LLM 响应自带 usage。
- resultKind：`autonomy_result`。worker emitResult 后把 experiences 落 D1 表 + 更新 autonomy_state；
  big 且配额/冷却/静默全过 → 置 pushed=1（推送文本 = note 原文，走 result 自带推送通道）。
- 客户端 dispatch case（`utils/amsgResults.ts` switch 加一支）：动态 import 新 handler →
  镜像进 outbox + 写日记 + 写心跳账 → 返回 true 销账。未落地失败返回 false 留账重试。

### 2.4 客户端 IndexedDB（db.ts 版本 +1，一次 upgrade 加两个 store）

```ts
// autonomous_outbox，keyPath 'id'，索引 [charId+ts]
{ id: string(/* = D1 id */), charId, ts, q, note, kind, importance: 'big'|'small',
  told: 0|1, toldBy?: number(/*消费它的消息 id*/), pushed: 0|1 }
// autonomous_heartbeats，keyPath 'id'，索引 [charId+ts]
{ id, charId, ts, wokeAt, did: 'surf'|'game'|'forum'|'rest'|'mixed',
  toolsUsed: string[], usage: { prompt, completion, total }, pushed: 0|1, outboxed: number }
```

### 2.5 转述块（P0 只进私聊主链）

- 取数：outbox 中 `told=0 && pushed=0` 按重要性排序，≤5 条 / ≤800 字（终值可配）。
- 注入位置：`buildChatRequestPayload` 组装 volatileTail 时插入（钢印之前，参照 amsg2 排程清单的
  `volatileTailIndex` 插法，`utils/chatRequestPayload.ts:122-130` 注释）。
- 块头 `[System: 离线自主经历]` + 固定分寸语：
  「你前几晚自己去网上逛过/玩过，记着这些——TA 聊到相关话头、或你自己想分享时自然带一句就好；
  别报流水账、别每轮都提。」+ 风格指令（7 格映射或 customHint 原样拼）。
- 空（无未消费条目）→ 整块不注入（"没查"与"查了没有"不共用出口的既有纪律）。
- fire 侧（worker）：self_log 槽位旁（`utils/amsgFirePack.ts:719-817` 渲染样板）从 D1 取近 4 条
  experiences 拼 block，不问 told，配同款分寸语。

---

## 3. 执行清单

### Phase A — 数据、模板与前端

- [ ] **A1. `utils/autonomySettings.ts`（新文件）**：按 §2.1 定义全部类型 + `AUTONOMY_TEMPLATES`
  （四模板预填，含 `noteStyleHint`）+ `mergeAutonomySettings(char): ResolvedAutonomy`（模板 × overrides
  深合并，只出终值；模板缺字段给常量默认：cadence 2–4h、maxRoundsPerDay 2、retell 5 条/800 字、
  push big/1/cooldown 60、budget 常量 `AUTONOMY_DAILY_TOKEN_BUDGET = 100_000`）。
  角色类型定义处（rg `memoryPalaceWaterline?: MemoryPalaceWaterlineConfig` 定位真身）加
  `autonomy?: AutonomySettings`。
  ⚡ `utils/characterCard.ts`：`CARD_STRIPPED_FIELDS` 第 3 类（`:49` memoryPalaceWaterline 旁）加
  `'autonomy'`——自定义/兴趣/白名单/enabled 不随分享卡外漏（`StrippedCardField` 在 `:82` 自动派生）。
  验收：`mergeAutonomySettings` 单测（模板全跟 / 单项覆盖 / 非法值回落默认三态）；
  `utils/characterCard.test.ts` 加断言 autonomy 被剥；backupRoundtrip 不炸。
- [ ] **A2. 前端面板 `components/character/AutonomyPanel.tsx`（新文件）**，挂进 `apps/Character.tsx`
  （rg 现有板块标题区定位）。复用 `apps/Settings.tsx:145-172` Section 折叠外壳 + `:345-377` 控件形态。
  结构：总开关（2.0 未开时显示引导门禁）→ 模板 4 卡片（点选预填五组）→ 五组自定义
  （节奏 min/max 滑杆 + 静默段 + 星期；兴趣词/避开 chip 输入；转述 7 格选择器 + 条数/字数 +
  opener 开关 + 手写框；push 档位/日上限/冷却；工具：MCP 白名单多选只列已启用 server + 「自主可写」
  总闸默认关）→ 状态只读行（读 autonomous_heartbeats：上次醒来/做了什么/token；停用/重开按钮，
  重开清 fail_streak 语义仿 `VRScheduler.start:194-196`）。改动经 `markAmsgStateDirty` 触发重传
  （角色保存路径已有调用，`apps/Character.tsx` 保存处确认覆盖）。
  验收：切模板五组联动预填；覆盖一项标题变"基于 XX 模板的自定义"；2.0 关闭时开关禁用+说明。
- [ ] **A3. 上云链路**：`utils/amsgFirePack.ts` 类型加可选字段 `autonomy?: AutonomySettings`
  （"不带即合法"模式，仿 `AmsgFirePackChat` `:879` 注释口径）；`buildFirePack`
  （`utils/activeMsgClient.ts:625`）打包时写入终值。
  ⚡ **A3b 拓宽打脏门**：`utils/amsgStateSync.ts:146`
  `if (!config?.enabled || !hasActiveAiTask(config)) return;` →
  `if (!config?.enabled || (!hasActiveAiTask(config) && !char.autonomy?.enabled)) return;`
  （autonomy 开启但没排任务的角色也开始每轮聊完重传 fire_pack——人格尾巴与设置都靠它新鲜；
  `amsgStateSync.gaps.test.ts` 的打脏调用点断言不受影响，`amsgStateSync.test.ts:168` fixedOnly
  用例语义复查）。fire_pack 版本号（`amsgFirePack.ts:829`）**不 bump**：可选字段向后兼容，旧 worker
  读不到 = 自主关闭。
  验收：改设置→切后台触发 flush→worker 侧可读到含 autonomy 的新包（wiring 测试断言 body）；
  没排任务但开自主的角色聊完一轮后 D1 fire_pack 更新。

### Phase B — 调度器与自主回合（worker）

- [ ] **B0. 定位 fire_pack 云端存储**（B1 的前置）：rg `worker/amsg/src/index.ts` 找
  `syncCharFirePacks` 对应的上传路由 handler，确认 fire_pack 落在哪张表/namespace（`client_state`
  或 per-char namespace）。产出：一行注释写进 autonomyStore.ts 头部。
- [ ] **B1. `worker/amsg/src/autonomyStore.ts`（新）+ `autonomyScheduler.ts`（新）**：
  store 持有 §2.2 两张表的懒建与读写（post-office 懒建样板）；scheduler 仿 VRScheduler 形态——
  cron 跳里被 index.ts 调用：扫描有 fire_pack 且 `pack.autonomy?.enabled` 的角色 → 逐条判
  （全部读终值）：距 `pack.lastUserMsgAt` > 随机窗口（min–max 内取随机，锚定用户最后消息）→
  今日已醒 < maxRoundsPerDay → 非静默段（角色 tzId）→ 距 last_push_at > cooldownMinutes →
  tokens_today < budget → fail_streak < 上限（常量 `AUTONOMY_FAIL_LIMIT = 3`，对标
  `vrWorld/scheduler.ts:34`）→ 全过才 `scheduleBackgroundJob` 等价物建 `autonomous_round` 任务行。
  每跳顺带清 7 天前 experiences。熔断：`report(charId, outcome)` 成功清零 / 失败累加、到限停建。
  验收：单测——到点建/静默不建/超限不建/冷却内不建/超预算不建/连续失败熔断/重开清账/
  7 天清理；仿 `vrWorld.test.ts:56`「连续调不通就掐」。
- [ ] **B2. `worker/amsg/src/autonomyFire.ts`（新）+ `autonomyRumination.ts`（新）+ 注册**：
  - `fireKinds.ts:104-107` 注册表加 `autonomous_round` + handler 接线；探测门/config-check 五处
    照 plate kind 补（rg `PLATE_CONSOLIDATE_RESULT_KIND` 全部引用点）。
  - handler 流程：读 fire_pack（人格全文 + 对话尾巴 + autonomy 终值）→ 组 prompt：
    人格全文在前 → 框定语（TA 没在等你 / 属于你自己的一小会儿 / 不用哄谁不用交代）→
    自由度条款（允许无聊、允许记碎、不追求有用）→ topic_hints（尾巴末 8 句×截 80 字，措辞
    "里头要有当时心里一动、这会儿想回头查查看的，就顺着去；没有就当没看见，不用汇报、不用接着聊"；
    缺包降级 interests + avoidTopics 禁区行）→ noteStyleHint → 工具块（复用 buildMcpFireBlock，
    `utils/mcpFireCore.ts:971-1007`）→ `rest` 出口明示。
  - 模型先出选题（`<surf>选题</surf>` 一行或直接调搜索工具）；选题过反刍闸：
    `autonomyRumination.ts` 纯函数——中文连续段拆二元组 + 拉丁 ≥3 词，撞近 96h/12 页中 ≥2 页
    → 拦 → burnt lines（各取最新搜索词，指名道姓列进禁区）当场换题一次 → 仍撞 → `rest`。
    常量 `RUMIN_WINDOW_H=96 / RUMIN_PAGES=12 / RUMIN_HIT_PAGES=2 / REPICK_ONCE=1`。
  - 经历生成调用：max_tokens = 理想长度×2（800×2），temperature 显式 0.4（只动 temperature 不动
    top_p）；后处理三件——禁清嗓子（指名禁用"翻到了/查到了/记一下/去查了一眼"，首句从数字/画面/
    推翻预期落笔）→ 洗链接（markdown 链接只留字 + 裸网址整抹）→ `fullStop()` 整句收笔
    （超帽裁进帽、尾巴退到最后整句、退无可退抹吊尾逗号）。
  - 输出两层容错解析 → experiences 落 D1 + autonomy_state 更新（rounds/tokens 用响应 usage）→
    emitResult（resultKind `autonomy_result`，附 usage/toolsUsed/did）→ big 推送判定
    （push.mode=big && 当日未推 && 冷却过 && 非静默）→ 过则置 pushed=1 随结果推。
  - 工具面收窄：内置读（web_search / XHS / 记忆读 / 日记读）+ `mcpAllow` 白名单内的 server；
    `readOnlyHint===false` 的工具默认禁，`tools.writable` 显式开才放；发帖/评论/下单类一律
    先记后问（对齐 `apps/Settings.tsx:614` 纪律）。越权调用拦截并记心跳。
  验收：wiring 测试（kind 注册五处齐，漏一处即红）；闸单测（第二回放行/第三回拦/换题成功/
  换题失败记 rest/burnt lines 进禁区行）；后处理单测（清嗓子开头被禁后八条八个开头没法测，
  至少断言禁用词不再出现在产出首句、链接被洗、断尾成整句）。
- [ ] **B3. 突变验红**（项目护栏纪律）：对反刍闸与推送配额各做一次"故意改坏→看红→改回"。

### Phase C — 落点、转述、推送（客户端）

- [ ] **C1. dispatch case + 落点三写**：`utils/amsgResults.ts` switch 加
  `case AUTONOMY_RESULT_KIND`（动态 import，首屏包纪律同 `:57-60` 注释）；新 handler
  `utils/autonomyResultApply.ts`：① 镜像 experiences → `autonomous_outbox`（told/pushed 置 0）；
  ② 日记追加（`utils/db.ts:1780` saveDiary，走正常水位，不管提取）；③ 心跳 →
  `autonomous_heartbeats`（usage/toolsUsed/did/pushed/outboxed）。单飞锁自持
  （dispatch 队列只是排队，"自己那份数据自己锁"，`utils/amsgResults.ts:50-52`——
  outbox 按 charId 排队，仿 mutatePlate）。验收：三份写全；并发两条结果落同一角色一前一后不互踩。
- [ ] **C2. 转述块**：`utils/chatRequestPayload.ts` 非 timelyByWorker 分支加组装步骤
  （§2.5 契约；`BuildChatPayloadResult` 加 `autonomyToldIds: string[]`，插入位置在钢印之前）；
  **told 在回复成功落库后标**：`utils/applyAssistantPostProcessing.ts` 助手消息持久化处
  （rg `:674` markAmsgStateDirty 同一函数内定位）读消息 metadata 的 toldIds → 批量置 told=1 +
  toldBy=消息 id。重新生成同一轮幂等（同 id 再标无副作用）。
  验收：单测——空/截断（>5 条取重要性 top）/told 后消失/pushed 不进块/群聊与约会 payload 不含块；
  手动——关页攒两条→回一句话→转述出现且措辞随风格格变→重新生成不丢。
- [ ] **C3. fire 侧块**：worker 渲染 fire_pack 时（`utils/amsgFirePack.ts:719-817` fillSlot 样板，
  worker 侧对应渲染函数）在 self_log 槽位旁拼近 4 条 experiences + 分寸语。验收：渲染单测
  （空/有/超长截断三态）。
- [ ] **C4. 推送文本**：随 B2 的 emitResult 已实现（pushed=1 的 result 推送文本 = note 原文）；
  expire guard 作废不补发（经历留 outbox，C2 会带出）——补一条注释在推送判定处说明这层互让。
  验收：静默段/冷却内/当日已推三种情形都不推且 experience 仍落 D1。

### Phase D — 护栏、备份、收尾

- [ ] **D1. 备份覆盖**：`utils/backupCoverage.ts:63` 映射表与 backup 导出 store 清单加
  `autonomous_outbox` + `autonomous_heartbeats`（经历是用户数据，随备份走；autonomy 设置随角色
  IndexedDB 已走）。验收：导出→导入 roundtrip 两个 store 全量回来。
- [ ] **D2. 全量测试**：`pnpm vitest run` 全绿（含 A1/A3b/B1/B2/C1/C2 的新增用例）。
- [ ] **D3. 端到端手验**：测试号开开关→关页→（调短窗口或等自然触发）→开页查心跳有记录→
  回一句话→转述出现→切模板下回合措辞变→big 推送到达（另一设备或通知栏）→关总开关→
  调度停建（worker 日志确认）。首日实测 token 量回填 budget 常量注释（"数值要自己量"）。
- [ ] **D4. 发版**：按 `utils/buildInfo.ts` 惯例评估 bump `APP_VERSION`；`docs/memory-system-overview.md`
  记一句"自主经历经转述进入提取管线"；`docs/character-timezone.md` 未接时区清单不变（本计划全程用
  角色 tzId，不新增设备时间依赖）。

---

## 4. 本次会触碰的文件清单（多窗口协调用）

**新增**：`utils/autonomySettings.ts`、`utils/autonomyResultApply.ts`、
`components/character/AutonomyPanel.tsx`、`worker/amsg/src/autonomyStore.ts`、
`worker/amsg/src/autonomyScheduler.ts`、`worker/amsg/src/autonomyFire.ts`、
`worker/amsg/src/autonomyRumination.ts` + 各自 .test.ts。

**修改**：`utils/types.ts`（或角色类型真身文件，A1 时 grep 定位）、`utils/characterCard.ts`、
`utils/characterCard.test.ts`、`utils/db.ts`（版本 +1、两 store）、`utils/backupCoverage.ts`、
`utils/amsgStateSync.ts`（`:146` 门拓宽）及其 test、`utils/amsgFirePack.ts`（类型 + fire 侧块渲染）、
`utils/activeMsgClient.ts`（buildFirePack 写 autonomy）、`utils/chatRequestPayload.ts`、
`utils/applyAssistantPostProcessing.ts`、`utils/amsgResults.ts`、`apps/Character.tsx`（挂面板）、
`worker/amsg/src/fireKinds.ts`、`worker/amsg/src/index.ts`（调度器接线 + cron 调用 + 探测门）、
`worker/amsg/src/index.test.ts`、`utils/buildInfo.ts`（D4 视情况）。

**不碰**：现有排程/推送默认行为、采样参数体系、记忆提取管线、`amsgInstantChat.ts`。

---

## 5. 边界与禁止

1. 不改现有排程/expire/推送链路的默认行为；自主推送是新增支路，不是改路。
2. 不动 temperature/top_p 的既有体系（自主经历调用内部显式 0.4 是新调用自己的参数，不碰主聊天）。
3. 模板只增数据；执行层只认 merge 终值，不得按 templateId 分支。
4. told 随轮消费即标，不做引用级精确标记；told 状态不上云。
5. 转述块 P0 不进见面/通话/群聊/520；fire 侧块不问 told。
6. 欲望九维仲裁、提取管线改造、通用网页抓取 fire 化、per-MCP-per-char 细粒度矩阵：不做。
7. 反刍闸阈值/模板预填是"方法可抄、数值自己量"：上线后按心跳账校准，不许拍脑袋调。
8. 多设备双转述是 local-first 既有边界，不做机制，文档记一句。

## 6. 延后项（列出不做，等情绪系统改版后动）

**情绪快照**：把最近一次 emotionEval 的 buff/innerState 摘要烤进 fire_pack，让自主时刻带心情底色。
预留接入点：`amsgFirePack.ts` 可选字段（仿 `:879` "不带即合法"）→ client 打包处写最近 buff 快照 →
worker 渲染拼进自主回合 prompt 的时钟块旁 → 快照带打包时刻、超 N 小时视为过期不拼（防旧情绪冒充
现在）。当前 fire_pack 不烤 volatile 是既有正确约定（`utils/chatPrompts.ts:364-366`），改版时一并
评估，本期不动。
