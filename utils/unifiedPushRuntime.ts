import { ingestNativeAmsgPayload, parseNativeAmsgPayload } from './nativeAmsgInbox';
import { addUnifiedPushListener, drainUnifiedPushMessages, isUnifiedPushPlatform } from './unifiedPushPlugin';

let initialized = false;

const ingest = async (payload: unknown, openAfter = false): Promise<void> => {
  const result = await ingestNativeAmsgPayload(payload);
  if (openAfter && result?.charId) {
    window.dispatchEvent(new CustomEvent('active-msg-open', { detail: { charId: result.charId } }));
  }
};

export const initUnifiedPushRuntime = async (): Promise<void> => {
  if (initialized || !isUnifiedPushPlatform()) return;
  initialized = true;

  try {
    await addUnifiedPushListener('pushReceived', (event) => {
      void ingest(event?.payload);
    });
    await addUnifiedPushListener('notificationTapped', (event) => {
      void ingest(event?.payload, true);
    });

    const pending = await drainUnifiedPushMessages();
    for (const message of pending.messages || []) {
      await ingest(message.payload);
    }

    if (pending.launchPayload) {
      const payload = parseNativeAmsgPayload(pending.launchPayload);
      const charId = payload?.metadata?.charId;
      if (typeof charId === 'string' && charId) {
        window.dispatchEvent(new CustomEvent('active-msg-open', { detail: { charId } }));
      }
    }
  } catch (err) {
    // 预期路径：android/ 壳里没有 AmsgUnifiedPush 的 Java 实现（registerPlugin 调用抛
    // "not implemented"）。推送退回「打开 App 补收」（outbox），不该变成启动期 unhandled
    // rejection。等壳里补上原生实现（unifiedpush connector 依赖）后这里自然不再进 catch。
    console.warn('[UnifiedPush] runtime init failed, push falls back to outbox:', err);
  }
};
