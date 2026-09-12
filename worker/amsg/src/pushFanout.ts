/**
 * 多设备推送广播（见 docs/superpowers/specs/2026-09-12-amsg-push-collapse-multidevice-design.md）。
 *
 * 依赖库 `@rei-standard/amsg-server` 的推送订阅是「每用户一行」，后注册的设备会顶掉
 * 先前那台。这里在包装层补一张自己的表 `push_subscriptions_multi`：
 *   - 注册时镜像（PUT /push-subscription 转发成功后解密信封、按 endpoint 去重落库）；
 *   - 发送时广播（拆封逐条发送；404/410 只清对应那行）。
 * 库的「主订阅」语义完全不动，只作为表为空时的播种来源（兼容存量注册）。
 *
 * 端点不落明文：表里只存 endpoint 的 SHA-256（去重/清理用）和库同款加密的订阅密文。
 */
import {
  decryptFromStorage,
  decryptPayload,
  deriveUserEncryptionKey,
  encryptForStorage,
} from '@rei-standard/amsg-server/cloudflare';
import { applyResultPushPolicy } from './pushPolicy';

export interface FanoutStatement {
  bind(...args: unknown[]): FanoutStatement;
  run(): Promise<unknown>;
  first(): Promise<Record<string, unknown> | null>;
  all(): Promise<{ results?: Array<Record<string, unknown>> }>;
}

export interface FanoutDb {
  prepare(sql: string): FanoutStatement;
}

/** 多设备上限：超出按 updated_at 淘汰最旧（老设备换浏览器后留下的死行）。 */
export const MAX_FANOUT_DEVICES = 10;

export const MULTI_TABLE_DDL = `CREATE TABLE IF NOT EXISTS push_subscriptions_multi (
  endpoint_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  encrypted_subscription TEXT NOT NULL,
  updated_at INTEGER NOT NULL
)`;

export async function hashEndpoint(endpoint: string): Promise<string> {
  const bytes = new TextEncoder().encode(String(endpoint || '').trim());
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

const endpointOf = (subscription: unknown): string => {
  const value = (subscription as { endpoint?: unknown } | null)?.endpoint;
  return typeof value === 'string' ? value.trim() : '';
};

const isSubscriptionShape = (subscription: unknown): boolean => endpointOf(subscription).length > 0;

export async function ensureMultiTable(db: FanoutDb): Promise<void> {
  try {
    await db.prepare(MULTI_TABLE_DDL).run();
  } catch {
    /* 表已存在或适配器不支持显式建表：读写路径各自容错 */
  }
}

async function upsertSubscriptionRow(
  db: FanoutDb,
  args: { endpointHash: string; userId: string; encrypted: string; updatedAt: number },
): Promise<boolean> {
  await db.prepare(
    `INSERT INTO push_subscriptions_multi (endpoint_hash, user_id, encrypted_subscription, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(endpoint_hash) DO UPDATE SET
       user_id = excluded.user_id,
       encrypted_subscription = excluded.encrypted_subscription,
       updated_at = excluded.updated_at`,
  ).bind(args.endpointHash, args.userId, args.encrypted, args.updatedAt).run();
  // 上限淘汰：D1 / better-sqlite3 都支持 LIMIT 子查询，但为可移植与可测走两步。
  const rows = await db.prepare(
    'SELECT endpoint_hash FROM push_subscriptions_multi ORDER BY updated_at DESC',
  ).all();
  const stale = (rows?.results || []).slice(MAX_FANOUT_DEVICES);
  for (const row of stale) {
    const hash = typeof row.endpoint_hash === 'string' ? row.endpoint_hash : '';
    if (!hash) continue;
    await db.prepare('DELETE FROM push_subscriptions_multi WHERE endpoint_hash = ?').bind(hash).run();
  }
  return true;
}

async function decryptStoredSubscription(
  row: Record<string, unknown>,
  masterKey: string,
): Promise<{ userId: string; subscription: unknown } | null> {
  const stored = row?.subscription;
  const userId = row?.user_id;
  if (typeof stored !== 'string' || !stored || typeof userId !== 'string' || !userId) return null;
  try {
    const userKey = await deriveUserEncryptionKey(userId, masterKey);
    return { userId, subscription: JSON.parse(await decryptFromStorage(stored, userKey)) };
  } catch {
    // 个别老部署存的是明文 JSON（与 readPushSubscriptionRow 同口径）。
    try {
      return { userId, subscription: JSON.parse(stored) };
    } catch {
      return null;
    }
  }
}

/**
 * 把一次 PUT /push-subscription 的加密信封镜像进多设备表。
 * 任何失败都吞掉并返回 false——镜像只是广播的加分项，绝不能影响注册主流程。
 */
export async function mirrorRegistration(args: {
  db: FanoutDb;
  masterKey: string;
  userId: string;
  envelope: unknown;
}): Promise<boolean> {
  const { db, masterKey, userId, envelope } = args;
  if (!db || !masterKey || !userId) return false;
  const env = envelope as { iv?: unknown; authTag?: unknown; encryptedData?: unknown } | null;
  if (!env || typeof env.iv !== 'string' || typeof env.authTag !== 'string' || typeof env.encryptedData !== 'string') {
    return false;
  }
  try {
    const userKey = await deriveUserEncryptionKey(userId, masterKey);
    const payload = await decryptPayload(env as { iv: string; authTag: string; encryptedData: string }, userKey);
    const subscription = (payload as { subscription?: unknown } | null)?.subscription;
    if (!isSubscriptionShape(subscription)) return false;
    await ensureMultiTable(db);
    const encrypted = await encryptForStorage(JSON.stringify(subscription), userKey);
    return await upsertSubscriptionRow(db, {
      endpointHash: await hashEndpoint(endpointOf(subscription)),
      userId,
      encrypted,
      updatedAt: Date.now(),
    });
  } catch (error) {
    console.warn('[amsg:push-fanout] 注册镜像失败（忽略）:', error instanceof Error ? error.message : error);
    return false;
  }
}

/** 从原始请求体（JSON 信封字符串）镜像；解析失败返回 false。 */
export async function mirrorPushSubscriptionRequest(args: {
  db: FanoutDb;
  masterKey: string;
  userId: string;
  rawBody: string;
}): Promise<boolean> {
  let envelope: unknown;
  try {
    envelope = JSON.parse(args.rawBody);
  } catch {
    return false;
  }
  return mirrorRegistration({ ...args, envelope });
}

export async function removeByEndpointHash(db: FanoutDb, endpointHash: string): Promise<void> {
  if (!/^[a-f0-9]{64}$/i.test(endpointHash)) return;
  await ensureMultiTable(db);
  await db.prepare('DELETE FROM push_subscriptions_multi WHERE endpoint_hash = ?').bind(endpointHash).run();
}

export async function removeAllForUser(db: FanoutDb, userId?: string | null): Promise<void> {
  await ensureMultiTable(db);
  if (userId) {
    await db.prepare('DELETE FROM push_subscriptions_multi WHERE user_id = ?').bind(userId).run();
  } else {
    await db.prepare('DELETE FROM push_subscriptions_multi').run();
  }
}

/** 多设备表为空时，用库的主订阅行播种一次（存量设备不需要重新注册）。 */
export async function seedFromPrimary(db: FanoutDb, masterKey: string): Promise<void> {
  if (!db || !masterKey) return;
  try {
    const row = await db.prepare('SELECT user_id, subscription FROM push_subscriptions LIMIT 1').first();
    if (!row) return;
    const decoded = await decryptStoredSubscription(row, masterKey);
    if (!decoded || !isSubscriptionShape(decoded.subscription)) return;
    await ensureMultiTable(db);
    const userKey = await deriveUserEncryptionKey(decoded.userId, masterKey);
    await upsertSubscriptionRow(db, {
      endpointHash: await hashEndpoint(endpointOf(decoded.subscription)),
      userId: decoded.userId,
      encrypted: await encryptForStorage(JSON.stringify(decoded.subscription), userKey),
      updatedAt: Date.now(),
    });
  } catch (error) {
    console.warn('[amsg:push-fanout] 主订阅播种失败（忽略）:', error instanceof Error ? error.message : error);
  }
}

export interface PushRecipient {
  endpointHash: string;
  endpoint: string;
  subscription: unknown;
}

export async function listRecipients(db: FanoutDb, masterKey: string): Promise<PushRecipient[]> {
  if (!db || !masterKey) return [];
  try {
    const rows = await db.prepare(
      'SELECT endpoint_hash, user_id, encrypted_subscription FROM push_subscriptions_multi ORDER BY updated_at DESC',
    ).all();
    const out: PushRecipient[] = [];
    for (const row of rows?.results || []) {
      const endpointHash = typeof row.endpoint_hash === 'string' ? row.endpoint_hash : '';
      const userId = typeof row.user_id === 'string' ? row.user_id : '';
      const encrypted = typeof row.encrypted_subscription === 'string' ? row.encrypted_subscription : '';
      if (!endpointHash || !userId || !encrypted) continue;
      try {
        const userKey = await deriveUserEncryptionKey(userId, masterKey);
        const subscription = JSON.parse(await decryptFromStorage(encrypted, userKey));
        const endpoint = endpointOf(subscription);
        if (!endpoint) continue;
        out.push({ endpointHash, endpoint, subscription });
      } catch {
        /* 解不开的行跳过（不外抛，也不删——留人工排查） */
      }
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * 多设备广播 transport：包住原始 webpush，sendNotification 改为「先折叠、再逐端点发送」。
 * 单设备/无表时行为与原始 transport 一致；全部失败才抛错（库的失败判定不变）。
 */
export function withPushFanout(
  webpush: { sendNotification: (subscription: unknown, body: string) => Promise<unknown> } | null | undefined,
  deps: { db?: FanoutDb | null; masterKey?: string | null },
): { sendNotification: (subscription: unknown, body: string) => Promise<unknown> } {
  if (!webpush || typeof webpush.sendNotification !== 'function') return webpush as never;
  const db = deps?.db || null;
  const masterKey = String(deps?.masterKey || '');
  const fanout = Object.create(webpush);
  Object.defineProperty(fanout, 'sendNotification', {
    value: async (subscription: unknown, body: string) => {
      const collapsed = applyResultPushPolicy(String(body));
      if (!db || !masterKey) return webpush.sendNotification(subscription, collapsed);

      const passedEndpoint = endpointOf(subscription);
      let recipients: PushRecipient[] = [];
      try {
        await ensureMultiTable(db);
        recipients = await listRecipients(db, masterKey);
        if (recipients.length === 0) {
          await seedFromPrimary(db, masterKey);
          recipients = await listRecipients(db, masterKey);
        }
      } catch (error) {
        console.warn('[amsg:push-fanout] 读多设备表失败，退化为单发:', error instanceof Error ? error.message : error);
      }
      if (passedEndpoint && !recipients.some((r) => r.endpoint === passedEndpoint)) {
        recipients.push({
          endpointHash: await hashEndpoint(passedEndpoint),
          endpoint: passedEndpoint,
          subscription,
        });
      }
      if (recipients.length === 0) {
        return webpush.sendNotification(subscription, collapsed);
      }

      let success = 0;
      let lastResult: unknown = null;
      let lastError: unknown = null;
      for (const recipient of recipients) {
        try {
          lastResult = await webpush.sendNotification(recipient.subscription, collapsed);
          success += 1;
        } catch (error) {
          lastError = error;
          const status = Number(
            (error as { statusCode?: unknown; status?: unknown } | null)?.statusCode
            ?? (error as { status?: unknown } | null)?.status,
          );
          if (status === 404 || status === 410) {
            try {
              await removeByEndpointHash(db, recipient.endpointHash);
            } catch { /* 清理失败不影响其余设备投递 */ }
          }
        }
      }
      if (success > 0) return lastResult;
      throw lastError ?? new Error('push fan-out failed');
    },
  });
  return fanout;
}

/**
 * GET /push-subscription 的响应补一个 `data.endpoints`（已登记端点明文列表，只回给
 * 已鉴权的同一用户）：前端凭它判断「本机也在登记列表里」，不再把多设备误报成
 * 「登记的是别的设备」。任何失败原样返回上游响应。
 */
export async function enrichPushSubscriptionResponse(
  response: Response,
  deps: { db?: FanoutDb | null; masterKey?: string | null },
): Promise<Response> {
  const db = deps?.db || null;
  const masterKey = String(deps?.masterKey || '');
  if (!response.ok || !db || !masterKey) return response;
  try {
    const body = await response.clone().json() as { data?: Record<string, unknown> } | null;
    if (!body || typeof body !== 'object' || !body.data || typeof body.data !== 'object') return response;
    await ensureMultiTable(db);
    let recipients = await listRecipients(db, masterKey);
    if (recipients.length === 0) {
      await seedFromPrimary(db, masterKey);
      recipients = await listRecipients(db, masterKey);
    }
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.set('content-type', 'application/json; charset=utf-8');
    return new Response(JSON.stringify({
      ...body,
      data: { ...body.data, endpoints: recipients.map((r) => r.endpoint) },
    }), { status: response.status, headers });
  } catch {
    return response;
  }
}
