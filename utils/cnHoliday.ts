/**
 * cnHoliday — 中国法定节假日 / 调休补班数据（国务院安排）。
 *
 * 数据流：timor.tech 免费 API（无需 key）→ IndexedDB 按年缓存（7 天过期刷新）
 * → 失败回退内置静态表（仅收录已官方公布的年份，绝不编造未来安排）。
 * 对外提供 isHoliday / isMakeupWorkday / holidayBlockForPrompt，
 * 供日程状态机（scheduleHolidaySync）与提示词注入使用。
 */

export interface CnHolidayDay {
    /** YYYY-MM-DD */
    date: string;
    /** 节日/补班名（如「春节」「春节前补班」） */
    name: string;
    /** true = 放假；false = 调休补班（要上班） */
    isOffDay: boolean;
}

export interface CnHolidayYearData {
    year: number;
    /** key = 'MM-dd'（timor.tech 原始口径） */
    days: Record<string, CnHolidayDay>;
    fetchedAt: number;
    source: 'api' | 'builtin';
}

export interface HolidayInfo {
    isOffDay: boolean;
    isMakeupWorkday: boolean;
    name?: string;
}

const API_BASE = 'https://timor.tech/api/holiday/year/';
const CACHE_FRESH_MS = 7 * 24 * 60 * 60 * 1000;

// ========== 内置静态表（只收录国务院已正式公布的安排；2025）==========

const BUILTIN_2025: Record<string, CnHolidayDay> = (() => {
    const days: Record<string, CnHolidayDay> = {};
    const put = (date: string, name: string, isOffDay: boolean) => {
        days[date.slice(5)] = { date, name, isOffDay };
    };
    // 元旦
    put('2025-01-01', '元旦', true);
    // 春节（1/28 除夕 - 2/4），补班 1/26、2/8
    for (let d = 28; d <= 31; d++) put(`2025-01-${d}`, '春节', true);
    for (let d = 1; d <= 4; d++) put(`2025-02-0${d}`, '春节', true);
    put('2025-01-26', '春节前补班', false);
    put('2025-02-08', '春节后补班', false);
    // 清明 4/4-4/6
    put('2025-04-04', '清明节', true);
    put('2025-04-05', '清明节', true);
    put('2025-04-06', '清明节', true);
    // 劳动节 5/1-5/5，补班 4/27
    for (let d = 1; d <= 5; d++) put(`2025-05-0${d}`, '劳动节', true);
    put('2025-04-27', '劳动节前补班', false);
    // 端午 5/31-6/2
    put('2025-05-31', '端午节', true);
    put('2025-06-01', '端午节', true);
    put('2025-06-02', '端午节', true);
    // 国庆、中秋 10/1-10/8，补班 9/28、10/11
    for (let d = 1; d <= 8; d++) put(`2025-10-0${d}`, '国庆节、中秋节', true);
    put('2025-09-28', '国庆节前补班', false);
    put('2025-10-11', '国庆节后补班', false);
    return days;
})();

const BUILTIN_TABLE: Record<number, Record<string, CnHolidayDay>> = {
    2025: BUILTIN_2025,
};

// ========== 日期键工具 ==========

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** Date → 'YYYY-MM-DD'（本地日历日） */
export const dateKeyOf = (d: Date): string =>
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/** 'YYYY-MM-DD' → 'MM-dd'（timor.tech 键口径） */
const mmddOf = (dateKey: string): string | null => {
    const m = /^\d{4}-(\d{2}-\d{2})$/.exec(dateKey || '');
    return m ? m[1] : null;
};

// ========== IndexedDB 缓存（独立轻量库，不动主库 schema）==========

const CACHE_DB_NAME = 'aetheros_cache';
const CACHE_STORE = 'holiday_years';

let cacheDbPromise: Promise<IDBDatabase> | null = null;

const openCacheDb = (): Promise<IDBDatabase> => {
    if (cacheDbPromise) return cacheDbPromise;
    cacheDbPromise = new Promise((resolve, reject) => {
        try {
            const req = indexedDB.open(CACHE_DB_NAME, 1);
            req.onupgradeneeded = () => {
                if (!req.result.objectStoreNames.contains(CACHE_STORE)) {
                    req.result.createObjectStore(CACHE_STORE, { keyPath: 'year' });
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        } catch (e) {
            reject(e);
        }
    });
    return cacheDbPromise;
};

const readCache = async (year: number): Promise<CnHolidayYearData | null> => {
    try {
        const db = await openCacheDb();
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(CACHE_STORE, 'readonly');
            const req = tx.objectStore(CACHE_STORE).get(year);
            req.onsuccess = () => resolve((req.result as CnHolidayYearData) || null);
            req.onerror = () => reject(req.error);
        });
    } catch { return null; }
};

const writeCache = async (data: CnHolidayYearData): Promise<void> => {
    try {
        const db = await openCacheDb();
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(CACHE_STORE, 'readwrite');
            tx.objectStore(CACHE_STORE).put(data);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error || new Error('holiday cache write aborted'));
        });
    } catch { /* 缓存写失败不影响主链路 */ }
};

// ========== API 拉取 ==========

const fetchFromApi = async (year: number): Promise<CnHolidayYearData | null> => {
    if (typeof fetch !== 'function') return null; // 非浏览器/无 fetch 环境（测试）直接降级
    try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 6000);
        const res = await fetch(`${API_BASE}${year}`, { signal: ctrl.signal });
        clearTimeout(timer);
        if (!res.ok) return null;
        const json = await res.json();
        if (!json || typeof json !== 'object' || !json.holiday || typeof json.holiday !== 'object') return null;
        const days: Record<string, CnHolidayDay> = {};
        for (const [mmdd, raw] of Object.entries(json.holiday as Record<string, any>)) {
            if (!raw || typeof raw !== 'object') continue;
            const date = typeof raw.date === 'string' ? raw.date : `${year}-${mmdd}`;
            days[mmdd] = {
                date,
                name: String(raw.name || (raw.holiday ? '法定假日' : '调休补班')),
                isOffDay: raw.holiday === true,
            };
        }
        if (Object.keys(days).length === 0) return null;
        return { year, days, fetchedAt: Date.now(), source: 'api' };
    } catch {
        return null;
    }
};

// ========== 对外入口 ==========

/**
 * 取某年的节假日数据：IndexedDB 缓存（7 天内新鲜直接用）→ API → 内置表。
 * 全部失败返回 null（调用方严格降级为原日程，不做任何节假日改写）。
 */
export const fetchCnHolidays = async (
    year: number,
    opts: { forceRefresh?: boolean } = {},
): Promise<CnHolidayYearData | null> => {
    if (!opts.forceRefresh) {
        const cached = await readCache(year);
        if (cached && (Date.now() - cached.fetchedAt) < CACHE_FRESH_MS) return cached;
    }

    const fromApi = await fetchFromApi(year);
    if (fromApi) {
        await writeCache(fromApi);
        return fromApi;
    }

    // API 失败：7 天内旧缓存也先用（宁用旧数据也不用错数据）
    const stale = await readCache(year);
    if (stale) return stale;

    const builtin = BUILTIN_TABLE[year];
    if (builtin) return { year, days: builtin, fetchedAt: 0, source: 'builtin' };

    return null;
};

/** 某日是否命中节假日安排（放假或补班）；无数据返回 null */
export const getHolidayInfo = (data: CnHolidayYearData | null, dateKey: string): HolidayInfo | null => {
    if (!data) return null;
    const mmdd = mmddOf(dateKey);
    if (!mmdd) return null;
    const day = data.days[mmdd];
    if (!day) return null;
    return {
        isOffDay: day.isOffDay,
        isMakeupWorkday: !day.isOffDay,
        name: day.name,
    };
};

/** 便捷封装：查某天的节假日信息（自带取数） */
export const getHolidayInfoForDate = async (
    date: Date,
    opts: { forceRefresh?: boolean } = {},
): Promise<HolidayInfo | null> => {
    const data = await fetchCnHolidays(date.getFullYear(), opts);
    return getHolidayInfo(data, dateKeyOf(date));
};

/** 生成提示词用节假日块（无节假日返回空串） */
export const holidayBlockForPrompt = (info: HolidayInfo | null): string => {
    if (!info) return '';
    if (info.isOffDay) {
        return `今日为法定假日${info.name ? `（${info.name}）` : ''}：按国家安排放假，日程相应放宽。`;
    }
    if (info.isMakeupWorkday) {
        return `今日为调休补班日${info.name ? `（${info.name}）` : ''}：虽是周末但要正常上班，日程按工作日安排。`;
    }
    return '';
};

// ========== 恶劣天气（地点×天气提示词层联动用）==========
//
// 与 scheduleInjection.badWeatherAdvice 同一套判定/口径：那份拖着 types.ts 的注入
// 渲染逻辑，worker 环境无关叶子引不动，这里给叶子留一份同判定的。两处若分叉，
// 聊天与主动消息会给出两种「什么叫坏天气」。

export const isBadWeather = (description?: string, tempC?: number): boolean =>
    !!((description || '').trim() &&
        (/雨|雪|雷|冰雹|沙尘|雾霾/.test(description || '') ||
            (typeof tempC === 'number' && Number.isFinite(tempC) && (tempC >= 35 || tempC <= -5))));