/**
 * anniversaryEngine — 时光契约重复规则引擎。
 *
 * 支持：每年 / 每月 / 每周 / 自定义间隔天 / 单次，农历（含闰月与正月三十等
 * 大小月细节），以及跨年对齐。所有展开按「本地日历日」语义（YYYY-MM-DD 键），
 * 与 utils/localDate 的日期键口径一致。
 */
import type { Anniversary, AnniversaryRepeat } from '../types';
import { lunarToSolar, solarToLunarOf } from './lunarTable';

const pad2 = (n: number): string => String(n).padStart(2, '0');

export const toDateKey = (d: Date): string =>
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/** 解析 YYYY-MM-DD（兼容 YYYY/MM/DD）；失败返回 null */
export const parseDateKey = (key: string): Date | null => {
    const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec((key || '').trim());
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return Number.isNaN(d.getTime()) ? null : d;
};

export interface AnniversaryOccurrence {
    /** 本次发生的本地日历日键 */
    dateKey: string;
    /** 是否由农历换算而来 */
    fromLunar: boolean;
    /** 农历重复时，原定农历日因当月无此日而顺延到下月初一（如「三十」遇小月） */
    rolledOver?: boolean;
}

/** 规范化重复配置：缺省视为每年（旧行为兼容） */
export const normalizeRepeat = (anni: Anniversary): AnniversaryRepeat =>
    anni.repeat ?? { mode: 'yearly' };

/** 该契约是否启用农历 */
const isLunar = (repeat: AnniversaryRepeat): boolean => repeat.lunar === true;

/**
 * 对「月-日」形状做农历 → 公历换算（在 [yearFrom, yearTo] 范围内逐年）。
 * 月日来自 baseDate（原始公历登记日期的月/日，作为农历月/日解释）。
 */
const expandLunarYearly = (
    lunarMonth: number,
    lunarDay: number,
    yearFrom: number,
    yearTo: number,
): AnniversaryOccurrence[] => {
    const out: AnniversaryOccurrence[] = [];
    for (let y = Math.max(1901, yearFrom); y <= Math.min(2099, yearTo); y++) {
        const d = lunarToSolar(y, lunarMonth, lunarDay);
        if (d) {
            out.push({ dateKey: toDateKey(d), fromLunar: true });
            continue;
        }
        // 农历当月没有这一天（如「三十」遇小月）→ 顺延为次月（闰月或下月）初一
        for (let m = lunarMonth + 1; m <= 12 && !out.length; m++) {
            const d2 = lunarToSolar(y, m, 1);
            if (d2) out.push({ dateKey: toDateKey(d2), fromLunar: true, rolledOver: true });
        }
        if (!out.length) {
            // 跨年顺延：次年正月初一
            const d3 = lunarToSolar(y + 1, 1, 1);
            if (d3) out.push({ dateKey: toDateKey(d3), fromLunar: true, rolledOver: true });
        }
    }
    return out;
};

/**
 * 展开一条契约在 [fromKey, toKey] 日历区间内（含端点）的全部发生日，按日期升序。
 * 区间跨度建议 ≤ 400 天；更大区间请分段调用。
 */
export const expandOccurrences = (
    anni: Anniversary,
    fromKey: string,
    toKey: string,
): AnniversaryOccurrence[] => {
    const from = parseDateKey(fromKey);
    const to = parseDateKey(toKey);
    if (!from || !to || to.getTime() < from.getTime()) return [];
    const repeat = normalizeRepeat(anni);
    const base = parseDateKey(anni.date);
    if (!base) return [];

    const out: AnniversaryOccurrence[] = [];
    const pushIfInRange = (d: Date, extra?: Partial<AnniversaryOccurrence>) => {
        const key = toDateKey(d);
        if (key >= fromKey && key <= toKey) out.push({ dateKey: key, fromLunar: false, ...extra });
    };

    if (isLunar(repeat)) {
        // 农历按年重复（月/周/间隔暂不支持农历组合：农历本身是年周期语义）。
        // date 是用户登记那天真实的公历日（比如端午当天记的 06-22）——先把登记日
        // 换算成农历月日（五月初五），之后每年对齐农历同月同日。
        const baseLunar = solarToLunarOf(base);
        if (!baseLunar) return [];
        return expandLunarYearly(baseLunar.month, baseLunar.day, from.getFullYear(), to.getFullYear())
            .filter(o => o.dateKey >= fromKey && o.dateKey <= toKey)
            .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
    }

    switch (repeat.mode) {
        case 'none': {
            pushIfInRange(base);
            break;
        }
        case 'weekly': {
            const dayMs = 86400000;
            let t = from.getTime();
            // 对齐到 base 的星期（用不晚于 from 的第一个同星期日）
            const baseDow = base.getDay();
            const fromDow = from.getDay();
            let first = new Date(t - ((fromDow - baseDow + 7) % 7) * dayMs);
            if (first.getTime() < base.getTime()) first = base;
            for (let d = new Date(first); d.getTime() <= to.getTime(); d = new Date(d.getTime() + 7 * dayMs)) {
                pushIfInRange(d);
            }
            break;
        }
        case 'monthly': {
            // 在 [from月, to月] 范围内逐月枚举：取 base 的「日」，超出当月天数时收敛到月末
            const fromIdx = from.getFullYear() * 12 + from.getMonth();
            const toIdx = to.getFullYear() * 12 + to.getMonth();
            for (let idx = fromIdx; idx <= toIdx; idx++) {
                const y2 = Math.floor(idx / 12);
                const m2 = (idx % 12) + 1;
                const dim = new Date(y2, m2, 0).getDate();
                const day = Math.min(base.getDate(), dim);
                const d = new Date(y2, m2 - 1, day);
                if (d.getTime() >= base.getTime()) pushIfInRange(d);
            }
            break;
        }
        case 'interval': {
            const interval = Math.max(1, Math.floor(repeat.intervalDays ?? 1));
            const dayMs = 86400000;
            // 从 base 起每隔 interval 天；先快进到区间前最后一个对齐点
            const baseMs = base.getTime();
            const k0 = Math.max(0, Math.ceil((from.getTime() - baseMs) / (interval * dayMs)));
            for (let k = k0; ; k++) {
                const d = new Date(baseMs + k * interval * dayMs);
                if (d.getTime() > to.getTime()) break;
                if (d.getTime() >= from.getTime()) pushIfInRange(d);
                if (k > k0 + 5000) break; // 安全阀
            }
            break;
        }
        case 'yearly':
        default: {
            for (let y = from.getFullYear(); y <= to.getFullYear(); y++) {
                const dim = new Date(y, base.getMonth() + 1, 0).getDate();
                const day = Math.min(base.getDate(), dim);
                const d = new Date(y, base.getMonth(), day);
                if (d.getTime() >= base.getTime()) pushIfInRange(d);
            }
            break;
        }
    }

    return out.sort((a, b) => a.dateKey.localeCompare(b.dateKey));
};

/** 该契约在某日是否发生 */
export const isAnniversaryOn = (anni: Anniversary, dateKey: string): boolean =>
    expandOccurrences(anni, dateKey, dateKey).length > 0;

/**
 * 取某日起 withinDays 天内（含当天）将发生的契约，按最近发生日排序。
 * 返回 { anni, nextDateKey } 数组；无下一次发生的契约不返回。
 */
export const getUpcomingAnniversaries = (
    annis: Anniversary[],
    todayKey: string,
    withinDays = 7,
): { anni: Anniversary; nextDateKey: string; fromLunar: boolean }[] => {
    const today = parseDateKey(todayKey);
    if (!today) return [];
    const end = new Date(today.getTime() + withinDays * 86400000);
    const toKey = toDateKey(end);
    const out: { anni: Anniversary; nextDateKey: string; fromLunar: boolean }[] = [];
    for (const anni of annis) {
        const occ = expandOccurrences(anni, todayKey, toKey);
        if (occ.length > 0) out.push({ anni, nextDateKey: occ[0].dateKey, fromLunar: occ[0].fromLunar });
    }
    return out.sort((a, b) => a.nextDateKey.localeCompare(b.nextDateKey));
};

/**
 * 计算下一次发生日（不限于 withinDays 内）。找不到（如单次已过期）返回 null。
 * 搜索窗口：未来 2 年（农历跨 3 个公历年足够覆盖）。
 */
export const getNextOccurrenceKey = (anni: Anniversary, todayKey: string): string | null => {
    const today = parseDateKey(todayKey);
    if (!today) return null;
    const end = new Date(today.getTime() + 2 * 366 * 86400000);
    const occ = expandOccurrences(anni, todayKey, toDateKey(end));
    return occ.length > 0 ? occ[0].dateKey : null;
};