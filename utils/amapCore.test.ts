import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    AmapApiError,
    buildAmapUrl,
    fetchAmap,
    formatDistance,
    gcj02ToWgs84,
    geocodeCity,
    haversineKm,
    isAbroadErrorCode,
    isAuthErrorCode,
    isQuotaErrorCode,
    parseAmapLocation,
    renderPlaceLibraryDating,
    renderPlaceLibraryFull,
    searchPlaces,
    shortType,
    wgs84ToGcj02,
    type CityPlaceLibrary,
} from './amapCore';

afterEach(() => {
    vi.unstubAllGlobals();
});

const fakeLibrary = (): CityPlaceLibrary => ({
    adcode: '310000',
    city: '上海市',
    province: '上海市',
    centerLat: 31.231706,
    centerLng: 121.472644,
    fetchedAt: Date.now(),
    places: [
        { name: '滨江公园', type: '风景名胜;公园广场;公园', typeShort: '公园', category: 'park', address: '滨江大道', district: '浦东新区', lat: 31.24, lng: 121.5, adcode: '310115' },
        { name: '陆家嘴中心', type: '购物服务;购物中心;购物中心', typeShort: '购物中心', category: 'mall', district: '浦东新区', lat: 31.239, lng: 121.508, adcode: '310115' },
        { name: '老街咖啡', type: '餐饮服务;咖啡厅;咖啡厅', typeShort: '咖啡厅', category: 'cafe', district: '黄浦区', lat: 31.225, lng: 121.48, adcode: '310101' },
    ],
});

describe('buildAmapUrl', () => {
    it('代理根 + /amap + 高德 path + 参数 + key', () => {
        const url = buildAmapUrl('https://proxy.example/', '/v3/geocode/geo', { address: '上海' }, 'KEY123');
        expect(url.startsWith('https://proxy.example/amap/v3/geocode/geo?')).toBe(true);
        expect(url).toContain('key=KEY123');
        expect(url).toContain(encodeURIComponent('上海'));
    });
});

describe('parseAmapLocation', () => {
    it('高德格式是经度在前', () => {
        expect(parseAmapLocation('121.472644,31.231706')).toEqual({ lng: 121.472644, lat: 31.231706 });
    });
    it('垃圾输入返回 undefined', () => {
        expect(parseAmapLocation('')).toBeUndefined();
        expect(parseAmapLocation('abc')).toBeUndefined();
        expect(parseAmapLocation(undefined)).toBeUndefined();
    });
});

describe('shortType', () => {
    it('取最后一段', () => {
        expect(shortType('风景名胜;公园广场;公园')).toBe('公园');
        expect(shortType('公园')).toBe('公园');
        expect(shortType('')).toBe('');
    });
});

describe('坐标系', () => {
    it('国境外原样返回（东京）', () => {
        expect(wgs84ToGcj02(35.681, 139.767)).toEqual({ lat: 35.681, lng: 139.767 });
        expect(gcj02ToWgs84(35.681, 139.767)).toEqual({ lat: 35.681, lng: 139.767 });
    });
    it('国内偏移非零但量级合理（北京，偏移约几百米）', () => {
        const out = wgs84ToGcj02(39.9042, 116.4074);
        expect(Math.abs(out.lat - 39.9042)).toBeGreaterThan(0);
        expect(Math.abs(out.lat - 39.9042)).toBeLessThan(0.01);
        expect(Math.abs(out.lng - 116.4074)).toBeGreaterThan(0);
        expect(Math.abs(out.lng - 116.4074)).toBeLessThan(0.02);
    });
    it('正逆变换往返回到原点（1e-6 内）', () => {
        const pts = [
            { lat: 39.9042, lng: 116.4074 },
            { lat: 31.2304, lng: 121.4737 },
            { lat: 23.1291, lng: 113.2644 },
        ];
        for (const p of pts) {
            const gcj = wgs84ToGcj02(p.lat, p.lng);
            const back = gcj02ToWgs84(gcj.lat, gcj.lng);
            expect(Math.abs(back.lat - p.lat)).toBeLessThan(1e-6);
            expect(Math.abs(back.lng - p.lng)).toBeLessThan(1e-6);
        }
    });
    it('haversine：北京到上海约 1068km，同一点为 0', () => {
        const d = haversineKm(39.9042, 116.4074, 31.2304, 121.4737);
        expect(Math.abs(d - 1068)).toBeLessThan(15);
        expect(haversineKm(39.9042, 116.4074, 39.9042, 116.4074)).toBe(0);
    });
    it('formatDistance：不足 1km 显示米', () => {
        expect(formatDistance(0.4)).toBe('约400米');
        expect(formatDistance(3.25)).toBe('约3.3公里');
    });
});

describe('成段渲染', () => {
    it('全量清单按类别分组，含距离', () => {
        const text = renderPlaceLibraryFull(fakeLibrary());
        expect(text).toContain('上海市真实地点参考');
        expect(text).toContain('滨江公园');
        expect(text).toContain('公园');
        expect(text).toContain('距市中心');
    });
    it('约会子集只含 dating 类别', () => {
        const text = renderPlaceLibraryDating(fakeLibrary());
        expect(text).toContain('滨江公园');
        expect(text).toContain('老街咖啡');
        expect(text).toContain('陆家嘴中心');
    });
});

const jsonResponse = (obj: unknown) =>
    new Response(JSON.stringify(obj), { status: 200, headers: { 'Content-Type': 'application/json' } });

describe('fetchAmap', () => {
    it('status=0 抛 AmapApiError 并保留 infocode', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ status: '0', info: 'INVALID_USER_KEY', infocode: '10001' })));
        const err = await fetchAmap('https://proxy.example', '/v3/geocode/geo', { address: '上海' }, 'BAD', '地理编码').catch((e) => e);
        expect(err).toBeInstanceOf(AmapApiError);
        expect((err as AmapApiError).code).toBe('10001');
        expect(isAuthErrorCode((err as AmapApiError).code)).toBe(true);
    });
    it('配额与海外错误码判定', () => {
        expect(isQuotaErrorCode('10003')).toBe(true);
        expect(isQuotaErrorCode('10044')).toBe(true);
        expect(isQuotaErrorCode('10001')).toBe(false);
        expect(isAbroadErrorCode('20011')).toBe(true);
    });
});

describe('geocodeCity', () => {
    it('解析首个命中，含坐标与 adcode', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
            status: '1', info: 'OK', count: '1',
            geocodes: [{
                formatted_address: '上海市', province: '上海市', city: '上海市',
                citycode: '021', district: [], adcode: '310000', location: '121.472644,31.231706',
            }],
        })));
        const place = await geocodeCity('上海', { proxyUrl: 'https://proxy.example', key: 'K' });
        expect(place?.city).toBe('上海市');
        expect(place?.adcode).toBe('310000');
        expect(place?.lat).toBeCloseTo(31.231706, 5);
        expect(place?.lng).toBeCloseTo(121.472644, 5);
    });
    it('查无结果返回 null（count=0 但 status=1）', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ status: '1', info: 'OK', count: '0', geocodes: [] })));
        expect(await geocodeCity('不存在的城市', { proxyUrl: 'https://proxy.example', key: 'K' })).toBeNull();
    });
    it('直辖市 city 为空数组时退回 province', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
            status: '1', info: 'OK', count: '1',
            geocodes: [{ province: '北京市', city: [], citycode: '010', district: [], adcode: '110000', location: '116.405285,39.904989' }],
        })));
        const place = await geocodeCity('北京', { proxyUrl: 'https://proxy.example', key: 'K' });
        expect(place?.city).toBe('北京市');
    });
});

describe('searchPlaces', () => {
    it('pois 归一化，缺坐标的条目丢掉', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
            status: '1', info: 'OK', count: '2',
            pois: [
                { name: '滨江公园', type: '风景名胜;公园广场;公园', address: '滨江大道', adname: '浦东新区', adcode: '310115', location: '121.5,31.24' },
                { name: '无名地', type: '风景名胜', location: '' },
            ],
        })));
        const list = await searchPlaces('公园', '310000', 'park', { proxyUrl: 'https://proxy.example', key: 'K' });
        expect(list).toHaveLength(1);
        expect(list[0].name).toBe('滨江公园');
        expect(list[0].typeShort).toBe('公园');
        expect(list[0].category).toBe('park');
    });
});
