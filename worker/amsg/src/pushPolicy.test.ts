import { describe, expect, it } from 'vitest';
import {
  applyResultPushPolicy,
  applyScheduledNotificationPolicy,
  resolvePushNotificationTarget,
} from './pushPolicy';
import { instantNotificationTag } from './instantChat';

const CHAR_ID = 'char-1';

const scheduledPayload = (overrides: Record<string, unknown> = {}) => ({
  messageKind: 'content',
  source: 'scheduled',
  contactName: '小明',
  metadata: { charId: CHAR_ID },
  notification: { title: '来自 小明', body: '第一段' },
  ...overrides,
});

describe('resolvePushNotificationTarget', () => {
  it('charId 参数优先于 metadata / contactName', () => {
    expect(resolvePushNotificationTarget(scheduledPayload(), CHAR_ID)).toBe(CHAR_ID);
  });

  it('没有 charId 时依次退到 metadata.charId、contactName', () => {
    expect(resolvePushNotificationTarget({ metadata: { charId: CHAR_ID } })).toBe(CHAR_ID);
    expect(resolvePushNotificationTarget({ contactName: '小红' })).toBe('name:小红');
    expect(resolvePushNotificationTarget({ metadata: { contactName: '小刚' } })).toBe('name:小刚');
  });

  it('都取不到返回 null（不折叠）', () => {
    expect(resolvePushNotificationTarget({})).toBeNull();
    expect(resolvePushNotificationTarget({ contactName: '   ' })).toBeNull();
  });
});

describe('applyScheduledNotificationPolicy（定时任务正文推送）', () => {
  it('这一批第一条：补按角色 tag + renotify', () => {
    const next = applyScheduledNotificationPolicy(scheduledPayload(), CHAR_ID, true);
    const notification = next.notification as Record<string, unknown>;
    expect(notification.tag).toBe(instantNotificationTag(CHAR_ID));
    expect(notification.renotify).toBe(true);
  });

  it('同一批后续段：只补 tag，不 renotify（静默替换）', () => {
    const next = applyScheduledNotificationPolicy(scheduledPayload(), CHAR_ID, false);
    const notification = next.notification as Record<string, unknown>;
    expect(notification.tag).toBe(instantNotificationTag(CHAR_ID));
    expect(notification).not.toHaveProperty('renotify');
  });

  it('已有 tag 的推送原样返回（即时对话的折叠优先）', () => {
    const payload = scheduledPayload({
      notification: { title: 't', body: 'b', tag: 'already-tagged', renotify: true },
    });
    expect(applyScheduledNotificationPolicy(payload, CHAR_ID, true)).toBe(payload);
  });

  it('没有 notification（纯动作轮）原样返回', () => {
    const payload = { messageKind: 'content', source: 'scheduled', metadata: { charId: CHAR_ID } };
    expect(applyScheduledNotificationPolicy(payload, CHAR_ID, true)).toBe(payload);
  });

  it('认不出角色时不折叠（防两个角色共 tag 互相顶掉）', () => {
    const payload = { messageKind: 'content', source: 'scheduled', notification: { title: 't', body: 'b' } };
    expect(applyScheduledNotificationPolicy(payload, null, true)).toBe(payload);
  });

  it('有 contactName 无 charId：用 name 前缀 tag', () => {
    const payload = {
      messageKind: 'content',
      source: 'scheduled',
      contactName: '小红',
      notification: { title: 't', body: 'b' },
    };
    const next = applyScheduledNotificationPolicy(payload, null, false);
    expect((next.notification as Record<string, unknown>).tag).toBe('amsg-push-name:小红');
  });
});

describe('applyResultPushPolicy（结果类推送）', () => {
  const resultBody = (overrides: Record<string, unknown> = {}) => JSON.stringify({
    messageKind: 'result',
    resultKind: 'schedule-change',
    metadata: { charId: CHAR_ID },
    notification: { title: '日程有变', body: '角色改了安排' },
    ...overrides,
  });

  it('补按角色 tag + renotify（替换时也会重新提醒）', () => {
    const parsed = JSON.parse(applyResultPushPolicy(resultBody()));
    expect(parsed.notification.tag).toBe(instantNotificationTag(CHAR_ID));
    expect(parsed.notification.renotify).toBe(true);
  });

  it('没有角色线索时原样返回', () => {
    const raw = resultBody({ metadata: {} });
    expect(applyResultPushPolicy(raw)).toBe(raw);
  });

  it('非 result、已有 tag、无 notification、非法 JSON 都原样返回', () => {
    const content = JSON.stringify({ messageKind: 'content', metadata: { charId: CHAR_ID }, notification: { title: 't' } });
    expect(applyResultPushPolicy(content)).toBe(content);
    const tagged = resultBody({ notification: { title: 't', tag: 'x' } });
    expect(applyResultPushPolicy(tagged)).toBe(tagged);
    const noNotification = JSON.stringify({ messageKind: 'result', metadata: { charId: CHAR_ID } });
    expect(applyResultPushPolicy(noNotification)).toBe(noNotification);
    expect(applyResultPushPolicy('not-json')).toBe('not-json');
  });
});
