/**
 * 中心 worker 的 /latent/* 生图代理（worker/index.js）。
 *
 * latent.moe API 不发 CORS 头，浏览器直连会被拦，所以经这里纯透传。
 * 锁住：
 *   - 无 Authorization → 401，且一次上游都不发
 *   - JSON 接口透传到 https://latent.moe/api/*，key 原样透传、worker 不落盘
 *   - /media/* 回二进制流（不能走 text()，会弄坏 PNG），带 CORS 头
 *   - 非 GET/POST → 405
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
// @ts-expect-error 中心 worker 是纯 JS 单文件，仓库没开 allowJs
import worker from './index.js';

const TOKEN = 'Bearer lat_sk_test';

const stubUpstream = (status = 200, body: string | Uint8Array = '{"ok":true}', contentType = 'application/json') => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fake = vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url: String(url), init });
        return new Response(body as any, { status, headers: { 'Content-Type': contentType } });
    });
    vi.stubGlobal('fetch', fake);
    return calls;
};

const callProxy = (
    path: string,
    { method = 'GET', auth = TOKEN as string | null, body = undefined as BodyInit | undefined } = {}
) => {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (auth) h['Authorization'] = auth;
    return worker.fetch(new Request(`https://proxy.test${path}`, { method, headers: h, body }), {}, { waitUntil: () => {} });
};

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('/latent 代理', () => {
    it('无 Authorization → 401，且一次上游都不发', async () => {
        const calls = stubUpstream();
        const res = await callProxy('/latent/generate/status', { auth: null });
        expect(res.status).toBe(401);
        expect(calls).toHaveLength(0);
    });

    it('POST /latent/generate → 转给 latent.moe/api/generate，key 原样透传', async () => {
        const calls = stubUpstream(202, '{"id":"job-1","status":"queued"}');
        const res = await callProxy('/latent/generate', {
            method: 'POST',
            body: JSON.stringify({ prompt: '1girl', resolution: 'portrait', steps: 12 }),
        });
        expect(res.status).toBe(202);
        expect(calls).toHaveLength(1);
        expect(calls[0].url).toBe('https://latent.moe/api/generate');
        expect((calls[0].init.headers as Record<string, string>)['Authorization']).toBe(TOKEN);
        expect(await res.json()).toMatchObject({ id: 'job-1' });
    });

    it('GET /latent/generate/{id} → 轮询透传，query 保留', async () => {
        const calls = stubUpstream(200, '{"status":"running"}');
        const res = await callProxy('/latent/generate/job-1');
        expect(res.status).toBe(200);
        expect(calls[0].url).toBe('https://latent.moe/api/generate/job-1');
    });

    it('GET /latent/media/* → 二进制流式回传，Content-Type 透传，带 CORS 头', async () => {
        const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
        const calls = stubUpstream(200, png, 'image/png');
        const res = await callProxy('/latent/media/art-1?size=preview');
        expect(res.status).toBe(200);
        expect(calls[0].url).toBe('https://latent.moe/api/media/art-1?size=preview');
        expect(res.headers.get('Content-Type')).toBe('image/png');
        expect(res.headers.get('Access-Control-Allow-Origin')).toBeTruthy();
        const buf = new Uint8Array(await res.arrayBuffer());
        expect(Array.from(buf)).toEqual(Array.from(png));
    });

    it('DELETE → 405，上游不发', async () => {
        const calls = stubUpstream();
        const res = await callProxy('/latent/generate/job-1', { method: 'DELETE' });
        expect(res.status).toBe(405);
        expect(calls).toHaveLength(0);
    });
});
