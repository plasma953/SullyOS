# 主动消息推送折叠 + 多设备推送 · 执行计划（2026-09-12）

> 设计：`docs/superpowers/specs/2026-09-12-amsg-push-collapse-multidevice-design.md`。
> 本计划按「弱执行者」标准编写：每步有文件路径、定位、代码意图/代码块、验收命令与预期。
> 铁律：
> 1. 不修改 `node_modules` 内的 `@rei-standard/amsg-server`；不改 `pnpm-lock.yaml`。
> 2. 不动另一条线（塔罗）的未提交文件：`apps/TarotApp.tsx`、`apps/tarot/*`、`plans/2026-09-11-tarot-*`。
> 3. 含中文文件改动后跑 `mojibakeGuard` + 字节扫 U+FFFD；写文件只用工具。

## 0. 前提

- 分支 `ethernet`；包管理器 `corepack pnpm@9.15.9`。
- 门禁命令：
  - 全量：`corepack pnpm@9.15.9 vitest run`（已知 storageOptimize / networkFailureDiagnosis 全量并发抖动，单跑能过即算过）
  - 构建：`corepack pnpm@9.15.9 build:workers`
  - 类型：`corepack pnpm@9.15.9 exec tsc --noEmit`（判据：本次触碰文件零命中，存量 45 条不算）
  - 乱码：`corepack pnpm@9.15.9 vitest run utils/mojibakeGuard.test.ts`

## 1. 折叠策略模块（Part 1）

### Step 1.1 新建 `worker/amsg/src/pushPolicy.ts`

内容（完整意图）：

```ts
/**
 * 主动消息推送的折叠策略（见 docs/superpowers/specs/2026-09-12-amsg-push-collapse-multidevice-design.md）。
 * 只处理 messageKind === 'result' 的推送：无 tag 时按角色注入 tag，让通知栏只留最新一条；
 * 首条创建时浏览器照常响铃，后续同 tag 静默替换（不写 renotify）。
 * 即时对话/错误通知/测试推送有自己的 tag 或不属于 result，一律不碰。
 */
export const SCHEDULED_PUSH_TAG_PREFIX = 'amsg-push-';

export function applyScheduledCollapse(bodyJson: string): string {
  // 1) JSON.parse 失败/非普通对象 → 原样返回（吞掉异常）
  // 2) messageKind !== 'result' → 原样返回
  // 3) notification 非普通对象 → 原样返回
  // 4) notification.tag 是非空字符串 → 原样返回（已有折叠者优先）
  // 5) 键：metadata.charId（string 非空）→ `char:` 前缀；
  //      否则 metadata.contactName / payload.contactName（string 非空）→ `name:` 前缀；
  //      否则原样返回（不折叠，防两个角色共 tag 互相顶掉）
  // 6) 返回 JSON.stringify({...payload, notification: {...notification, tag: SCHEDULED_PUSH_TAG_PREFIX + key}})
  //    注意：不添加 renotify；不覆盖 show/silent
}
```

### Step 1.2 新建 `worker/amsg/src/pushPolicy.test.ts`

用例（每条一个 `it`）：

1. `messageKind:'result'` + 无 tag + `metadata.charId='c1'` → tag 为 `amsg-push-char:c1`，且 `notification` 上**没有** `renotify` 键。
2. 已有 tag → 原样返回（字符串全等）。
3. `messageKind:'content'` / `'error'` / `'test'` → 原样返回。
4. 无 `notification` → 原样返回。
5. 无 charId、有 `contactName` → 用 `name:` 键；两者都无 → 原样返回。
6. 非法 JSON → 原样返回。
7. 即时对话真实形状的样例（带自己的 tag）不被二次改写。

验收：`corepack pnpm@9.15.9 vitest run worker/amsg/src/pushPolicy.test.ts` 全绿。

## 2. 多设备广播模块（Part 2）

### Step 2.1 新建 `worker/amsg/src/pushFanout.ts`

接口与行为（实现时可直接照此写）：

```ts
export const MULTI_TABLE_DDL = `CREATE TABLE IF NOT EXISTS push_subscriptions_multi (
  endpoint_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  encrypted_subscription TEXT NOT NULL,
  updated_at INTEGER NOT NULL
)`;

export async function hashEndpoint(endpoint: string): Promise<string>;
// SHA-256 hex（crypto.subtle.digest）；输入 trim 后编码 UTF-8

export async function ensureMultiTable(db: any): Promise<void>;
// db.prepare(MULTI_TABLE_DDL).run()；吞「表已存在」类错误

export async function mirrorRegistration(args: {
  db: any; masterKey: string; userId: string;
  envelope: { iv: string; authTag: string; encryptedData: string };
}): Promise<boolean>;
// userKey = await deriveUserEncryptionKey(userId, masterKey)
// payload = await decryptPayload(envelope, userKey)      // 来自 '@rei-standard/amsg-server/cloudflare'
// subscription = payload?.subscription；校验 endpoint 非空字符串，否则 return false
// encrypted = await encryptForStorage(JSON.stringify(subscription), userKey)
// hash = await hashEndpoint(endpoint)
// upsert：INSERT ... ON CONFLICT(endpoint_hash) DO UPDATE SET encrypted_subscription=..., updated_at=...
// 上限 10：DELETE FROM ... WHERE endpoint_hash IN (SELECT endpoint_hash FROM ... ORDER BY updated_at ASC LIMIT -1 OFFSET 10)
// 全程 try/catch → 失败 console.warn 并 return false（镜像失败不能影响主流程）

export async function removeByEndpointHash(db: any, endpointHash: string): Promise<void>;
export async function removeAllForUser(db: any, userId?: string | null): Promise<void>;
// userId 为空 = 单用户部署，清全表

export async function seedFromPrimary(db: any, masterKey: string): Promise<void>;
// row = SELECT user_id, subscription FROM push_subscriptions LIMIT 1
// 无 row 或表不存在 → 静默返回
// userKey = derive(user_id)；subscription = JSON.parse(decryptFromStorage(row.subscription, userKey))
// upsert（同 mirror 的落库形状；updated_at 用 Date.now()）

export async function listRecipients(db: any, masterKey: string): Promise<Array<{ endpointHash: string; subscription: any }>>;
// SELECT endpoint_hash, user_id, encrypted_subscription FROM push_subscriptions_multi ORDER BY updated_at DESC
// 逐行 decryptFromStorage → JSON.parse；解不开的行跳过（不删，留人工排查）

export function withPushFanout(webpush: any, deps: { db: any; masterKey: string }): any;
// 返回新对象（Object.create(webpush) 风格，保留其余字段）
// sendNotification(subscription, body):
//   1) body = applyScheduledCollapse(body)      （import 自 ./pushPolicy）
//   2) await ensureMultiTable(db); await seedFromPrimary(db, masterKey)（表空时才播种：先 listRecipients，空再 seed）
//   3) recipients = listRecipients；传入 subscription 的 hash 不在列表 → push 进列表（endpoint hash 现算）
//   4) 全空 → 直接 webpush.sendNotification(subscription, body) 并返回
//   5) 串行 for；每发失败：
//        status = err?.statusCode ?? err?.status
//        status === 404 || 410 → removeByEndpointHash(该行)
//        记录 lastError；成功计数++
//   6) 成功 ≥1 → return 最后一次成功结果；否则 throw lastError
```

要点：单用户部署不做 userId 过滤；`withPushFanout` 只包 `sendNotification`，其余方法透传；错误对象上 `statusCode` 兼容库的 `tagPushStatusCode` 口径（实现时对照 `worker/amsg/worker.bundle.js` 的 `tagPushStatusCode`）。

### Step 2.2 新建 `worker/amsg/src/pushFanout.test.ts`

假 D1：参考 `worker/amsg/src/index.test.ts` 里已有的 fake DB 模式（`.prepare().bind().run()/first()/all()`）。

用例：
1. `mirrorRegistration`：用真实加密工具（`deriveUserEncryptionKey`+`encryptPayload`）造信封 → 落表一行；同 endpoint 再注册 → 仍一行且 `updated_at` 更新。
2. 上限：注册 11 个不同 endpoint → 表内 10 行（最旧被删）。
3. `withPushFanout`：表内 2 端点 → 一次 `sendNotification` 调了 2 次原始 transport；`body` 是折叠改写后的。
4. 播种：多设备表空、`push_subscriptions` 有主订阅 → 先播种再广播（原始 transport 收到 1 次）。
5. 410：一个端点返回 `{statusCode:410}` → 该行被删，另一个端点仍收到。
6. 全失败：两个端点都抛错 → `sendNotification` 抛出最后一个错误。
7. 单设备：表内只有传入的端点 → 只发一次（不重复）。

验收：`corepack pnpm@9.15.9 vitest run worker/amsg/src/pushFanout.test.ts` 全绿。

### Step 2.3 接线 `worker/amsg/src/index.ts`

1. **imports**（27-34 行）：在 `@rei-standard/amsg-server/cloudflare` 的解构里追加 `decryptPayload`、`encryptForStorage`；新增 `import { withPushFanout, mirrorRegistration, removeByEndpointHash, removeAllForUser, hashEndpoint, ensureMultiTable } from './pushFanout';`。
2. **`buildWorkerConfig`（2507 起）**：`const webpush = createHybridPushTransport(...)`（2521）之后包一层：
   `const webpushWithFanout = withPushFanout(webpush, { db: env.DB, masterKey: (env.AMSG_MASTER_KEY || '').trim() });`
   返回的 config 里 `webpush: webpushWithFanout`（含 instantErrorPushDeps 那一份，2523-2526 同步改用它）。
3. **`fetch()` 拦截（3043 起，转发 3230 前）**：
   - `PUT` + `url.pathname === '/push-subscription'`：
     ```
     const cloned = request.clone();
     const res = await upstream.fetch(request, env);   // 原请求照常转发
     if (res.ok) { try { const raw = await cloned.text(); const env2 = JSON.parse(raw);
        if (env2 && typeof env2.iv === 'string' ...) await mirrorRegistration({ db: env.DB, masterKey, userId: request.headers.get('x-user-id') || '', envelope: env2 });
     } catch (e) { console.warn('[amsg] push 镜像失败(忽略):', e?.message); } }
     return res;
     ```
     注意：必须用 clone 读 body（原请求要转发）；拦截分支放在现有 `/push-test` 等自有路由附近。
   - `POST` + `url.pathname === '/push-subscription/remove'`：新自有路由，鉴权口径与 `/push-test` 一致（读 `X-Client-Token`，错则 401/403）；body `{ endpointHash?: string; all?: boolean }`；`all` → `removeAllForUser(env.DB)`，否则校验 64 位 hex 的 `endpointHash` → `removeByEndpointHash`；返回 `{ ok: true }`。
   - `DELETE` + `url.pathname === '/push-subscription'`：转发前后都不动多设备表（设计 4.2）。
   - `GET` + `url.pathname === '/push-subscription'`：转发后若 200 JSON，则补 `data.endpoints`（`SELECT endpoint_hash` 无法反查明文——改为读表解密后收集 `subscription.endpoint`；解密失败跳过；表空时先 `seedFromPrimary`）。响应体重建为 `Response`（保留 status 与 content-type），失败则原样返回。
4. **`sendInstantErrorPush`（787-900 附近）**：无需改逻辑（它的 `deps.webpush` 已经是包装后的 transport，自动广播）。
5. **`worker/amsg/src/instantChat.ts:142`**：注释里「主动消息……既不折叠也不静音」改为「主动消息的折叠在推送出口统一做（见 pushPolicy.ts）：同角色只留最新一条、只响第一声」。

### Step 2.4 扩展 `worker/amsg/src/index.test.ts`

- 现有 PUT `/push-subscription` 用例保持全绿（镜像失败不影响响应）。
- 新增一条：PUT 成功后多设备表有行（fake DB 检查 INSERT 语句）。
- 新增一条：`POST /push-subscription/remove` 的鉴权与 `{all:true}` / `{endpointHash}` 分支。

验收：`corepack pnpm@9.15.9 vitest run worker/amsg/src/index.test.ts` 全绿。

## 3. 前端（面板 + 重置语义）

### Step 3.1 `utils/pushSubscribeShared.ts`

新增：

```ts
/** 端点哈希：与 worker 端 pushFanout.hashEndpoint 同口径（SHA-256 hex，trim 后 UTF-8）。 */
export async function hashPushEndpoint(endpoint: string): Promise<string>;
```

### Step 3.2 `utils/activeMsgClient.ts`

- `AmsgRemotePushSubscription`（120 行附近）加 `endpoints?: string[]`。
- `compareRemotePushSubscription`（146 行）：`remote.endpoints?.includes(localEndpoint)` 为真 → 直接返回 `'matched'`；其余分支不变。
- `getRemotePushSubscription`（1636 行）：把响应里的 `endpoints` 透传进返回值。
- `deleteRemotePushSubscription`（1663 行）：在 `client.deletePushSubscription()` 之后增加 best-effort 调 `POST /push-subscription/remove { all: true }`。
- `resetPushSubscription`（1702）/`deepResetPushSubscription`（1730）：在删除后、重订阅前，用浏览器当前 endpoint 算 `hashPushEndpoint` 调 `{ endpointHash }`（best-effort，失败不阻断）。
- 新私有方法 `removeFanoutEndpoint(body)`：统一发 `POST /push-subscription/remove`，带既有鉴权头（照抄同文件其它请求的 header 构造）。

### Step 3.3 `components/settings/PushSubscriptionPanel.tsx`

- `REGISTRATION_TEXT.matched` 文案改为「已登记（含本机）」。
- 面板「云端登记」行在有 `endpoints` 时追加设备数（如「已登记（含本机） · 共 2 台」）。

### Step 3.4 测试

- `utils/pushSubscribeShared.test.ts`：`hashPushEndpoint` 与已知向量对齐（可用 node crypto 预算的固定值）。
- `utils/activeMsgClient.test.ts`：compare 含 `endpoints` 命中/未命中；`remove` 请求的 URL/body；reset 流程发出 `endpointHash`（fake fetch）。

验收：`corepack pnpm@9.15.9 vitest run utils/pushSubscribeShared.test.ts utils/activeMsgClient.test.ts` 全绿。

## 4. 门禁

- Step 4.1 `corepack pnpm@9.15.9 vitest run worker/amsg/src/pushPolicy.test.ts worker/amsg/src/pushFanout.test.ts worker/amsg/src/index.test.ts utils/activeMsgClient.test.ts utils/pushSubscribeShared.test.ts`。
- Step 4.2 `corepack pnpm@9.15.9 build:workers`（`worker/amsg/worker.bundle.js` + `public/amsg-worker.bundle.js` 变化；确认 diff 只含本次逻辑）。
- Step 4.3 全量 vitest + tsc（触碰文件零命中）+ mojibake。

## 5. 部署与真机验证

- Step 5.1 `notes/ethernet-branch-context.md` 记录一条（折叠策略 + 多设备镜像广播 + 部署事实）。
- Step 5.2 提交 + push（等用户确认提交范围）。
- Step 5.3 VPS：`git pull` + `systemctl restart sullyos`（workdir `/opt/sullyos/sullyos-repo`）。
- Step 5.4 真机：
  1. 手机重开 App → 设置 → 主动消息 → 推送面板：显示「已登记（含本机）」；
  2. 电脑浏览器打开同一页面 → 「创建推送订阅」→ 面板两端都显示含本机、共 2 台；
  3. 造一条多段主动消息（或点「发送测试通知」后触发角色多段回复）→ 通知栏每角色只留最新一条、只响一声；
  4. 电脑「重置订阅」→ 手机仍能收到推送。

## 6. 回滚

- 代码回滚 `worker/amsg/src/{pushPolicy,pushFanout}.ts` + `index.ts` 的相关提交，重跑 `build:workers` 并重部署即可；新表可留在库里（不注册则空转，无副作用）。
