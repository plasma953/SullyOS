/**
 * lunarTable — 零依赖公农历换算（1900-2100）。
 *
 * 供时光契约的农历重复规则与日历农历标注使用。
 * 口径：1900-01-31 = 农历 1900 年正月初一；LUNAR_INFO 每年一个压缩字
 * （低 4 位闰月月份，0x10000 位为闰月大小，其余 12 位为大月小月位）。
 * 与 realtimeWorldCore 的预计算节日表口径一致，但这里是通用换算能力。
 */

// 1900-2100 逐年压缩数据（201 项）
const LUNAR_INFO: number[] = [
    0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0, 0x09ad0, 0x055d2, // 1900-1909
    0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255, 0x0b540, 0x0d6a0, 0x0ada2, 0x095b0, 0x14977, // 1910-1919
    0x04970, 0x0a4b0, 0x0b4b5, 0x06a50, 0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970, // 1920-1929
    0x06566, 0x0d4a0, 0x0ea50, 0x06e95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950, // 1930-1939
    0x0d4a0, 0x1d8a6, 0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0, 0x0d2b2, 0x0a950, 0x0b557, // 1940-1949
    0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5b0, 0x14573, 0x052b0, 0x0a9a8, 0x0e950, 0x06aa0, // 1950-1959
    0x0aea6, 0x0ab50, 0x04b60, 0x0aae4, 0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0, // 1960-1969
    0x096d0, 0x04dd5, 0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558, 0x0b540, 0x0b6a0, 0x195a6, // 1970-1979
    0x095b0, 0x049b0, 0x0a974, 0x0a4b0, 0x0b27a, 0x06a50, 0x06d40, 0x0af46, 0x0ab60, 0x09570, // 1980-1989
    0x04af5, 0x04970, 0x064b0, 0x074a3, 0x0ea50, 0x06b58, 0x05ac0, 0x0ab60, 0x096d5, 0x092e0, // 1990-1999
    0x0c960, 0x0d954, 0x0d4a0, 0x0da50, 0x07552, 0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5, // 2000-2009
    0x0a950, 0x0b4a0, 0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930, // 2010-2019
    0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260, 0x0ea65, 0x0d530, // 2020-2029
    0x05aa0, 0x076a3, 0x096d0, 0x04afb, 0x04ad0, 0x0a4d0, 0x1d0b6, 0x0d250, 0x0d520, 0x0dd45, // 2030-2039
    0x0b5a0, 0x056d0, 0x055b2, 0x049b0, 0x0a577, 0x0a4b0, 0x0aa50, 0x1b255, 0x06d20, 0x0ada0, // 2040-2049
    0x14b63, 0x09370, 0x049f8, 0x04970, 0x064b0, 0x168a6, 0x0ea50, 0x06b20, 0x1a6c4, 0x0aae0, // 2050-2059
    0x0a2e0, 0x0d2e3, 0x0c960, 0x0d557, 0x0d4a0, 0x0da50, 0x05d55, 0x056a0, 0x0a6d0, 0x055d4, // 2060-2069
    0x052d0, 0x0a9b8, 0x0a950, 0x0b4a0, 0x0b6a6, 0x0ad50, 0x055a0, 0x0aba4, 0x0a5b0, 0x052b0, // 2070-2079
    0x0b273, 0x06930, 0x07337, 0x06aa0, 0x0ad50, 0x14b55, 0x04b60, 0x0a570, 0x054e4, 0x0d160, // 2080-2089
    0x0e968, 0x0d520, 0x0daa0, 0x16aa6, 0x056d0, 0x04ae0, 0x0a9d4, 0x0a2d0, 0x0d150, 0x0f252, // 2090-2099
    0x0d520, // 2100
];

export const LUNAR_SUPPORTED_MIN_YEAR = 1901;
export const LUNAR_SUPPORTED_MAX_YEAR = 2099;

export interface LunarDate {
    year: number;
    /** 1-12；闰月仍用其主月号，配合 isLeap */
    month: number;
    day: number;
    isLeap: boolean;
}

/** 农历闰月月份（0 = 该年无闰月） */
export const lunarLeapMonth = (year: number): number =>
    (LUNAR_INFO[year - 1900] ?? 0) & 0xf;

/** 闰月天数（无闰月返回 0） */
export const lunarLeapDays = (year: number): number =>
    lunarLeapMonth(year) ? ((LUNAR_INFO[year - 1900] & 0x10000) ? 30 : 29) : 0;

/** 农历某年总天数 */
export const lunarYearDays = (year: number): number => {
    let sum = 348;
    for (let i = 0x8000; i > 0x8; i >>= 1) sum += (LUNAR_INFO[year - 1900] & i) ? 1 : 0;
    return sum + lunarLeapDays(year);
};

/** 农历某年某月（非闰）天数：29 / 30 */
export const lunarMonthDays = (year: number, month: number): number =>
    (LUNAR_INFO[year - 1900] & (0x10000 >> month)) ? 30 : 29;

const offsetFromBase = (y: number, m: number, d: number): number =>
    Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1900, 0, 31)) / 86400000);

/** 公历 → 农历。超出支持范围返回 null。 */
export function solarToLunar(solarY: number, solarM: number, solarD: number): LunarDate | null {
    if (solarY < LUNAR_SUPPORTED_MIN_YEAR || solarY > LUNAR_SUPPORTED_MAX_YEAR) return null;
    let offset = offsetFromBase(solarY, solarM, solarD);
    if (offset < 0) return null;

    let temp = 0;
    let year = 1900;
    for (year = 1900; year < 2101 && offset > 0; year++) {
        temp = lunarYearDays(year);
        offset -= temp;
    }
    if (offset < 0) {
        offset += temp;
        year--;
    }
    const lunarYear = year;

    const leap = lunarLeapMonth(lunarYear);
    let isLeap = false;
    let month = 1;
    for (month = 1; month < 13 && offset > 0; month++) {
        if (leap > 0 && month === leap + 1 && isLeap === false) {
            --month;
            isLeap = true;
            temp = lunarLeapDays(lunarYear);
        } else {
            temp = lunarMonthDays(lunarYear, month);
        }
        if (isLeap === true && month === leap + 1) {
            isLeap = false;
        }
        offset -= temp;
    }
    if (offset === 0 && leap > 0 && month === leap + 1) {
        if (isLeap) {
            isLeap = false;
        } else {
            isLeap = true;
            --month;
        }
    }
    if (offset < 0) {
        offset += temp;
        --month;
    }

    return { year: lunarYear, month, day: offset + 1, isLeap };
}

/** Date 便捷入口 */
export const solarToLunarOf = (date: Date): LunarDate | null =>
    solarToLunar(date.getFullYear(), date.getMonth() + 1, date.getDate());

/**
 * 农历 → 公历。超出支持范围 / 闰月不存在 / 日超出当月天数返回 null。
 */
export function lunarToSolar(lunarY: number, lunarM: number, lunarD: number, isLeapMonth = false): Date | null {
    if (lunarY < LUNAR_SUPPORTED_MIN_YEAR || lunarY > LUNAR_SUPPORTED_MAX_YEAR) return null;
    if (lunarM < 1 || lunarM > 12 || lunarD < 1) return null;
    const leap = lunarLeapMonth(lunarY);
    if (isLeapMonth && leap !== lunarM) return null;

    let total = 0;
    for (let y = 1900; y < lunarY; y++) total += lunarYearDays(y);
    for (let m = 1; m < lunarM; m++) {
        total += lunarMonthDays(lunarY, m);
        if (leap === m) total += lunarLeapDays(lunarY);
    }
    if (isLeapMonth) {
        // 闰 M 月在正常 M 月之后：先跨过正常 M 月
        total += lunarMonthDays(lunarY, lunarM);
        if (lunarD > lunarLeapDays(lunarY)) return null;
    } else {
        if (lunarD > lunarMonthDays(lunarY, lunarM)) return null;
    }

    return new Date(1900, 0, 31 + total + lunarD - 1);
}

// ========== 展示名 ==========

export const LUNAR_MONTH_NAMES = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊'];

export const LUNAR_DAY_NAMES: string[] = (() => {
    const names: string[] = [];
    const pre = ['初', '十', '廿', '三'];
    const num = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
    for (let i = 1; i <= 30; i++) {
        if (i === 10) names.push('初十');
        else if (i === 20) names.push('二十');
        else if (i === 30) names.push('三十');
        else names.push(pre[Math.floor((i - 1) / 10)] + num[(i - 1) % 10]);
    }
    return names;
})();

/** 农历月份名（含闰前缀），如「二」「闰二」 */
export const lunarMonthLabel = (ld: LunarDate): string =>
    `${ld.isLeap ? '闰' : ''}${LUNAR_MONTH_NAMES[ld.month - 1] ?? '?'}月`;

/** 农历日名，如「初五」「廿三」 */
export const lunarDayLabel = (ld: LunarDate): string =>
    LUNAR_DAY_NAMES[ld.day - 1] ?? String(ld.day);

/** 公历日期 → 短农历标注（初一显示月名，其余显示日名），如「腊月初一」「初五」 */
export const formatLunarShort = (date: Date): string => {
    const ld = solarToLunarOf(date);
    if (!ld) return '';
    return ld.day === 1 ? lunarMonthLabel(ld) : lunarDayLabel(ld);
};
