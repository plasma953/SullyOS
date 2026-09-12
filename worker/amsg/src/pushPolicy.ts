/**
 * 主动消息推送的折叠策略（见 docs/superpowers/specs/2026-09-12-amsg-push-collapse-multidevice-design.md）。
 *
 * 目标：一到点多条主动消息时，通知栏同一角色只留最新一条；同一批里只响第一声。
 * 与即时对话的差别只在应用位置——即时对话在 finalize 时按同样规则打 tag
 * （见 instantChat.ts 的 applyInstantNotificationPolicy），这里给非即时（定时任务）
 * 的推送补上同一套规则：
 *   - `tag`     复用即时对话的按角色 tag，通知栏同一个角色永远只留最新一条；
 *   - `renotify` 只给这一批的第一条。同 tag 的通知默认静默替换：上一批的横幅还躺在
 *                通知栏没点掉时，新一批的第一条不带 renotify 就会被当成替换而不出声
 *                ——那正是「有时候响有时候不响」的来源。一批响一声，后面几条安静
 *                把内容更新掉。
 */
import { instantNotificationTag } from './instantChat';

/** 结果类推送（messageKind === 'result'）的兜底 tag 前缀：拿不到角色时按结果类型折叠。 */
export const RESULT_PUSH_TAG_PREFIX = 'amsg-result-';

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const nonEmptyString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

/**
 * 找出这条推送该归到哪个角色下。
 * 优先显式 charId（fire 上下文）→ metadata.charId → contactName（带 `name:` 前缀，
 * 避免和 charId 撞名）。都取不到返回 null：宁可不折叠（多几条通知只是吵），
 * 也不能让两个角色共用一个 tag 互相顶掉——那是真丢消息。
 */
export function resolvePushNotificationTarget(
  payload: Record<string, unknown>,
  charId?: string | null,
): string | null {
  const explicit = nonEmptyString(charId);
  if (explicit) return explicit;
  const metadata = isPlainObject(payload.metadata) ? payload.metadata : null;
  const metaCharId = nonEmptyString(metadata?.charId);
  if (metaCharId) return metaCharId;
  const contact = nonEmptyString(payload.contactName) || nonEmptyString(metadata?.contactName);
  return contact ? `name:${contact}` : null;
}

const tagForTarget = (target: string): string =>
  target.startsWith('name:') ? `amsg-push-${target}` : instantNotificationTag(target);

/**
 * 定时任务（非即时对话）的正文推送：在 fire 的 onLLMOutput 出口应用。
 * 只做两件事：无 tag 时按角色补 tag；这一批第一条补 renotify。
 * 没有 notification（纯动作轮）或认不出角色时原样返回。
 */
export function applyScheduledNotificationPolicy(
  payload: Record<string, unknown>,
  charId?: string | null,
  isFirstSegment = false,
): Record<string, unknown> {
  const notification = payload.notification;
  if (!isPlainObject(notification)) return payload;
  if (nonEmptyString(notification.tag)) return payload;
  const target = resolvePushNotificationTarget(payload, charId);
  if (!target) return payload;
  return {
    ...payload,
    notification: {
      ...notification,
      tag: tagForTarget(target),
      ...(isFirstSegment ? { renotify: true } : {}),
    },
  };
}

/**
 * 结果类推送（messageKind === 'result'，如日程变更卡）的折叠：在发送出口
 * （pushFanout 的 sendNotification）应用。这类推送没有「第几段」的上下文，
 * 且本身较少、需要用户注意，统一带 renotify——同 tag 替换时也会重新提醒，
 * 不会出现「换了新内容却一声不响」。
 */
export function applyResultPushPolicy(bodyJson: string): string {
  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(bodyJson);
    if (!isPlainObject(parsed)) return bodyJson;
    payload = parsed;
  } catch {
    return bodyJson;
  }
  if (payload.messageKind !== 'result') return bodyJson;
  const notification = payload.notification;
  if (!isPlainObject(notification)) return bodyJson;
  if (nonEmptyString(notification.tag)) return bodyJson;
  const target = resolvePushNotificationTarget(payload);
  if (!target) return bodyJson;
  const tag = target.startsWith('name:')
    ? `${RESULT_PUSH_TAG_PREFIX}${target.slice('name:'.length)}`
    : instantNotificationTag(target);
  return JSON.stringify({
    ...payload,
    notification: { ...notification, tag, renotify: true },
  });
}
