/**
 * MCP CORS 代理（worker/mcp-proxy/worker.js）。
 *
 * 锁住：
 *   - 未配置 PROXY_KEY → 401 fail-closed，上游不发
 *   - PROXY_KEY 对不上 → 403，上游不发
 *   - 内网/本机/非 http(s) 目标 → 400，上游不发（SSRF 收敛）
 *   - OPTIONS 只回显白名单内的请求头
 *   - X-MCP-Forward-Headers 自定义透传头封顶（数量/长度）
 *   - 公网 target → 透传 method/headers/body
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
// @ts-expect-error mcp 代理 worker 是纯 JS，仓库没开 allowJs
import worker from './worker.js';

const stubUpstream = (status = 200, body = '{"ok":true}') => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fake = vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url: String(url), init });
        return new Response(body, { status, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fake);
    return calls;
};

const ENV = { PROXY_KEY: 'k' };

const callProxy = (
    target: string | null,
    env: Record<string, string> = ENV,
    init: RequestInit = {},
    proxyKey = 'k',
) => {
    const url = target === null
        ? 'https://mcp-proxy.test/'
        : `https://mcp-proxy.test/?target=${encodeURIComponent(target)}`;
    const headers = new Headers(init.headers);
    if (proxyKey !== '') headers.set('X-Proxy-Key', proxyKey);
    return worker.fetch(new Request(url, { ...init, headers }), env, { waitUntil: () => {} });
};

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('mcp-proxy worker', () => {
    it('公网 target → 透传 method/headers/body', async () => {
        const calls = stubUpstream();
        const res = await callProxy('https://mcp.example.com/mcp', ENV, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Mcp-Session-Id': 's1' },
            body: '{"jsonrpc":"2.0"}',
        });
        expect(res.status).toBe(200);
        expect(calls).toHaveLength(1);
        expect(new Headers(calls[0].init.headers).get('Mcp-Session-Id')).toBe('s1');
    });

    it('未配置 PROXY_KEY → 401 fail-closed，上游不发', async () => {
        const calls = stubUpstream();
        const res = await callProxy('https://mcp.example.com/mcp', {}, {}, '');
        expect(res.status).toBe(401);
        expect(calls).toHaveLength(0);
    });

    it('PROXY_KEY 对不上 → 403，上游不发', async () => {
        const calls = stubUpstream();
        const res = await callProxy('https://mcp.example.com/mcp', ENV, {}, 'wrong');
        expect(res.status).toBe(403);
        expect(calls).toHaveLength(0);
    });

    it('内网/非 http(s) 目标 → 400，上游不发', async () => {
        const calls = stubUpstream();
        for (const bad of [
            'http://localhost:3000/mcp',
            'http://127.0.0.1/mcp',
            'http://192.168.0.1/mcp',
            'ftp://mcp.example.com/x',
        ]) {
            const res = await callProxy(bad);
            expect(res.status, bad).toBe(400);
        }
        expect(calls).toHaveLength(0);
    });

    it('OPTIONS 只回显白名单内的请求头', async () => {
        stubUpstream();
        const res = await worker.fetch(new Request('https://mcp-proxy.test/', {
            method: 'OPTIONS',
            headers: { 'access-control-request-headers': 'Authorization, X-Evil-Header' },
        }), ENV, { waitUntil: () => {} });
        expect(res.status).toBe(204);
        const echoed = res.headers.get('Access-Control-Allow-Headers') || '';
        expect(echoed).toContain('Authorization');
        expect(echoed).not.toContain('X-Evil-Header');
    });

    it('自定义透传头封顶：超量/超长被丢弃，合法直通头不受影响', async () => {
        const calls = stubUpstream();
        const many = Array.from({ length: 12 }, (_, i) => `X-Custom-${i}`).join(',');
        const res = await callProxy('https://mcp.example.com/mcp', ENV, {
            method: 'POST',
            headers: { 'X-MCP-Forward-Headers': many, 'X-Custom-0': 'v', Authorization: 'Bearer t' },
        });
        expect(res.status).toBe(200);
        const sent = new Headers(calls[0].init.headers);
        expect(sent.get('Authorization')).toBe('Bearer t');
        // 前 8 个放行，第 9 个起丢弃
        expect(sent.get('X-Custom-0')).toBe('v');
        expect(sent.get('X-Custom-11')).toBeNull();
    });
});
