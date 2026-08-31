/**
 * scheduleHolidaySync — 节假日/调休 → 当天生效日程的内存态改写（状态机联动）。
 *
 * 口径（与用户确认的）：
 * · 法定休息日：全部 busy 槽强制置闲（放假了），并追加「（法定假日，在家）」注记；
 *   日程为空/全闲时不动（不用硬造「今天什么都没干」）。
 * · 调休补班日：日程为空或全闲时注入一个虚拟槽「09:00 调休上班 busy=true」；
 *   已有 busy 槽的日程视为「本就在忙别的」，不叠加。
 * · 严格降级：节假日数据缺失时返回原日程引用，行为与现状完全一致。
 * · 纯内存态，不写库 —— 用户的原始日程编辑权完整保留，次日恢复常态。
 */
import type { DailySchedule, ScheduleSlot } from '../types';
import { getHolidayInfo, type CnHolidayYearData, type HolidayInfo } from './cnHoliday';

export interface HolidayOverlayResult {
    /** 改写后的生效日程（数据缺失时与入参同引用） */
    schedule: DailySchedule | null;
    /** 本次改写依据的节假日信息（null = 无数据或当天无安排） */
    holidayInfo: HolidayInfo | null;
    /** 是否发生了改写 */
    modified: boolean;
}

/**
 * 计算某天的节假日生效日程（纯函数，不取数、不写库）。
 * @param schedule    角色原始日程（可为 null）
 * @param dateKey     'YYYY-MM-DD'（角色本地日历日）
 * @param holidayData 该年的节假日数据（null = 严格降级为原日程）
 */
export const applyHolidayOverlay = (
    schedule: DailySchedule | null,
    dateKey: string,
    holidayData: CnHolidayYearData | null,
): HolidayOverlayResult => {
    const info = getHolidayInfo(holidayData, dateKey);
    if (!info) return { schedule, holidayInfo: null, modified: false };

    const HOLIDAY_NOTE = '（法定假日，在家）';

    // 放假：busy 槽全部置闲 + 注记
    if (info.isOffDay) {
        const slots = schedule?.slots || [];
        if (slots.length === 0) {
            return { schedule, holidayInfo: info, modified: false };
        }
        const hasBusy = slots.some(s => s.busy);
        if (!hasBusy) {
            // 本来就全闲：补一条注记让角色知道「今天放假」，不改 busy
            const noted: ScheduleSlot[] = slots.map(s =>
                s.activity.includes(HOLIDAY_NOTE) ? s : { ...s, activity: `${s.activity}${HOLIDAY_NOTE}` });
            return { schedule: { ...(schedule as DailySchedule), slots: noted }, holidayInfo: info, modified: true };
        }
        const rewritten: ScheduleSlot[] = slots.map(s => {
            const base = s.busy ? { ...s, busy: false } : s;
            return base.activity.includes(HOLIDAY_NOTE) ? base : { ...base, activity: `${base.activity}${HOLIDAY_NOTE}` };
        });
        return { schedule: { ...(schedule as DailySchedule), slots: rewritten }, holidayInfo: info, modified: true };
    }

    // 补班：空/全闲日程注入虚拟上班槽（已排忙的日程不叠加）
    if (info.isMakeupWorkday) {
        const slots = schedule?.slots || [];
        if (slots.some(s => s.busy)) {
            return { schedule, holidayInfo: info, modified: false };
        }
        const makeupSlot: ScheduleSlot = {
            startTime: '09:00',
            activity: '调休上班',
            busy: true,
            description: `${info.name || '调休'}补班日：虽然是周末，但按工作日安排`,
        };
        const baseSchedule: DailySchedule = schedule || {
            id: `holiday_makeup_${dateKey}`,
            charId: 'makeup',
            date: dateKey,
            slots: [],
            generatedAt: 0,
        };
        return {
            schedule: { ...baseSchedule, slots: [...slots, makeupSlot].sort((a, b) => a.startTime.localeCompare(b.startTime)) },
            holidayInfo: info,
            modified: true,
        };
    }

    return { schedule, holidayInfo: info, modified: false };
};

/**
 * 便捷封装：自动取数（当年 + 处理跨年 12/31→1/1 边界由调用方保证 data 对应 dateKey 的年份）。
 */
export const applyHolidayOverlayForDate = async (
    schedule: DailySchedule | null,
    dateKey: string,
): Promise<HolidayOverlayResult> => {
    const year = Number(dateKey.slice(0, 4));
    if (!Number.isFinite(year)) return { schedule, holidayInfo: null, modified: false };
    const { fetchCnHolidays } = await import('./cnHoliday');
    const data = await fetchCnHolidays(year);
    return applyHolidayOverlay(schedule, dateKey, data);
};
