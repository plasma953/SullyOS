/**
 * 终端 CORS 代理（worker/opencode-proxy/worker.js）。
 *
 * 锁住：
 *   - ?target= 公网地址 → 透传 method/headers/body，上游状态码与 body 原样回传，带 CORS 头
 *   - Authorization 透传给 serve（Basic Auth），X-Proxy-Key 只验不传
 *   - PROXY_KEY 对不上 → 403，上游不发
 *   - localhost / 私网 / 非 http(s) 目标 → 400，上游不发（SSRF 收敛）
 *   - 缺 ?target= → 400
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
// @ts-expect-error opencode 代理 worker 是纯 JS，仓库没开 allowJs
import worker from './worker.js';

const stubUpstream = (status = 200, body = '{"healthy":true,"version":"1.18.29"}') => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fake = vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url: String(url), init });
        return new Response(body, { status, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fake);
    return calls;
};

const callProxy = (target: string | null, init: RequestInit = {}, proxyKey?: string) => {
    const url = target === null
        ? 'https://oc-proxy.test/'
        : `https://oc-proxy.test/?target=${encodeURIComponent(target)}`;
    const headers = new Headers(init.headers);
    if (proxyKey !== undefined) headers.set('X-Proxy-Key', proxyKey);
    return worker.fetch(new Request(url, { ...init, headers }), {}, { waitUntil: () => {} });
};

const callProxyWithEnv = (
    target: string,
    env: Record<string, string>,
    init: RequestInit = {},
    proxyKey?: string,
) => {
    const headers = new Headers(init.headers);
    if (proxyKey !== undefined) headers.set('X-Proxy-Key', proxyKey);
    return worker.fetch(
        new Request(`https://oc-proxy.test/?target=${encodeURIComponent(target)}`, { ...init, headers }),
        env,
        { waitUntil: () => {} },
    );
};

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('opencode-proxy worker', () => {
    const ENV = { PROXY_KEY: 'k' };
    it('公网 target → 透传 Authorization 与 method/body，状态码原样回传', async () => {
        const calls = stubUpstream();
        const res = await callProxyWithEnv('http://203.0.113.10:4096/global/health', ENV, {
            headers: { Authorization: 'Basic b3BlbmNvZGU6eA==' },
        }, 'k');
        expect(res.status).toBe(200);
        expect(calls).toHaveLength(1);
        expect(calls[0].url).toBe('http://203.0.113.10:4096/global/health');
        expect(new Headers(calls[0].init.headers).get('Authorization')).toBe('Basic b3BlbmNvZGU6eA==');
        expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
        expect(await res.json()).toMatchObject({ healthy: true });
    });

    it('上游非 200 原样回传', async () => {
        stubUpstream(401, 'unauthorized');
        const res = await callProxyWithEnv('http://203.0.113.10:4096/global/health', ENV, {}, 'k');
        expect(res.status).toBe(401);
    });

    it('未配置 PROXY_KEY → 401 fail-closed，上游不发', async () => {
        const calls = stubUpstream();
        const res = await callProxy('http://203.0.113.10:4096/global/health');
        expect(res.status).toBe(401);
        expect(calls).toHaveLength(0);
    });

    it('OPTIONS 只回显白名单内的请求头', async () => {
        stubUpstream();
        const res = await worker.fetch(new Request('https://oc-proxy.test/', {
            method: 'OPTIONS',
            headers: { 'access-control-request-headers': 'Authorization, X-Evil-Header' },
        }), ENV, { waitUntil: () => {} });
        expect(res.status).toBe(204);
        const echoed = res.headers.get('Access-Control-Allow-Headers') || '';
        expect(echoed).toContain('Authorization');
        expect(echoed).not.toContain('X-Evil-Header');
    });

    it('PROXY_KEY 对不上 → 403，上游不发', async () => {
        const calls = stubUpstream();
        const res = await callProxyWithEnv('http://203.0.113.10:4096/global/health', { PROXY_KEY: 'right' }, {}, 'wrong');
        expect(res.status).toBe(403);
        expect(calls).toHaveLength(0);
    });

    it('PROXY_KEY 对上 → 放行', async () => {
        stubUpstream();
        const res = await callProxyWithEnv('http://203.0.113.10:4096/global/health', { PROXY_KEY: 'right' }, {}, 'right');
        expect(res.status).toBe(200);
    });

    it('localhost / 私网 / 非 http 目标 → 400，上游不发', async () => {
        const calls = stubUpstream();
        for (const bad of [
            'http://localhost:4096/global/health',
            'http://127.0.0.1:4096/global/health',
            'http://192.168.1.5:4096/global/health',
            'http://10.0.0.2:4096/global/health',
            'ftp://203.0.113.10/x',
        ]) {
            const res = await callProxyWithEnv(bad, ENV, {}, 'k');
            expect(res.status).toBe(400);
        }
        expect(calls).toHaveLength(0);
    });

    it('缺 ?target= → 400', async () => {
        const calls = stubUpstream();
        const res = await worker.fetch(new Request('https://oc-proxy.test/', {
            headers: { 'X-Proxy-Key': 'k' },
        }), ENV, { waitUntil: () => {} });
        expect(res.status).toBe(400);
        expect(calls).toHaveLength(0);
    });
});
