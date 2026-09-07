/**
 * 中心 worker 的 OPTIONS 预检回显（worker/index.js）。
 *
 * 锁住：
 *   - 无声明头时回固定放行表；
 *   - 浏览器声明的新头被原样回显（且与固定表去重），新功能加请求头不再需要改放行表；
 *   - 非法头名 / 超长项被过滤掉。
 *
 * 纯预检路径，一次上游都不发。
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error 中心 worker 是纯 JS 单文件，仓库没开 allowJs
import worker from './index.js';

const options = (headers?: Record<string, string>) =>
    worker.fetch(new Request('https://proxy.test/search', { method: 'OPTIONS', headers }), {}, { waitUntil: () => {} });

const allowList = (res: Response): string[] =>
    (res.headers.get('Access-Control-Allow-Headers') || '').split(',').map((s) => s.trim()).filter(Boolean);

describe('中心 worker OPTIONS 预检回显', () => {
    it('无声明头时回固定放行表', async () => {
        const res = await options();
        expect(res.status).toBe(204);
        const allow = allowList(res);
        expect(allow).toContain('Content-Type');
        expect(allow).toContain('Authorization');
    });

    it('声明的新头被回显（与固定表去重）', async () => {
        const res = await options({ 'Access-Control-Request-Headers': 'X-Custom-Thing, Authorization' });
        expect(res.status).toBe(204);
        const allow = allowList(res);
        expect(allow).toContain('X-Custom-Thing');
        expect(allow.filter((h) => h.toLowerCase() === 'authorization')).toHaveLength(1);
    });

    it('非法头名与超长项被过滤', async () => {
        const longName = `X-${'y'.repeat(70)}`;
        const res = await options({ 'Access-Control-Request-Headers': `Bad Header, X-Ok, ${longName}` });
        const allow = allowList(res);
        expect(allow).toContain('X-Ok');
        expect(allow).not.toContain('Bad Header');
        expect(allow).not.toContain(longName);
    });
});
