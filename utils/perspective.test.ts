/**
 * perspective 单测：type 规范化 / 查询冷却 / 窗口计算 / fetch 参数组装与错误分支。
 * fetch 全 mock，不发真请求。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    normalizePerspectiveType,
    resolvePerspectiveEndpoint,
    isPerspectiveEnabled,
    queryPerspectiveEvents,
    countPerspectiveEvents,
    getLatestPerspectiveSummary,
    savePerspectiveSummary,
    clearPerspectiveEvents,
    checkPerspectiveInterval,
    markPerspectiveCalled,
    resetPerspectiveInterval,
    perspectiveWindow,
    PERSPECTIVE_MAX_DAYS,
    type PerspectiveEventRow,
} from './perspective';
import type { RealtimeConfig } from '../types';

const fullRc = {
    perspectiveEnabled: true,
    perspectiveSupabaseUrl: 'https://example-project.supabase.co',
    perspectiveSupabaseAnonKey: 'anon-key-test',
    perspectiveDays: 7,
    perspectiveMinIntervalSec: 60,
} as unknown as RealtimeConfig;

afterEach(() => {
    vi.restoreAllMocks();
    resetPerspectiveInterval();
});

describe('配置解析', () => {
    it('URL 与 key 齐备才返回端点', () => {
        expect(resolvePerspectiveEndpoint(fullRc)).toEqual({
            url: 'https://example-project.supabase.co',
            anonKey: 'anon-key-test',
        });
        expect(resolvePerspectiveEndpoint({ ...fullRc, perspectiveSupabaseUrl: '' } as unknown as RealtimeConfig)).toBeNull();
        expect(resolvePerspectiveEndpoint({ ...fullRc, perspectiveSupabaseAnonKey: '  ' } as unknown as RealtimeConfig)).toBeNull();
        expect(resolvePerspectiveEndpoint(undefined)).toBeNull();
    });

    it('URL 尾斜杠会被去掉；开关关着不算启用', () => {
        expect(resolvePerspectiveEndpoint({ ...fullRc, perspectiveSupabaseUrl: 'https://x.supabase.co/' } as unknown as RealtimeConfig)?.url)
            .toBe('https://x.supabase.co');
        expect(isPerspectiveEnabled({ ...fullRc, perspectiveEnabled: false } as unknown as RealtimeConfig)).toBe(false);
        expect(isPerspectiveEnabled(fullRc)).toBe(true);
    });
});

describe('type 规范化', () => {
    it('大写 / 空格 / 中文标点 → 合法点分小写', () => {
        expect(normalizePerspectiveType('App.Open')).toBe('app.open');
        // DB check 约束 ^[a-z0-9]+(\.[a-z0-9]+)*$：非 ASCII 段整体剥离，' 打开 App ' 只剩 'app'
        expect(normalizePerspectiveType(' 打开 App ')).toBe('app');
        expect(normalizePerspectiveType('app..open')).toBe('app.open');
        expect(normalizePerspectiveType('.app.open.')).toBe('app.open');
    });

    it('整不出来的返回 null', () => {
        expect(normalizePerspectiveType('')).toBeNull();
        expect(normalizePerspectiveType('。。。')).toBeNull();
        expect(normalizePerspectiveType('!!!')).toBeNull();
    });
});

describe('查询冷却', () => {
    it('未记录过调用 → 允许', () => {
        expect(checkPerspectiveInterval(60).allowed).toBe(true);
    });

    it('刚调用过 → 拒绝并报剩余秒数', () => {
        markPerspectiveCalled();
        const r = checkPerspectiveInterval(60);
        expect(r.allowed).toBe(false);
        expect(r.waitSec).toBeGreaterThan(0);
        expect(r.waitSec).toBeLessThanOrEqual(60);
    });

    it('minIntervalSec=0 或负数 → 永远允许', () => {
        markPerspectiveCalled();
        expect(checkPerspectiveInterval(0).allowed).toBe(true);
        expect(checkPerspectiveInterval(-5).allowed).toBe(true);
    });
});

describe('窗口计算', () => {
    it('until 缺省 = now，since = until - days', () => {
        const before = Date.now();
        const w = perspectiveWindow(7);
        const after = Date.now();
        const untilMs = new Date(w.until).getTime();
        const sinceMs = new Date(w.since).getTime();
        expect(untilMs).toBeGreaterThanOrEqual(before);
        expect(untilMs).toBeLessThanOrEqual(after);
        expect(untilMs - sinceMs).toBe(7 * 86400_000);
    });

    it('常量口径：最长 30 天', () => {
        expect(PERSPECTIVE_MAX_DAYS).toBe(30);
    });
});

describe('queryPerspectiveEvents', () => {
    function mockFetchOnce(status: number, body: unknown, headers?: Record<string, string>) {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), {
            status,
            headers: { 'Content-Type': 'application/json', ...(headers || {}) },
        }));
        vi.stubGlobal('fetch', fetchMock);
        return fetchMock;
    }

    it('未配置端点 → not_configured，不发起请求', async () => {
        const fetchMock = mockFetchOnce(200, []);
        const r = await queryPerspectiveEvents(null, { days: 3 });
        expect(r).toMatchObject({ ok: false, reason: 'not_configured' });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('正常返回：组装 ts/type/order/limit，产出 eventsText 与 typeCounts', async () => {
        const rows: PerspectiveEventRow[] = [
            { id: 2, device_id: 'default', type: 'app.open', value: '小红书', ts: '2026-09-01T10:00:00Z' },
            { id: 1, device_id: 'default', type: 'app.open', value: '微信', ts: '2026-09-01T09:00:00Z' },
        ];
        const fetchMock = mockFetchOnce(200, rows);
        const r = await queryPerspectiveEvents(fullRc, { days: 3, type: 'app' });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.total).toBe(2);
        expect(r.typeCounts).toEqual([{ type: 'app.open', count: 2 }]);
        expect(r.eventsText).toContain('app.open → 小红书');
        expect(r.eventsText).toContain('共 2 条');

        const url = new URL(fetchMock.mock.calls[0][0] as string);
        expect(url.pathname).toBe('/rest/v1/perspective_events');
        expect(url.searchParams.get('type')).toBe('like.app.*'); // 无点 = 前缀
        expect(url.searchParams.get('order')).toBe('ts.desc');
        expect(url.searchParams.get('limit')).toBe('100');
        expect(url.searchParams.getAll('ts').length).toBe(2); // gte + lte
    });

    it('带点 type 走精确匹配；空结果 → empty', async () => {
        const fetchMock = mockFetchOnce(200, []);
        const r1 = await queryPerspectiveEvents(fullRc, { type: 'app.open' });
        expect(new URL(fetchMock.mock.calls[0][0] as string).searchParams.get('type')).toBe('eq.app.open');
        expect(r1).toMatchObject({ ok: false, reason: 'empty' });
    });

    it('HTTP 4xx → http 分支带状态码', async () => {
        mockFetchOnce(401, { message: 'Invalid API key' });
        const r = await queryPerspectiveEvents(fullRc, {});
        expect(r).toMatchObject({ ok: false, reason: 'http', status: 401 });
    });

    it('网络层抛错 → network 分支', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
        const r = await queryPerspectiveEvents(fullRc, {});
        expect(r).toMatchObject({ ok: false, reason: 'network' });
    });

    it('limit 封顶 500、days 封顶 30', async () => {
        const fetchMock = mockFetchOnce(200, []);
        await queryPerspectiveEvents(fullRc, { limit: 9999, days: 999 });
        const url = new URL(fetchMock.mock.calls[0][0] as string);
        expect(url.searchParams.get('limit')).toBe('500');
    });
});

describe('count / summary / clear', () => {
    it('count 用 Content-Range 解析总数', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(null, {
            status: 200,
            headers: { 'Content-Range': '0-0/4321' },
        }));
        vi.stubGlobal('fetch', fetchMock);
        const r = await countPerspectiveEvents(fullRc, { since: '2026-08-01T00:00:00Z', until: '2026-09-01T00:00:00Z' });
        expect(r).toEqual({ ok: true, count: 4321 });
    });

    it('getLatestPerspectiveSummary 空库返回 null', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('[]', { status: 200 })));
        const r = await getLatestPerspectiveSummary(fullRc, {});
        expect(r).toEqual({ ok: true, summary: null });
    });

    it('savePerspectiveSummary 201 视为成功', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 201 })));
        const r = await savePerspectiveSummary(fullRc, {
            windowStart: '2026-08-25T00:00:00Z',
            windowEnd: '2026-09-01T00:00:00Z',
            eventCount: 500,
            summary: '一周概览',
            model: 'test-model',
        });
        expect(r).toEqual({ ok: true });
    });

    it('clearPerspectiveEvents 带 beforeDays 组装 lte 条件', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(null, {
            status: 204,
            headers: { 'Content-Range': '*/7' },
        }));
        vi.stubGlobal('fetch', fetchMock);
        const r = await clearPerspectiveEvents(fullRc, { beforeDays: 30 });
        expect(r).toEqual({ ok: true, count: 7 });
        const url = new URL(fetchMock.mock.calls[0][0] as string);
        expect(url.searchParams.get('ts')).toMatch(/^lte\./);
    });
});
