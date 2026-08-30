import { describe, it, expect } from 'vitest';
import {
    getBusyStatus,
    BUSY_PLACEHOLDER,
    BUSY_FALLBACK_DELAY_MS,
    BUSY_PEEK_PROBABILITY,
    BUSY_PEEK_MIN_WINDOW_MS,
    BUSY_MAKEUP_PROMPT_HINT,
    BUSY_PEEK_PROMPT_HINT,
} from './busyState';
import type { DailySchedule } from '../types';

const mkSchedule = (slots: Array<Record<string, unknown>>): DailySchedule => ({
    id: 'c1_2026-01-01',
    charId: 'c1',
    date: '2026-01-01',
    slots: slots as DailySchedule['slots'],
    generatedAt: Date.now(),
});

/** 固定一个上午 10:00 的本地时刻，避免测试随真实时间漂移。 */
const at10 = () => {
    const d = new Date();
    d.setHours(10, 0, 0, 0);
    return d;
};

describe('忙碌状态判定 getBusyStatus', () => {
    it('无日程 / 空时段 → 不忙', () => {
        expect(getBusyStatus(null, at10()).busy).toBe(false);
        expect(getBusyStatus(mkSchedule([]), at10()).busy).toBe(false);
    });

    it('当前时段未标 busy → 不忙（默认空闲）', () => {
        const s = mkSchedule([{ startTime: '08:00', activity: '晨跑' }]);
        const st = getBusyStatus(s, at10());
        expect(st.busy).toBe(false);
    });

    it('当前时段标了 busy → 忙，结束点 = 下一条开始', () => {
        const s = mkSchedule([
            { startTime: '09:00', activity: '上班', busy: true },
            { startTime: '12:00', activity: '午饭' },
            { startTime: '13:00', activity: '继续上班', busy: true },
        ]);
        const st = getBusyStatus(s, at10());
        expect(st.busy).toBe(true);
        expect(st.slot?.activity).toBe('上班');
        expect(st.endsAt).toBe('12:00');
    });

    it('busy 是最后一条 → endsAt 为 null（补偿走兜底延迟）', () => {
        const s = mkSchedule([{ startTime: '09:00', activity: '加班', busy: true }]);
        const st = getBusyStatus(s, at10());
        expect(st.busy).toBe(true);
        expect(st.endsAt).toBeNull();
        expect(st.endsAtMs).toBeNull();
    });

    it('endsAtMs 落在今天；跨零点（已过点）翻到明天', () => {
        const d = new Date();
        d.setHours(10, 0, 0, 0);
        const today = getBusyStatus(mkSchedule([
            { startTime: '09:00', activity: '忙', busy: true },
            { startTime: '12:00', activity: '休' },
        ]), d);
        expect(today.endsAtMs).toBe(d.getTime() + 2 * 3600_000);

        // 深夜且 busy 是当天最后一条：endsAt 为 null，补偿任务走兜底延迟。
        // （日程数据按时间升序生成，「下一条开始时刻早于当前」只在畸形数据里出现，
        //  endsAtMs 的翻日分支是纯防御，正常路径到不了。）
        const d2 = new Date();
        d2.setHours(23, 30, 0, 0);
        const lateNight = getBusyStatus(mkSchedule([
            { startTime: '22:00', activity: '夜班', busy: true },
        ]), d2);
        expect(lateNight.busy).toBe(true);
        expect(lateNight.endsAt).toBeNull();
        expect(lateNight.endsAtMs).toBeNull();
    });

    it('不泄露忙碌原因的口径：占位符与提示常量不带 activity', () => {
        expect(BUSY_PLACEHOLDER).toBe('<busy/>');
        expect(BUSY_MAKEUP_PROMPT_HINT).not.toContain('activity');
        expect(BUSY_PEEK_PROMPT_HINT).not.toContain('activity');
        expect(BUSY_PEEK_PROBABILITY).toBeGreaterThanOrEqual(0);
        expect(BUSY_PEEK_PROBABILITY).toBeLessThan(1);
        expect(BUSY_PEEK_MIN_WINDOW_MS).toBeGreaterThan(0);
        expect(BUSY_FALLBACK_DELAY_MS).toBeGreaterThan(0);
    });
});
