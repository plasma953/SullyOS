/**
 * 忙碌期（busy）判定与配套的静默处理。
 *
 * 设计口径（与用户确认过的）：
 * - 判定只依赖日程时段上的 `busy: true` 标记 —— 角色当天干了什么它自己最清楚，
 *   用户不需要为「忙碌」再配一套东西；没标就是闲。
 * - 忙碌期间用户发消息**不调 API**（短路基座），角色先回一张轻量「在忙」卡。
 *   卡片是纯前端渲染的：归档里只存 4 字节占位符 `<busy/>`，上下文不膨胀。
 * - 忙碌原因（activity 名）只进发给模型的上下文（如果之后走云端生成），
 *   **不**写进用户能看到的文案 —— 用户要的就是「不知道在忙什么」的神秘感。
 * - 忙完的补偿回复走主动消息 2.0：到点时由 worker / 客户端正常生成，
 *   语气是「刚忙完看到你的消息」，不报流水账。
 */

import type { CharacterProfile, DailySchedule, ScheduleSlot } from '../types';
import { getDailyScheduleForChar } from './dailySchedule';
import { resolveCharTimeZone } from './timezone';

/** busy_card 消息正文里存的那 4 个字节。 */
export const BUSY_PLACEHOLDER = '<busy/>';

/** 忙卡去重窗口：这段时间内用户再发消息不再补第二张卡，避免连发刷屏。 */
export const BUSY_CARD_DEDUPE_MS = 3 * 60 * 1000;

export interface BusyStatus {
    /** 当前是否处于标记了 busy 的时段。 */
    busy: boolean;
    /** 命中的时段（可能为 null：今天日程还没开始，或根本没日程）。 */
    slot: ScheduleSlot | null;
    /** 忙碌结束点（下一条日程的开始墙钟，如 "12:00"）。 */
    endsAt: string | null;
    /** 生成补偿任务用的：结束点换成的 ISO 时刻；解析不出为 null。 */
    endsAtMs: number | null;
}

/**
 * 读角色此刻的忙碌状态。
 *
 * 时区口径与日程注入完全一致（getDailyScheduleForChar 内部已按角色时区选 key、
 * resolveScheduleSlots 按传入 Date 判时段），传入的 now 必须是**角色当地的时刻**，
 * 否则时段会错位。调用方一般直接 new Date()（浏览器本地钟）——
 * 与日程注入的调用点同口径，漂移面一致。
 */
export const getBusyStatus = (
    schedule: DailySchedule | null,
    now: Date = new Date(),
): BusyStatus => {
    const empty: BusyStatus = { busy: false, slot: null, endsAt: null, endsAtMs: null };
    if (!schedule?.slots?.length) return empty;
    const minutes = now.getHours() * 60 + now.getMinutes();
    let hit: ScheduleSlot | null = null;
    let next: ScheduleSlot | null = null;
    for (let i = schedule.slots.length - 1; i >= 0; i--) {
        const [h, m] = schedule.slots[i].startTime.split(':').map(Number);
        if (!Number.isFinite(h) || !Number.isFinite(m)) continue;
        if (minutes >= h * 60 + m) {
            hit = schedule.slots[i];
            next = i < schedule.slots.length - 1 ? schedule.slots[i + 1] : null;
            break;
        }
    }
    if (!hit?.busy) return empty;
    const endsAt = next?.startTime ?? null;
    let endsAtMs: number | null = null;
    if (endsAt) {
        const [eh, em] = endsAt.split(':').map(Number);
        if (Number.isFinite(eh) && Number.isFinite(em)) {
            const t = new Date(now);
            t.setHours(eh, em, 0, 0);
            if (t.getTime() <= now.getTime()) t.setDate(t.getDate() + 1);
            endsAtMs = t.getTime();
        }
    }
    return { busy: true, slot: hit, endsAt, endsAtMs };
};

/** 便捷封装：按角色自己的时区日程查忙碌状态。 */
export const getBusyStatusForChar = async (
    char: Pick<CharacterProfile, 'id' | 'customTimezoneEnabled' | 'customTimezone'>,
    now: Date = new Date(),
): Promise<BusyStatus> => getBusyStatus(await getDailyScheduleForChar(char, now), now);

/**
 * 忙完补偿回复的默认延迟：没解析出结束点时兜底 45 分钟。
 * 时间拿得准的话 delay = endsAtMs - now，误差就是「日程表上的下一个时段」。
 */
export const BUSY_FALLBACK_DELAY_MS = 45 * 60 * 1000;

/**
 * 「插空看手机」触发概率：忙碌期间角色在小空隙掏出一眼手机的概率。
 * 0 = 关闭。低频是刻意的——每次都插空回复，「在忙」就形同虚设了。
 */
export const BUSY_PEEK_PROBABILITY = 0.25;

/** 忙碌窗口短于这个时长就不排插空（马上就忙完了，补偿回复很快到，插空没有意义）。 */
export const BUSY_PEEK_MIN_WINDOW_MS = 10 * 60 * 1000;

/**
 * 插空回复的提示方向。到点由 worker 按那时上下文生成；这里只给姿态：
 * 小空隙看到了消息、快速回一两句、回完继续忙。不透露具体在忙什么（模型自己知道）。
 */
export const BUSY_PEEK_PROMPT_HINT =
    '你正忙着的那件事刚好到了一个小空隙（等人、等物料、歇几分钟），掏出手机瞄了一眼，看到对方在你忙时发来的消息。快速回一两句就好——别长篇大论，回完你还得继续回去忙。';

/**
 * 「插空看手机」任务：忙碌窗口内随机一个时刻的主动消息。
 *
 * 和忙完补偿（scheduleBusyMakeupTask，force）配对使用：插空这条用 expire ——
 * 到点时用户早就在聊天/有新进展的话，「插空」这个前提已经不成立，自动作废让路。
 * 窗口太短或没解析出结束点时不排。
 */
export const maybeScheduleBusyPeekTask = async (
    char: CharacterProfile,
    status: BusyStatus,
    deps: {
        userProfile: any;
        groups: any[];
        realtimeConfig: any;
        apiConfig: any;
        updateCharacter: (charId: string, updates: Partial<CharacterProfile>) => void;
    },
): Promise<void> => {
    try {
        if (char.activeMsg2Config?.enabled !== true) return;
        if (Math.random() >= BUSY_PEEK_PROBABILITY) return;
        if (!status.endsAtMs) return;
        const windowMs = status.endsAtMs - Date.now();
        if (windowMs < BUSY_PEEK_MIN_WINDOW_MS) return;
        const fireAtMs = Date.now() + Math.floor(Math.random() * windowMs * 0.7) + 3 * 60_000;
        if (fireAtMs >= status.endsAtMs) return;
        const config = char.activeMsg2Config;
        const tz = resolveCharTimeZone(char) ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
        const sendAt = new Date(fireAtMs)
            .toLocaleString('sv', { timeZone: tz })
            .replace(' ', 'T');
        const { default: ActiveMsgClient } = await import('./activeMsgClient');
        const result = await ActiveMsgClient.scheduleCharacterTask({
            char, config,
            task: {
                mode: 'auto',
                firstSendTime: sendAt,
                recurrenceType: 'none',
                promptHint: BUSY_PEEK_PROMPT_HINT,
                expirePolicy: 'expire',
                selfScheduled: true,
            },
            userProfile: deps.userProfile,
            groups: deps.groups,
            realtimeConfig: deps.realtimeConfig,
            apiConfig: deps.apiConfig,
        });
        const record = {
            taskUuid: result.uuid,
            clientTaskId: result.clientTaskId,
            mode: 'auto' as const,
            firstSendTime: result.firstSendAt,
            recurrenceType: 'none' as const,
            promptHint: BUSY_PEEK_PROMPT_HINT,
            expirePolicy: 'expire' as const,
            source: 'character' as const,
            status: 'scheduled' as const,
            createdAt: Date.now(),
        };
        const { applyScheduledTask, pruneStaleTasks } = await import('./amsg2Tasks');
        deps.updateCharacter(char.id, {
            activeMsg2Config: {
                ...config,
                tasks: pruneStaleTasks(applyScheduledTask(config.tasks ?? [], record, {}, Date.now()), Date.now()),
                lastSyncedAt: Date.now(),
            },
        });
        console.info('[BusyState] 插空看手机任务已排:', { charId: char.id, fireAtMs, taskUuid: result.uuid });
    } catch (e) {
        console.warn('[BusyState] 插空任务排程失败（不影响忙卡）:', e);
    }
};

/**
 * 补偿任务的 promptHint。到点时 worker 按「那时的上下文」生成，角色自己能从
 * 历史里看到那张忙卡和用户落空的消息，所以提示只给姿态不给剧本。
 */
export const BUSY_MAKEUP_PROMPT_HINT =
    '你之前在忙手上陷进去的事，暂时没回消息；现在刚忙完。刚看到对方在你忙时发来的消息，自然地接上话头——像刚闲下来掏出手机那种口吻，不用道歉报流水账。';

/**
 * 排「忙完补偿」主动消息任务（amsg2）。
 *
 * 只在角色开了主动消息 2.0 时才会真的排；任何一步失败都静默（console 留痕），
 * 忙卡照常发——补偿是锦上添花，不能因为它把短路的收尾搞砸。
 */
export const scheduleBusyMakeupTask = async (
    char: CharacterProfile,
    status: BusyStatus,
    deps: {
        userProfile: any;
        groups: any[];
        realtimeConfig: any;
        apiConfig: any;
        updateCharacter: (charId: string, updates: Partial<CharacterProfile>) => void;
    },
): Promise<void> => {
    try {
        if (char.activeMsg2Config?.enabled !== true) return;
        const config = char.activeMsg2Config;
        const tz = resolveCharTimeZone(char) ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
        const fireAtMs = status.endsAtMs ?? (Date.now() + BUSY_FALLBACK_DELAY_MS);
        const sendAt = new Date(fireAtMs + 60_000) // +1 分钟：与工具侧「至少晚 1 分钟」同一道闸
            .toLocaleString('sv', { timeZone: tz })
            .replace(' ', 'T');
        const { default: ActiveMsgClient } = await import('./activeMsgClient');
        const result = await ActiveMsgClient.scheduleCharacterTask({
            char, config,
            task: {
                mode: 'auto',
                firstSendTime: sendAt,
                recurrenceType: 'none',
                promptHint: BUSY_MAKEUP_PROMPT_HINT,
                expirePolicy: 'force', // 具体承诺：忙完那条必须响，用户中途回来说过话也不作废
                selfScheduled: true,
            },
            userProfile: deps.userProfile,
            groups: deps.groups,
            realtimeConfig: deps.realtimeConfig,
            apiConfig: deps.apiConfig,
        });
        const record = {
            taskUuid: result.uuid,
            clientTaskId: result.clientTaskId,
            mode: 'auto' as const,
            firstSendTime: result.firstSendAt,
            recurrenceType: 'none' as const,
            promptHint: BUSY_MAKEUP_PROMPT_HINT,
            expirePolicy: 'force' as const,
            source: 'character' as const,
            status: 'scheduled' as const,
            createdAt: Date.now(),
        };
        const { applyScheduledTask, pruneStaleTasks } = await import('./amsg2Tasks');
        deps.updateCharacter(char.id, {
            activeMsg2Config: {
                ...config,
                tasks: pruneStaleTasks(applyScheduledTask(config.tasks ?? [], record, {}, Date.now()), Date.now()),
                lastSyncedAt: Date.now(),
            },
        });
        console.info('[BusyState] 忙完补偿任务已排:', { charId: char.id, fireAtMs, taskUuid: result.uuid });
    } catch (e) {
        console.warn('[BusyState] 补偿任务排程失败（不影响忙卡）:', e);
    }
};
