# 主动消息推送折叠 + 多设备推送 · 设计文档（2026-09-12）

> 状态：用户已批准（折叠 = 只响第一声、只留最后一条；多设备 = 电脑+手机同时推）。
> 执行计划：`docs/superpowers/plans/2026-09-12-amsg-push-collapse-multidevice-plan.md`。
> 范围：主动消息 2.0（`worker/amsg` 包装层）+ 前端推送面板。不碰依赖库 `@rei-standard/amsg-server` 的源码。

## 1. 背景

两个用户诉求：

1. **到点多条消息刷屏**：即时对话（instant chat）已按角色折叠（同 tag 只留最新一条、一轮只响第一声，见 `worker/amsg/src/instantChat.ts:122-179`）；但主动消息（定时任务结果）**有意不折叠**，每条结果一次推送、无 tag，一到点多条就堆满通知栏。
2. **电脑收不到推送**：桌面浏览器本身支持 Web Push，但后端 `push_subscriptions` 是「每用户一行」（`user_id` 主键），电脑注册会顶掉手机。

## 2. 目标与非目标

**目标**

1. 主动消息推送折叠：同一角色在通知栏只留最新一条（内容 = 最后一条）；同一批里第一条响、后续静默替换。
2. 电脑 + 手机同时收到推送（多端点广播），互不顶掉。
3. 设置页面板能识别「本机在登记列表中」，不再误报「登记的是别的设备」。

**非目标**

- 不改即时对话现有折叠策略（已实现且经过实测）。
- 不打补丁/不 fork `@rei-standard/amsg-server` 的「每用户一条主订阅」语义（保持库可升级）。
- 不做每设备独立开关/静音等精细管理。

## 3. 现状查证（2026-09-12）

- 即时对话折叠：`worker/amsg/src/instantChat.ts:122-179`（`instantNotificationTag = amsg-instant-<charId>`，首段 `renotify: true`）。
- 主动消息结果推送：库 `buildResultPush`（bundle 行 834）只保证 `notification.show='always'`，**无 tag**；`createResultEmitter.emitResult` 每条结果调一次 `sendResultPush` → 一条一推。
- 订阅存储：库表 `push_subscriptions(user_id 主键, subscription 密文, updated_at)`；`PUT /push-subscription`（bundle 行 4722）要求 `X-Payload-Encrypted: true` + `X-Encryption-Version: 1`，body 是 `{iv, authTag, encryptedData}` 信封，解密键 = `deriveUserEncryptionKey(userId, masterKey)`。
- 包装层能力：`worker/amsg/src/index.ts` 拥有请求入口 `fetch()`（3043，转发在 3230）和 `buildWorkerConfig()`（2507，webpush 构造在 2521）；已从 `@rei-standard/amsg-server/cloudflare` 导入 `decryptFromStorage`、`deriveUserEncryptionKey`（27-34 行），包根还导出 `decryptPayload`、`encryptForStorage`。
- 单用户部署：整个 amsg 实例只服务一个 userId；多设备表不需要按用户过滤发送。

## 4. 设计

### 4.1 推送折叠（Part 1）

新增纯函数模块 `worker/amsg/src/pushPolicy.ts`：

```
applyScheduledCollapse(bodyJson: string): string
```

- 解析失败/非对象 → 原样返回。
- 仅当满足全部条件才改写：`messageKind === 'result'`、`notification` 为普通对象、`notification.tag` 为空。
- 角色键优先级：`metadata.charId` → `metadata.contactName` → `contactName`；都取不到 → **不改写**（两个角色共用一个 tag 会互相顶掉、真丢消息）。
- 写入 `notification.tag = 'amsg-push-' + 键`；**不写 `renotify`**（浏览器行为：首次创建通知时响，之后同 tag 静默替换）。不改 `show` / `silent`。

不改即时对话（其 payload 自带 tag 或按 `messageKind` 不属于 `result`）；不改错误通知（`messageKind: 'error'`）和测试推送（已有 `sullyos-push-test` tag）。

### 4.2 多设备广播（Part 2）

全部在包装层实现，库保持「最后注册的主订阅」不动。

**存储**：新表（懒建，随注册/发送确保存在）

```sql
CREATE TABLE IF NOT EXISTS push_subscriptions_multi (
  endpoint_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  encrypted_subscription TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
```

- `endpoint_hash` = SHA-256(endpoint) hex：去重与死端点清理用，**不落明文 endpoint**。
- `encrypted_subscription` 用库同款 `encryptForStorage` 格式（密钥 = `deriveUserEncryptionKey(userId, AMSG_MASTER_KEY)`）。

**注册镜像**：包装层 `fetch()` 拦截 `PUT /push-subscription`，转发成功后 best-effort 执行：

1. 解析请求体 JSON 信封（`{iv, authTag, encryptedData}`）；
2. `decryptPayload(envelope, userKey)` 得到 `{ subscription, updatedAt? }`；
3. 校验订阅形状（非空 endpoint）→ `encryptForStorage` → 按 `endpoint_hash` upsert；
4. 上限 10 台：超出按 `updated_at` 删最旧。

客户端（`@rei-standard/amsg-client`）零改动，请求原样转发。

**广播发送**：`buildWorkerConfig` 里把 webpush 包一层 `withPushFanout`：

```
sendNotification(subscription, body):
  1. body = applyScheduledCollapse(body)
  2. 读多设备表；为空 → 用库主订阅播种（SELECT ... FROM push_subscriptions LIMIT 1，解密后 upsert）再读
  3. 收件人 = 表内全部条目；传入订阅不在表中则追加一次
  4. 串行发送（每条 decryptFromStorage 后调原始 transport）
  5. 404/410 → 删对应 endpoint_hash 行；全部失败才抛错（库的失败判定/补收逻辑不变）
```

单设备时与现状行为一致；`/push-test`、即时对话错误推送走的也是这个 transport，自动获得广播。

**删除语义**（避免重置一台误删全部）：

- 包装层拦截 `DELETE /push-subscription`：**不**清多设备表（只让库删它的主订阅行）。
- 新增包装层路由 `POST /push-subscription/remove`（鉴权口径与 `/push-test` 一致）：`{ endpointHash }` 删本机行；`{ all: true }` 清该用户全部行。
- 前端：`resetPushSubscription`/`deepResetPushSubscription` 额外调 `{ endpointHash }`（重置本机）；`deleteRemotePushSubscription` 额外调 `{ all: true }`（停用全部推送）。

**面板可见性**：包装层把 `GET /push-subscription` 响应补 `data.endpoints`（该用户已登记的 endpoint 列表，明文只回给已鉴权的同一用户）；前端 `compareRemotePushSubscription` 命中列表即显示「已登记（含本机）」。

### 4.3 安全与边界

- 服务端本来就能用主密钥解密订阅（库同款能力），本次不引入新密钥面；新表沿用密文落盘 + 端点哈希。
- `endpoints` 只回给通过鉴权的单用户部署，与现有 `endpoint` 字段同一信任域。
- iOS 某些版本对同 tag 替换支持不佳 → 退化为多条通知，不丢内容。
- 多设备 = 推送量 × N（上限 10 台）；死端点靠 404/410 清理。
- 老数据兼容：多设备表为空时从库主订阅播种，手机不需要重新注册。

## 5. 验收

- 单测：`pushPolicy`（tag 注入/不改写分支）、`pushFanout`（镜像、广播到 2 端点、主订阅播种、410 清理、上限、全失败抛错）、前端 compare/remove；原 `worker/amsg/src/index.test.ts` 全量回归。
- 门禁：全量 `vitest run` + `build:workers` + `tsc --noEmit`（触碰文件零命中）+ `utils/mojibakeGuard.test.ts`。
- 真机：多任务同时到点 → 每角色一条、只响第一声；手机+电脑各注册一次 → 同一消息两端都收到；重置电脑后手机仍收推。
