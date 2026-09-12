import { describe, expect, it } from 'vitest';
import {
  deriveUserEncryptionKey,
  encryptForStorage,
} from '@rei-standard/amsg-server/cloudflare';
import {
  enrichPushSubscriptionResponse,
  hashEndpoint,
  listRecipients,
  MAX_FANOUT_DEVICES,
  mirrorPushSubscriptionRequest,
  removeAllForUser,
  removeByEndpointHash,
  withPushFanout,
  type FanoutDb,
} from './pushFanout';

const USER_ID = '00000000-0000-4000-8000-000000000001';
const MASTER = 'a'.repeat(64);

const subscriptionFor = (endpoint: string) => ({ endpoint, keys: { p256dh: 'p-key', auth: 'a-key' } });

const toBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const hexToBytes = (hex: string): Uint8Array<ArrayBuffer> => {
  const pairs = hex.match(/.{2}/g) || [];
  const out = new Uint8Array(new ArrayBuffer(pairs.length));
  for (let i = 0; i < pairs.length; i += 1) out[i] = parseInt(pairs[i], 16);
  return out;
};

/**
 * 与库内 encryptPayload 同格式的测试实现（AES-256-GCM、iv12 + tag16，base64 信封）：
 * 包没有导出 encryptPayload，客户端侧也走的是这一套。
 */
const encryptPayloadForTest = async (
  payload: unknown,
  hexKey: string,
): Promise<{ iv: string; authTag: string; encryptedData: string }> => {
  const key = await crypto.subtle.importKey('raw', hexToBytes(hexKey), { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    key,
    new TextEncoder().encode(JSON.stringify(payload)),
  ));
  return {
    iv: toBase64(iv),
    authTag: toBase64(sealed.slice(sealed.length - 16)),
    encryptedData: toBase64(sealed.slice(0, sealed.length - 16)),
  };
};

const envelopeFor = async (endpoint: string): Promise<string> => {
  const userKey = await deriveUserEncryptionKey(USER_ID, MASTER);
  const envelope = await encryptPayloadForTest(
    { subscription: subscriptionFor(endpoint), updatedAt: Date.now() },
    userKey,
  );
  return JSON.stringify(envelope);
};

interface FakeMultiRow {
  user_id: string;
  encrypted_subscription: string;
  updated_at: number;
}

const createFakeDb = () => {
  const multi = new Map<string, FakeMultiRow>();
  let primary: Record<string, unknown> | null = null;
  const db = {
    _multi: multi,
    _setPrimary(row: Record<string, unknown> | null) { primary = row; },
    prepare(sql: string) {
      const statement = {
        _args: [] as unknown[],
        bind(...args: unknown[]) { statement._args = args; return statement; },
        async run() {
          if (sql.startsWith('CREATE TABLE')) return { success: true };
          if (sql.includes('INSERT INTO push_subscriptions_multi')) {
            const [hash, userId, encrypted, updatedAt] = statement._args as [string, string, string, number];
            multi.set(hash, { user_id: userId, encrypted_subscription: encrypted, updated_at: updatedAt });
            return { success: true };
          }
          if (sql.includes('DELETE FROM push_subscriptions_multi WHERE endpoint_hash = ?')) {
            multi.delete(String(statement._args[0]));
            return { success: true };
          }
          if (sql.includes('DELETE FROM push_subscriptions_multi WHERE user_id = ?')) {
            for (const [key, value] of [...multi]) {
              if (value.user_id === String(statement._args[0])) multi.delete(key);
            }
            return { success: true };
          }
          if (sql.trim() === 'DELETE FROM push_subscriptions_multi') {
            multi.clear();
            return { success: true };
          }
          return { success: true };
        },
        async first() {
          if (sql.includes('FROM push_subscriptions_multi')) return null;
          if (sql.includes('FROM push_subscriptions')) return primary;
          return null;
        },
        async all() {
          const ordered = [...multi.entries()].sort((a, b) => b[1].updated_at - a[1].updated_at);
          if (sql.includes('SELECT endpoint_hash FROM push_subscriptions_multi')) {
            return { results: ordered.map(([endpoint_hash]) => ({ endpoint_hash })) };
          }
          if (sql.includes('SELECT endpoint_hash, user_id, encrypted_subscription FROM push_subscriptions_multi')) {
            return { results: ordered.map(([endpoint_hash, value]) => ({ endpoint_hash, ...value })) };
          }
          return { results: [] };
        },
      };
      return statement;
    },
  };
  return db;
};

type FakeDb = ReturnType<typeof createFakeDb>;

const createFakeWebpush = (onSend?: (endpoint: string) => void) => {
  const calls: Array<{ subscription: { endpoint?: string }; body: string }> = [];
  const webpush = {
    sendNotification: async (subscription: unknown, body: string) => {
      const endpoint = (subscription as { endpoint?: string })?.endpoint || '';
      if (onSend) onSend(endpoint);
      calls.push({ subscription: subscription as { endpoint?: string }, body });
      return { ok: true, endpoint };
    },
  };
  return { calls, webpush };
};

describe('pushFanout 多设备表', () => {
  it('镜像注册：解密信封后按 endpoint 哈希落库，密文可被 listRecipients 解回', async () => {
    const db = createFakeDb();
    const ok = await mirrorPushSubscriptionRequest({
      db: db as unknown as FanoutDb,
      masterKey: MASTER,
      userId: USER_ID,
      rawBody: await envelopeFor('https://push.example.com/a'),
    });
    expect(ok).toBe(true);
    expect(db._multi.size).toBe(1);
    const recipients = await listRecipients(db as unknown as FanoutDb, MASTER);
    expect(recipients).toHaveLength(1);
    expect(recipients[0].endpoint).toBe('https://push.example.com/a');
    expect(recipients[0].endpointHash).toBe(await hashEndpoint('https://push.example.com/a'));
  });

  it('同一 endpoint 重复注册：更新而不是新增', async () => {
    const db = createFakeDb();
    const rawBody = await envelopeFor('https://push.example.com/a');
    await mirrorPushSubscriptionRequest({ db: db as unknown as FanoutDb, masterKey: MASTER, userId: USER_ID, rawBody });
    await mirrorPushSubscriptionRequest({ db: db as unknown as FanoutDb, masterKey: MASTER, userId: USER_ID, rawBody });
    expect(db._multi.size).toBe(1);
  });

  it('上限：第 11 个端点会淘汰最旧的', async () => {
    const db = createFakeDb();
    for (let i = 1; i <= MAX_FANOUT_DEVICES + 1; i++) {
      await mirrorPushSubscriptionRequest({
        db: db as unknown as FanoutDb,
        masterKey: MASTER,
        userId: USER_ID,
        rawBody: await envelopeFor(`https://push.example.com/${i}`),
      });
    }
    expect(db._multi.size).toBe(MAX_FANOUT_DEVICES);
  });

  it('删端点 / 清空', async () => {
    const db = createFakeDb();
    const hash = await hashEndpoint('https://push.example.com/a');
    await mirrorPushSubscriptionRequest({
      db: db as unknown as FanoutDb, masterKey: MASTER, userId: USER_ID,
      rawBody: await envelopeFor('https://push.example.com/a'),
    });
    await removeByEndpointHash(db as unknown as FanoutDb, hash);
    expect(db._multi.size).toBe(0);
    await mirrorPushSubscriptionRequest({
      db: db as unknown as FanoutDb, masterKey: MASTER, userId: USER_ID,
      rawBody: await envelopeFor('https://push.example.com/b'),
    });
    await removeAllForUser(db as unknown as FanoutDb);
    expect(db._multi.size).toBe(0);
  });
});

describe('withPushFanout 广播', () => {
  it('两个端点：同一条折叠后的 payload 各发一次', async () => {
    const db = createFakeDb();
    for (const endpoint of ['https://push.example.com/a', 'https://push.example.com/b']) {
      await mirrorPushSubscriptionRequest({
        db: db as unknown as FanoutDb, masterKey: MASTER, userId: USER_ID,
        rawBody: await envelopeFor(endpoint),
      });
    }
    const { calls, webpush } = createFakeWebpush();
    const transport = withPushFanout(webpush, { db: db as unknown as FanoutDb, masterKey: MASTER });
    const body = JSON.stringify({
      messageKind: 'result',
      metadata: { charId: 'char-1' },
      notification: { title: 't', body: 'b' },
    });
    await transport.sendNotification(subscriptionFor('https://push.example.com/a'), body);
    expect(calls).toHaveLength(2);
    const sent = JSON.parse(calls[0].body);
    expect(sent.notification.tag).toBe('amsg-instant-char-1');
    expect(sent.notification.renotify).toBe(true);
  });

  it('多设备表为空：先用库主订阅播种，再广播', async () => {
    const db = createFakeDb();
    const userKey = await deriveUserEncryptionKey(USER_ID, MASTER);
    db._setPrimary({
      user_id: USER_ID,
      subscription: await encryptForStorage(JSON.stringify(subscriptionFor('https://push.example.com/primary')), userKey),
    });
    const { calls, webpush } = createFakeWebpush();
    const transport = withPushFanout(webpush, { db: db as unknown as FanoutDb, masterKey: MASTER });
    await transport.sendNotification(subscriptionFor('https://push.example.com/primary'), JSON.stringify({ messageKind: 'content' }));
    expect(calls).toHaveLength(1);
    expect(calls[0].subscription.endpoint).toBe('https://push.example.com/primary');
    expect(db._multi.size).toBe(1);
  });

  it('410 只清对应端点，其余设备照常收到', async () => {
    const db = createFakeDb();
    for (const endpoint of ['https://push.example.com/dead', 'https://push.example.com/alive']) {
      await mirrorPushSubscriptionRequest({
        db: db as unknown as FanoutDb, masterKey: MASTER, userId: USER_ID,
        rawBody: await envelopeFor(endpoint),
      });
    }
    const { calls, webpush } = createFakeWebpush((endpoint) => {
      if (endpoint.endsWith('/dead')) throw Object.assign(new Error('gone'), { statusCode: 410 });
    });
    const transport = withPushFanout(webpush, { db: db as unknown as FanoutDb, masterKey: MASTER });
    await transport.sendNotification(subscriptionFor('https://push.example.com/alive'), JSON.stringify({ messageKind: 'content' }));
    expect(calls.map((c) => c.subscription.endpoint).sort()).toEqual(['https://push.example.com/alive']);
    const recipients = await listRecipients(db as unknown as FanoutDb, MASTER);
    expect(recipients.map((r) => r.endpoint)).toEqual(['https://push.example.com/alive']);
  });

  it('全部失败：抛出最后一个错误（库据此记投递失败）', async () => {
    const db = createFakeDb();
    await mirrorPushSubscriptionRequest({
      db: db as unknown as FanoutDb, masterKey: MASTER, userId: USER_ID,
      rawBody: await envelopeFor('https://push.example.com/a'),
    });
    const { webpush } = createFakeWebpush(() => {
      throw Object.assign(new Error('boom'), { statusCode: 500 });
    });
    const transport = withPushFanout(webpush, { db: db as unknown as FanoutDb, masterKey: MASTER });
    await expect(
      transport.sendNotification(subscriptionFor('https://push.example.com/a'), JSON.stringify({ messageKind: 'content' })),
    ).rejects.toThrow('boom');
  });

  it('单设备且已在表中：只发一次（传入订阅不重复）', async () => {
    const db = createFakeDb();
    await mirrorPushSubscriptionRequest({
      db: db as unknown as FanoutDb, masterKey: MASTER, userId: USER_ID,
      rawBody: await envelopeFor('https://push.example.com/a'),
    });
    const { calls, webpush } = createFakeWebpush();
    const transport = withPushFanout(webpush, { db: db as unknown as FanoutDb, masterKey: MASTER });
    await transport.sendNotification(subscriptionFor('https://push.example.com/a'), JSON.stringify({ messageKind: 'content' }));
    expect(calls).toHaveLength(1);
  });
});

describe('enrichPushSubscriptionResponse', () => {
  it('补 data.endpoints（多设备表有行时）', async () => {
    const db = createFakeDb();
    await mirrorPushSubscriptionRequest({
      db: db as unknown as FanoutDb, masterKey: MASTER, userId: USER_ID,
      rawBody: await envelopeFor('https://push.example.com/a'),
    });
    const upstream = new Response(JSON.stringify({ success: true, data: { exists: true, endpoint: 'https://push.example.com/a' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    const enriched = await enrichPushSubscriptionResponse(upstream, { db: db as unknown as FanoutDb, masterKey: MASTER });
    const body = await enriched.json() as { data: { endpoints: string[] } };
    expect(body.data.endpoints).toEqual(['https://push.example.com/a']);
  });

  it('非 2xx 原样返回', async () => {
    const db = createFakeDb();
    const upstream = new Response('nope', { status: 500 });
    const enriched = await enrichPushSubscriptionResponse(upstream, { db: db as unknown as FanoutDb, masterKey: MASTER });
    expect(enriched.status).toBe(500);
  });
});
