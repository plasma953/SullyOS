# 全手机地点逻辑整合（真实地点 API）· 设计文档

> 2026-09-06 · ethernet 分支 · 状态：已批准，实施中。
> 配套计划见正文末尾「实施顺序」；用户在神经链接设定角色城市、角色可自改（MOVE_TO），用户本人可用 GPS。

## 1. 背景与目标

现状（2026-09 实测）：地点相关功能分五层——角色级城市 `CharacterProfile.location`（结构化，可联动天气）、日程槽位 `slot.location`（自由文本）、各剧情 App 场景地点（LLM 自由文本）、用户 GPS（仅瑞幸点单用，不落库）、外卖/购物收货地址（自由文本 + cityTag）。真实地理 API 只用了 Open-Meteo（geocoding + 天气）和 timor.tech（节假日）。

目标：全部地点挂真实地点 API（高德），人物 / 日程 / 日历 / 世界 / 见面 / 搬家 / 用户档案的地点内容全部真实化，让 LLM 生成更有真实性。

## 2. 范围（做 / 不做）

- 做：神经链接地点卡、日程生成 + 注入、日历头、世界演绎、见面观测、MOVE_TO 验证、用户档案城市、实时世界块（角色城市行 + 用户那边段）、amsg2 worker 双城天气。
- 不做：外卖 / 购物（离线静态店面，按「每个城市都有」处理）；LifeSim / PersonaSim / CheckPhone / VRWorld / TRPG（纯装饰或房间制）；天气链路本身（已双源打通）。

## 3. API 选型与配额依据

- 高德 Web 服务 API（`restapi.amap.com/v3/`）：地理编码 `geocode/geo`、逆地理 `geocode/regeo`、输入提示 `assistant/inputtips`、POI 关键字搜索 `place/text`。用 Web 服务 Key（用户自备，存 `RealtimeConfig.amapApiKey`，localStorage）。
- 配额（2025-05 版，个人认证非商业免费）：基础 LBS（地理编码/逆地理）15 万次/月——管够；基础搜索（关键字/周边/输入提示）5000 次/月（约 166/天）——**地点库必须按城市缓存、低频拉取**，此为硬约束。
- 高德无海外权限（20011）：海外城市回落 Open-Meteo geocoding（全球覆盖、免 key，已在用）。
- 高德无 CORS 头：浏览器必须经代理调用（`worker/index.js` 新增 `/amap` 透传端点，path 白名单限 `/v3/` 前缀；key 由请求 query 透传，代理不存 key）。代理不可达则该轮无地点增强、不阻塞。
- GPS 坐标是 WGS-84，高德要 GCJ-02：叶子内置 `wgs84ToGcj02`（公开算法）；高德 `location` 参数格式为 `lng,lat`（经度在前），注意别写反。

## 4. 数据模型（types.ts，向后兼容）

```ts
// RealtimeConfig 新增
amapApiKey?: string;              // 高德 Web 服务 Key
userPerceptionEnabled?: boolean;  // 把用户那边告诉角色（未显式 false 即开）

// CharacterProfile.location 扩展（新增字段全可选，老数据零迁移）
{ province?, city, district?, lat?, lng?, adcode?, source: 'user'|'char', updatedAt }

// UserProfile 新增（用户侧不存坐标，隐私只到城市）
location?: { province?: string; city: string; source: 'gps'|'user'; updatedAt: number };
```

## 5. 模块设计

- `utils/amapCore.ts`（纯函数叶子）：URL 构造、响应解析、坐标转换、距离（haversine）、成段渲染器（全量清单 / 约会子集 / 用户那边段）、地点类别表（公园/商圈/咖啡/餐厅/影院/景点/学校/交通枢纽/书店/医院，约 10 类）。函数签名接 `{ proxyUrl, key }` 参数，不 import 浏览器依赖。
- `utils/cityPlaces.ts`（浏览器层）：IndexedDB 新 store `city_places`，按 adcode 缓存 `CityPlaceLibrary`；首用拉取（geocode 定 adcode → 每类 top6-8）；TTL 30 天（超期下次用时自动重拉）+ 设置页手动刷新/删除；失败返回 null（各注入点静默降级）。
- `utils/geoMatch.ts`：生成后对齐——归一化 + 分级匹配（全等 > 包含 > 编辑距离阈值），命中挂结构化地点（UI 显示真实地址/距市中心距离；住处基准 v1 取城市中心），未命中保留自由文本。
- 既有城市字段只有城市名时：后台惰性回填省/adcode/坐标（`backfillCharPlace`，防抖，不阻塞 prompt 组装）。

## 6. 各功能接入点

| 功能 | 改动 | 文件 |
|---|---|---|
| 实时世界块 | 新增「你所在的城市」结构化行 + 「用户那边」段（城市+天气+分寸提示） | `chatPrompts.ts`、`realtimeWorldCore.ts`、realtimeContext |
| 日程 | 生成 prompt 附全量地点库 + 真实地名指令 | `scheduleGenerator.ts`（注入侧 `scheduleInjection.ts` 不变） |
| 日历 | 头部并排显示用户城市天气（与角色城市不同时） | `ScheduleApp.tsx` |
| 世界 | 演绎 prompt 附约会子集；解析后对齐 | `worldHome/prompts.ts`、engine |
| 见面 | OBSERVE prompt 附约会子集；解析后对齐 place | `datePrompts.ts` |
| 搬家 | MOVE_TO 写库前地理编码验证（4s 超时），失败保留原文 | `chatParser.ts` |
| 神经链接 | 联想源切高德 inputtips（有 key 时），顺手存 adcode/坐标 | `Character.tsx` |
| 用户档案 | 「所在城市」卡：GPS（只取省市/adcode，街道级丢弃）/ 手填 / 清除 | `UserApp.tsx` |
| 设置 | 高德 Key + 连接测试 + 用户感知开关 + 地点库管理（列表/刷新/删除） | `Settings.tsx` |

## 7. amsg2 worker 联动

- `AmsgToolConfig` += `userCity`（4 个 `buildToolConfig` 调用点补传）；worker 按需 POI 不需要（生成侧全在浏览器），高德 key 不上云。
- `worker/amsg/src/realtimeWorld.ts`：天气快照键改为按城市分键 `world_weather:{city}`（旧键 30 分钟 TTL 自然过期）；`buildRealtimeWorldResult` 并行拉两城天气（共用 10s 预算），同一渲染器成段——聊天与到点同话。
- instant chat 路径实现时验证自动继承（合同 `plans/amsg2-instant-chat-contract.md`）。

## 8. 隐私边界（硬约束）

- 用户侧：只存省/市，不存坐标；prompt 只出现城市名 + 城市级天气；街道门牌级 regeo 结果直接丢弃；`userPerceptionEnabled` 一键关闭。
- 角色侧：虚构人物，地标级无此限制。
- 精确坐标仅在用户主动动作中使用（瑞幸点单，会话内存、不落库，现状不变）。

## 9. 测试与验收

- 新单测：`amapCore.test.ts`（URL/坐标转换往返+域外恒等/渲染器/开关组合）、`geoMatch.test.ts`、`cityPlaces.test.ts`（fake-indexeddb 走真 DB 层 + fetch mock）；扩展既有 amsgToolPack / worker realtimeWorld 测试。
- `pnpm build:workers` 通过；动中文文件后 `mojibakeGuard` + FFFD 字节扫；收尾 `pnpm vitest run` 全量；tsc 判据：本次触碰文件零命中（存量 48 错不动）。

## 10. 实施顺序

1. types + amapCore + geoMatch → 2. /amap 代理 → 3. cityPlaces → 4. 设置 UI → 5. 用户档案 → 6. 实时世界块 → 7. 神经链接 + MOVE_TO → 8. 日程 + 日历 → 9. 世界 + 见面 → 10. worker 联动 → 11. 全量回归。
