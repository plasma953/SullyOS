/**
 * 中心 worker 的 /amap/* 高德透传（worker/index.js）。
 *
 * 高德 REST 接口不发 CORS 头，浏览器直连会被拦，所以经这里纯透传。
 * 锁住：
 *   - GET /amap/v3/* → 转给 https://restapi.amap.com/v3/*，query（含 key）原样透传、worker 不落盘
 *   - 上游状态码与 body 原样回传（高德自己的 status/infocode 不动），带 CORS 头
 *   - 非 /v3/ 路径 → 400，且一次上游都不发（SSRF 收敛）
 *   - 非 GET → 405，上游不发
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
// @ts-expect-error 中心 worker 是纯 JS 单文件，仓库没开 allowJs
import worker from './index.js';

const stubUpstream = (status = 200, body = '{"status":"1","info":"OK","count":"0","geocodes":[]}') => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fake = vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url: String(url), init });
        return new Response(body, { status, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fake);
    return calls;
};

const callProxy = (path: string, method = 'GET') =>
    worker.fetch(new Request(`https://proxy.test${path}`, { method }), {}, { waitUntil: () => {} });

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('/amap 代理', () => {
    it('GET /amap/v3/geocode/geo → 转给 restapi.amap.com，query 原样透传', async () => {
        const calls = stubUpstream();
        const res = await callProxy('/amap/v3/geocode/geo?address=%E4%B8%8A%E6%B5%B7&key=K123');
        expect(res.status).toBe(200);
        expect(calls).toHaveLength(1);
        expect(calls[0].url).toBe('https://restapi.amap.com/v3/geocode/geo?address=%E4%B8%8A%E6%B5%B7&key=K123');
        expect(await res.json()).toMatchObject({ status: '1', count: '0' });
        expect(res.headers.get('Access-Control-Allow-Origin')).toBeTruthy();
    });

    it('上游非 200 原样回传状态码', async () => {
        stubUpstream(429, '{"status":"0","info":"CUQPS_HAS_EXCEEDED_THE_LIMIT"}');
        const res = await callProxy('/amap/v3/place/text?keywords=%E5%85%AC%E5%9B%AD&key=K123');
        expect(res.status).toBe(429);
    });

    it('非 /v3/ 路径 → 400，上游不发', async () => {
        const calls = stubUpstream();
        const res = await callProxy('/amap/v2/whatever?key=K123');
        expect(res.status).toBe(400);
        expect(calls).toHaveLength(0);
    });

    it('裸 /amap → 400，上游不发', async () => {
        const calls = stubUpstream();
        const res = await callProxy('/amap');
        expect(res.status).toBe(400);
        expect(calls).toHaveLength(0);
    });

    it('POST → 405，上游不发', async () => {
        const calls = stubUpstream();
        const res = await callProxy('/amap/v3/geocode/geo?address=x&key=K123', 'POST');
        expect(res.status).toBe(405);
        expect(calls).toHaveLength(0);
    });
});
