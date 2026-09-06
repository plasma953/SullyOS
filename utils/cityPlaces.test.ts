// fake-indexeddb 已由 test-setup.ts 注入，走真实 DB 层（sully_geo_cache 独立轻量库）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    __seedLibraryForTest,
    clearCachedLibraries,
    deleteCachedLibrary,
    getCityLibrary,
    listCachedLibraries,
    resolveStructuredPlace,
} from './cityPlaces';

const AUTH = { proxyUrl: 'https://proxy.example', key: 'K' };

const json = (obj: unknown) =>
    new Response(JSON.stringify(obj), { status: 200, headers: { 'Content-Type': 'application/json' } });

const mockFetch = (opts?: { failAll?: boolean; emptyGeocode?: boolean }) => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
        const url = String(input);
        calls.push(url);
        if (opts?.failAll) throw new Error('network down');
        const u = new URL(url);
        if (u.pathname.includes('/v3/geocode/geo')) {
            if (opts?.emptyGeocode) return json({ status: '1', info: 'OK', count: '0', geocodes: [] });
            return json({
                status: '1', info: 'OK', count: '1',
                geocodes: [{
                    province: '上海市', city: '上海市', citycode: '021',
                    district: [], adcode: '310000', location: '121.472644,31.231706',
                }],
            });
        }
        if (u.pathname.includes('/v3/place/text')) {
            const kw = u.searchParams.get('keywords') || '地点';
            return json({
                status: '1', info: 'OK', count: '3',
                pois: [0, 1, 2].map((i) => ({
                    name: `${kw}测试店${i}`, type: '测试;测试;测试点',
                    address: `${kw}路${i}号`, adname: '浦东新区', adcode: '310115',
                    location: `121.5${i},31.24${i}`,
                })),
            });
        }
        throw new Error(`unexpected url ${url}`);
    }));
    return calls;
};

beforeEach(async () => {
    await clearCachedLibraries();
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

describe('getCityLibrary', () => {
    it('未命中时现拉（1 次地理编码 + 11 类检索）并写缓存，第二次走缓存不再打 API', async () => {
        const calls = mockFetch();
        const lib = await getCityLibrary('上海', AUTH);
        expect(lib?.adcode).toBe('310000');
        expect(lib?.places.length).toBeGreaterThan(0);
        expect(calls.filter((u) => u.includes('/v3/geocode/geo'))).toHaveLength(1);
        expect(calls.filter((u) => u.includes('/v3/place/text'))).toHaveLength(11);

        calls.length = 0;
        const cached = await getCityLibrary('上海市', AUTH);
        expect(cached?.adcode).toBe('310000');
        expect(calls).toHaveLength(0);
    });

    it('别名命中（"上海"建库，"上海市"与"上海"都命中缓存）', async () => {
        mockFetch();
        await getCityLibrary('上海', AUTH);
        const calls2: string[] = [];
        vi.stubGlobal('fetch', vi.fn(async (input: string) => {
            calls2.push(String(input));
            throw new Error('should not fetch');
        }));
        // 即使上游全挂，别名也能命中缓存
        expect((await getCityLibrary('上海', AUTH))?.adcode).toBe('310000');
        expect((await getCityLibrary('上海市', AUTH))?.adcode).toBe('310000');
        expect(calls2).toHaveLength(0);
    });

    it('无 key 直接返回 null，一次 API 都不打', async () => {
        const calls = mockFetch();
        expect(await getCityLibrary('上海', { proxyUrl: 'https://proxy.example', key: '' })).toBeNull();
        expect(calls).toHaveLength(0);
    });

    it('拉失败且无缓存返回 null', async () => {
        mockFetch({ failAll: true });
        expect(await getCityLibrary('上海', AUTH)).toBeNull();
    });

    it('过期后重拉；重拉失败则顶旧缓存', async () => {
        mockFetch();
        const first = await getCityLibrary('上海', AUTH);
        expect(first).not.toBeNull();

        // 直接种一条过期记录（不用 fake timers：会冻住 fake-indexeddb 的异步调度）
        await __seedLibraryForTest({ ...(first as any), fetchedAt: Date.now() - 31 * 86400000 });

        const refetchCalls = mockFetch();
        const second = await getCityLibrary('上海', AUTH);
        expect(second).not.toBeNull();
        expect(refetchCalls.length).toBeGreaterThan(0);

        await __seedLibraryForTest({ ...(second as any), fetchedAt: Date.now() - 31 * 86400000 });
        mockFetch({ failAll: true });
        const stale = await getCityLibrary('上海', AUTH);
        expect(stale?.adcode).toBe('310000');
    });

    it('forceRefresh 强制重拉', async () => {
        mockFetch();
        await getCityLibrary('上海', AUTH);
        const calls = mockFetch();
        await getCityLibrary('上海', AUTH, { forceRefresh: true });
        expect(calls.length).toBeGreaterThan(0);
    });
});

describe('resolveStructuredPlace', () => {
    it('已有完整结构直接返回，不打 API', async () => {
        const calls = mockFetch();
        const known = { province: '上海', city: '上海市', lat: 31.23, lng: 121.47, adcode: '310000' };
        expect(await resolveStructuredPlace('上海', AUTH, known)).toEqual({
            province: '上海', city: '上海市', district: undefined, lat: 31.23, lng: 121.47, adcode: '310000',
        });
        expect(calls).toHaveLength(0);
    });

    it('只有城市名时地理编码补齐；失败返回 null', async () => {
        mockFetch();
        const place = await resolveStructuredPlace('上海', AUTH, { city: '上海市' });
        expect(place?.adcode).toBe('310000');
        expect(place?.lat).toBeCloseTo(31.231706, 4);

        mockFetch({ emptyGeocode: true });
        expect(await resolveStructuredPlace('不存在的城市', AUTH)).toBeNull();
    });
});

describe('地点库管理', () => {
    it('list / delete / clear', async () => {
        mockFetch();
        expect(await listCachedLibraries()).toHaveLength(0);
        await getCityLibrary('上海', AUTH);
        const listed = await listCachedLibraries();
        expect(listed).toHaveLength(1);
        expect(listed[0].city).toBe('上海市');
        expect(listed[0].placeCount).toBeGreaterThan(0);
        expect(listed[0].fresh).toBe(true);

        await deleteCachedLibrary('310000');
        expect(await listCachedLibraries()).toHaveLength(0);

        await getCityLibrary('上海', AUTH);
        await clearCachedLibraries();
        expect(await listCachedLibraries()).toHaveLength(0);
    });
});
