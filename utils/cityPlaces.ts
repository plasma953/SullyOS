/**
 * cityPlaces — 城市地点库缓存层（浏览器侧）
 *
 * 高德 POI 搜索个人配额只有 5000 次/月，一个城市建库就要约 11 次调用，
 * 所以地点库按城市缓存进 IndexedDB 独立轻量库 `sully_geo_cache`
 *（照 cnHoliday 的 aetheros_cache 模式，不动主库 schema）：TTL 30 天，
 * 过期下次用时自动重拉；设置页可手动刷新/删除。
 *
 * 失败一律降级返回 null 或旧缓存——调用方（prompt 注入）按「没有就不注入」处理，
 * 地点增强永远不能阻塞聊天主链路。
 */

import {
    fetchCityLibrary,
    geocodeCity,
    wgs84ToGcj02,
    type AmapAuth,
    type CityPlaceLibrary,
    type StructuredPlace,
} from './amapCore';
import { geocodeCityOpenMeteo } from './realtimeWorldCore';
import { getProxyWorkerUrl } from './proxyWorker';

const GEO_DB_NAME = 'sully_geo_cache';
const GEO_STORE = 'city_places';

/** 地点库缓存有效期：30 天（POI 变化慢 + 搜索配额 5000/月是硬约束）。 */
export const CITY_PLACES_TTL_MS = 30 * 24 * 3600 * 1000;

export interface CachedCityLibrary extends CityPlaceLibrary {
    /** 命中过的城市名写法（"上海"/"上海市"指同一库，免得重复建库）。 */
    aliases?: string[];
}

let geoDbPromise: Promise<IDBDatabase> | null = null;

const openGeoDb = (): Promise<IDBDatabase> => {
    if (geoDbPromise) return geoDbPromise;
    geoDbPromise = new Promise((resolve, reject) => {
        try {
            const req = indexedDB.open(GEO_DB_NAME, 1);
            req.onupgradeneeded = () => {
                if (!req.result.objectStoreNames.contains(GEO_STORE)) {
                    req.result.createObjectStore(GEO_STORE, { keyPath: 'adcode' });
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        } catch (e) {
            reject(e);
        }
    });
    return geoDbPromise;
};

/** 测试用：关掉单例，下轮重开（fake-indexeddb 按文件隔离，一般用不上）。 */
export const __resetGeoDbForTest = (): void => {
    try { void geoDbPromise?.then((db) => { try { db.close(); } catch { /* ignore */ } }); } catch { /* ignore */ }
    geoDbPromise = null;
};

/** 测试用：直接写一条库记录（含自定义 fetchedAt，用于构造过期场景）。 */
export const __seedLibraryForTest = async (lib: CachedCityLibrary): Promise<void> => {
    await writeLibrary(lib);
};

const readAllLibraries = async (): Promise<CachedCityLibrary[]> => {
    try {
        const db = await openGeoDb();
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(GEO_STORE, 'readonly');
            const req = tx.objectStore(GEO_STORE).getAll();
            req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
            req.onerror = () => reject(req.error);
        });
    } catch {
        return [];
    }
};

const writeLibrary = async (lib: CachedCityLibrary): Promise<void> => {
    const db = await openGeoDb();
    await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(GEO_STORE, 'readwrite');
        tx.objectStore(GEO_STORE).put(lib);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('city_places write aborted'));
    });
};

const findLibrary = (libs: CachedCityLibrary[], name: string): CachedCityLibrary | null => {
    const q = name.trim();
    if (!q) return null;
    return libs.find((l) =>
        l.city === q || l.adcode === q || (l.aliases || []).includes(q),
    ) || null;
};

const isFresh = (lib: CachedCityLibrary, now = Date.now()): boolean =>
    typeof lib.fetchedAt === 'number' && now - lib.fetchedAt < CITY_PLACES_TTL_MS;

// 同城并发只拉一次（日程生成与世界演绎可能同时触发）。
const inflight = new Map<string, Promise<CityPlaceLibrary | null>>();

/**
 * 取一个城市的地点库：缓存命中且新鲜直接返回；否则现拉（geocode 定 adcode →
 * 逐类检索），写库后返回。拉失败时有旧缓存顶旧缓存，都没有返回 null。
 */
export const getCityLibrary = async (
    cityName: string,
    auth: AmapAuth,
    opts?: { forceRefresh?: boolean },
): Promise<CityPlaceLibrary | null> => {
    const name = cityName.trim();
    if (!name || !auth.key) return null;

    const cached = findLibrary(await readAllLibraries(), name);
    if (cached && isFresh(cached) && !opts?.forceRefresh) return cached;

    const jobKey = name.toLowerCase();
    let job = inflight.get(jobKey);
    if (!job) {
        job = (async (): Promise<CityPlaceLibrary | null> => {
            try {
                const fresh = await fetchCityLibrary(name, auth);
                if (!fresh) return cached || null;
                const merged: CachedCityLibrary = {
                    ...fresh,
                    aliases: Array.from(new Set([
                        ...((cached && cached.adcode === fresh.adcode ? cached.aliases : []) || []),
                        fresh.city !== name ? name : '',
                    ].filter(Boolean) as string[])),
                };
                try {
                    await writeLibrary(merged);
                } catch (e) {
                    console.warn('[cityPlaces] 地点库写缓存失败，本次用内存结果:', e);
                }
                return merged;
            } catch (e) {
                console.warn(`[cityPlaces] ${name} 地点库拉取失败:`, e instanceof Error ? e.message : e);
                return cached || null;
            } finally {
                inflight.delete(jobKey);
            }
        })();
        inflight.set(jobKey, job);
    }
    return job;
};

/**
 * 城市名 → 结构化地点（MOVE_TO 验证 / 既有城市惰性回填共用）。
 * 已有完整结构（adcode + 坐标）直接返回，不打 API；否则地理编码补齐；
 * 失败返回 null（调用方保留原文）。
 */
export const resolveStructuredPlace = async (
    cityName: string,
    auth: AmapAuth,
    known?: { province?: string; city?: string; district?: string; lat?: number; lng?: number; adcode?: string },
): Promise<StructuredPlace | null> => {
    const name = cityName.trim();
    if (!name || !auth.key) return null;
    if (known?.adcode && known.lat != null && known.lng != null && known.city) {
        return {
            province: known.province,
            city: known.city,
            district: known.district,
            lat: known.lat,
            lng: known.lng,
            adcode: known.adcode,
        };
    }
    try {
        return await geocodeCity(name, auth);
    } catch (e) {
        console.warn(`[cityPlaces] ${name} 地理编码失败:`, e instanceof Error ? e.message : e);
        return null;
    }
};

/**
 * 浏览器侧读高德调用凭证：key（localStorage realtimeConfig）+ 代理地址。
 * Node/测试环境读不到存储时返回空 key（调用方按无 key 降级）。
 */
export const readAmapAuth = (): AmapAuth => {
    let key = '';
    try {
        const raw = localStorage.getItem('os_realtime_config');
        if (raw) {
            const cfg = JSON.parse(raw);
            if (typeof cfg?.amapApiKey === 'string') key = cfg.amapApiKey.trim();
        }
    } catch { /* 非浏览器/存储不可用：无 key 降级 */ }
    return { proxyUrl: getProxyWorkerUrl(), key };
};

/** localStorage 里的用户城市镜像键（updateUserProfile 单点写，只到城市级）。 */
export const USER_CITY_MIRROR_KEY = 'sully_user_city_v1';

/**
 * 读用户所在城市（只到城市级）：读 localStorage 镜像，同步、无 IO。
 * 镜像由 OSContext.updateUserProfile 单点维护（用户档案唯一的生产写入口）；
 * 读不到/被清空 → undefined，调用方按无用户城市处理。
 */
export const readUserCity = (): string | undefined => {
    try {
        const city = localStorage.getItem(USER_CITY_MIRROR_KEY);
        return (city || '').trim() || undefined;
    } catch {
        return undefined;
    }
};

/** 写用户城市镜像（updateUserProfile 调用；city 为空串时清掉）。 */
export const writeUserCityMirror = (city: string): void => {
    try {
        const v = (city || '').trim();
        if (v) localStorage.setItem(USER_CITY_MIRROR_KEY, v);
        else localStorage.removeItem(USER_CITY_MIRROR_KEY);
    } catch { /* 存储不可用：镜像缺失=无用户城市，不影响主链路 */ }
};

/**
 * MOVE_TO 验证：城市名 → 结构化地点。
 * 高德（国内，验出 adcode/坐标）→ Open-Meteo（海外回落，admin1 当省）→ null（调用方保留原文）。
 * 抛错一律内部吞掉返回 null：搬家验证永远不能阻塞聊天。
 */
export const enrichMoveToPlace = async (
    city: string,
    auth: AmapAuth,
    timeoutMs = 4000,
): Promise<StructuredPlace | null> => {
    const name = city.trim();
    if (!name) return null;
    if (auth.key) {
        try {
            const hit = await geocodeCity(name, auth, timeoutMs);
            if (hit) return hit;
        } catch (e) {
            console.warn(`[cityPlaces] MOVE_TO 高德验证失败，回落 Open-Meteo:`, e instanceof Error ? e.message : e);
        }
    }
    try {
        const g = await geocodeCityOpenMeteo(name, timeoutMs);
        if (!g) return null;
        const gcj = wgs84ToGcj02(g.latitude, g.longitude);
        return {
            province: g.admin1 || g.country,
            city: g.name,
            lat: gcj.lat,
            lng: gcj.lng,
        };
    } catch {
        return null;
    }
};

// ==================== 设置页地点库管理 ====================

/** 已缓存城市列表（设置页展示 + 手动刷新/删除用）。 */
export const listCachedLibraries = async (): Promise<Array<{
    adcode: string; city: string; province?: string; placeCount: number; fetchedAt: number; fresh: boolean;
}>> => {
    const libs = await readAllLibraries();
    return libs.map((l) => ({
        adcode: l.adcode,
        city: l.city,
        province: l.province,
        placeCount: Array.isArray(l.places) ? l.places.length : 0,
        fetchedAt: l.fetchedAt,
        fresh: isFresh(l),
    }));
};

export const deleteCachedLibrary = async (adcode: string): Promise<void> => {
    try {
        const db = await openGeoDb();
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(GEO_STORE, 'readwrite');
            tx.objectStore(GEO_STORE).delete(adcode);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error || new Error('city_places delete aborted'));
        });
    } catch (e) {
        console.warn('[cityPlaces] 删除地点库失败:', e);
    }
};

export const clearCachedLibraries = async (): Promise<void> => {
    try {
        const db = await openGeoDb();
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(GEO_STORE, 'readwrite');
            tx.objectStore(GEO_STORE).clear();
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error || new Error('city_places clear aborted'));
        });
    } catch (e) {
        console.warn('[cityPlaces] 清空地点库失败:', e);
    }
};
