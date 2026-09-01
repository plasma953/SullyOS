/**
 * perspective — 「透视窗」数据层（char 查看用户真实设备操作记录的云端事件日志）
 *
 * 数据面：Supabase PostgREST（perspective_events / perspective_summaries）。
 * 上报侧：OS 层经 utils/perspectiveTelemetry.ts 的 DOM 包装（带节流）调用本文件。
 * 消费侧：agenticTools 的 runPerspectiveQuery（聊天工具），二段总结在
 *         applyAssistantPostProcessing 的 [[PERSPECTIVE_QUERY]] 块里用主聊天 API 完成。
 *
 * 本文件必须环境无关（会被 amsg worker bundle 原样打包跑在服务端）：
 * - 顶层不碰 window / document / localStorage
 * - DOM 相关只在 perspectiveTelemetry.ts 里做
 *
 * 事件 type 约定（与建表 CHECK 一致）：点分小写字母数字，如 app.open / chat.send / char.switch。
 * 无点号查询 = 前缀匹配（app 命中 app.open 等全部 app.*），带点号 = 精确匹配。
 */

import type { RealtimeConfig } from '../types';

// ─── 配置解析 ──────────────────────────────────────────────────────────────

export interface PerspectiveEndpoint {
    url: string;      // https://xxx.supabase.co（无尾斜杠）
    anonKey: string;
}

/** 从 RealtimeConfig 里取透视窗端点；null = 未配置全。 */
export function resolvePerspectiveEndpoint(rc?: Partial<RealtimeConfig> | null): PerspectiveEndpoint | null {
    const url = (rc?.perspectiveSupabaseUrl || '').trim().replace(/\/+$/, '');
    const key = (rc?.perspectiveSupabaseAnonKey || '').trim();
    if (!url || !key) return null;
    return { url, anonKey: key };
}

/** 全局开关 + 端点齐备才算启用。 */
export function isPerspectiveEnabled(rc?: Partial<RealtimeConfig> | null): boolean {
    return !!(rc?.perspectiveEnabled && resolvePerspectiveEndpoint(rc));
}

function restHeaders(ep: PerspectiveEndpoint, prefer?: string): Record<string, string> {
    const h: Record<string, string> = {
        apikey: ep.anonKey,
        Authorization: `Bearer ${ep.anonKey}`,
        'Content-Type': 'application/json',
    };
    if (prefer) h.Prefer = prefer;
    return h;
}

// ─── type 规范化 ────────────────────────────────────────────────────────────

/** 与建表 CHECK 一致：^ [a-z0-9]+(\.[a-z0-9]+)*$ */
const TYPE_RE = /^[a-z0-9]+(\.[a-z0-9]+)*$/;

/** 任意输入 → 合法 type（小写、非法字符转点、去首尾点）；整不成返回 null。 */
export function normalizePerspectiveType(raw: string): string | null {
    const t = (raw || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9.]+/g, '.')
        .replace(/\.{2,}/g, '.')
        .replace(/^\.+|\.+$/g, '');
    return TYPE_RE.test(t) ? t : null;
}

// ─── 上报（裸函数；节流在 perspectiveTelemetry 层）─────────────────────────

export interface ReportEventArgs {
    type: string;
    value?: string | null;
    deviceId?: string;
    /** ISO 时间；缺省用服务端 now()。 */
    ts?: string;
}

export type ReportEventResult =
    | { ok: true }
    | { ok: false; reason: 'not_configured' | 'invalid_type' | 'http' | 'network'; status?: number; message?: string };

/** 写入单条事件。网络层抛异常，HTTP 层错误以结果返回。 */
export async function reportPerspectiveEvent(
    rc: Partial<RealtimeConfig> | null | undefined,
    args: ReportEventArgs,
): Promise<ReportEventResult> {
    const ep = resolvePerspectiveEndpoint(rc);
    if (!ep) return { ok: false, reason: 'not_configured' };
    const type = normalizePerspectiveType(args.type);
    if (!type) return { ok: false, reason: 'invalid_type', message: args.type };
    const payload: Record<string, unknown> = {
        device_id: args.deviceId || 'default',
        type,
    };
    if (args.value != null && args.value !== '') payload.value = args.value;
    if (args.ts) payload.ts = args.ts;
    try {
        const res = await fetch(`${ep.url}/rest/v1/perspective_events`, {
            method: 'POST',
            headers: restHeaders(ep, 'return=minimal'),
            body: JSON.stringify(payload),
        });
        if (res.status === 201 || res.status === 204) return { ok: true };
        let message = '';
        try { const j = await res.json(); message = j?.message || ''; } catch { /* body 可能不是 JSON */ }
        return { ok: false, reason: 'http', status: res.status, message };
    } catch (e: any) {
        return { ok: false, reason: 'network', message: e?.message };
    }
}

// ─── 查询 ──────────────────────────────────────────────────────────────────

export const PERSPECTIVE_MAX_DAYS = 30;
export const PERSPECTIVE_MAX_LIMIT = 500;
export const PERSPECTIVE_DEFAULT_LIMIT = 100;

export interface PerspectiveEventRow {
    id: number;
    device_id: string;
    type: string;
    value: string | null;
    ts: string;
}

export interface QueryEventsArgs {
    /** 近 N 天（默认 7，封顶 30）。since 给出时忽略。 */
    days?: number;
    since?: string;
    until?: string;
    /** 无点 = 前缀匹配；有点 = 精确。 */
    type?: string;
    deviceId?: string;
    limit?: number;
    order?: 'asc' | 'desc';
}

export type QueryEventsResult =
    | {
        ok: true;
        since: string;
        until: string;
        total: number;
        events: PerspectiveEventRow[];
        /** 给 char 直读的人话时间线（含按 type 计数尾注）。 */
        eventsText: string;
        typeCounts: Array<{ type: string; count: number }>;
    }
    | { ok: false; reason: 'not_configured' | 'http' | 'network' | 'empty'; status?: number; message?: string };

export async function queryPerspectiveEvents(
    rc: Partial<RealtimeConfig> | null | undefined,
    args: QueryEventsArgs,
): Promise<QueryEventsResult> {
    const ep = resolvePerspectiveEndpoint(rc);
    if (!ep) return { ok: false, reason: 'not_configured' };

    const days = Math.min(Math.max(args.days ?? 7, 0.001), PERSPECTIVE_MAX_DAYS);
    const until = args.until || new Date().toISOString();
    const since = args.since || new Date(new Date(until).getTime() - days * 86400_000).toISOString();
    const limit = Math.min(Math.max(args.limit ?? PERSPECTIVE_DEFAULT_LIMIT, 1), PERSPECTIVE_MAX_LIMIT);
    const order = args.order === 'asc' ? 'asc' : 'desc';

    const params = new URLSearchParams();
    params.set('select', 'id,device_id,type,value,ts');
    params.append('ts', `gte.${since}`);
    params.append('ts', `lte.${until}`);
    if (args.type && args.type.trim()) {
        const t = normalizePerspectiveType(args.type);
        if (!t) return { ok: false, reason: 'http', status: 400, message: `invalid type: ${args.type}` };
        // 无点 = 前缀（like app.*），有点 = 精确
        if (t.includes('.')) params.set('type', `eq.${t}`);
        else params.set('type', `like.${t}.*`);
    }
    if (args.deviceId && args.deviceId.trim()) params.set('device_id', `eq.${args.deviceId.trim()}`);
    params.set('order', `ts.${order}`);
    params.set('limit', String(limit));

    try {
        const res = await fetch(`${ep.url}/rest/v1/perspective_events?${params.toString()}`, {
            method: 'GET',
            headers: restHeaders(ep),
        });
        if (!res.ok) {
            let message = '';
            try { const j = await res.json(); message = j?.message || ''; } catch { /* noop */ }
            return { ok: false, reason: 'http', status: res.status, message };
        }
        const rows = (await res.json()) as PerspectiveEventRow[];
        if (!Array.isArray(rows) || rows.length === 0) {
            return { ok: false, reason: 'empty', message: '窗口内没有事件记录' };
        }
        const counts = new Map<string, number>();
        for (const r of rows) counts.set(r.type, (counts.get(r.type) || 0) + 1);
        const typeCounts = Array.from(counts.entries())
            .map(([type, count]) => ({ type, count }))
            .sort((a, b) => b.count - a.count);
        return {
            ok: true,
            since,
            until,
            total: rows.length,
            events: rows,
            eventsText: buildEventsText(rows, typeCounts),
            typeCounts,
        };
    } catch (e: any) {
        return { ok: false, reason: 'network', message: e?.message };
    }
}

/** 本地时间「M月d日 HH:mm」——不引依赖，够 char 读。 */
function fmtLocal(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function buildEventsText(rows: PerspectiveEventRow[], typeCounts: Array<{ type: string; count: number }>): string {
    const lines = rows.map((r) => {
        const v = r.value ? ` → ${r.value}` : '';
        return `[${fmtLocal(r.ts)}] ${r.type}${v}`;
    });
    const summary = typeCounts.map((t) => `${t.type}×${t.count}`).join('、');
    return `${lines.join('\n')}\n\n（共 ${rows.length} 条：${summary}）`;
}

// ─── 总结缓存（perspective_summaries）───────────────────────────────────────

export interface PerspectiveSummaryRow {
    id: number;
    device_id: string;
    window_start: string;
    window_end: string;
    event_count: number;
    summary: string;
    model: string;
    created_at: string | null;
}

/** 窗口内事件总数（head=true 只拿 Content-Range，不拉行）。 */
export async function countPerspectiveEvents(
    rc: Partial<RealtimeConfig> | null | undefined,
    args: { since: string; until: string; deviceId?: string },
): Promise<{ ok: true; count: number } | { ok: false; reason: 'not_configured' | 'http' | 'network'; status?: number; message?: string }> {
    const ep = resolvePerspectiveEndpoint(rc);
    if (!ep) return { ok: false, reason: 'not_configured' };
    const params = new URLSearchParams();
    params.set('select', 'id');
    params.append('ts', `gte.${args.since}`);
    params.append('ts', `lte.${args.until}`);
    if (args.deviceId && args.deviceId.trim()) params.set('device_id', `eq.${args.deviceId.trim()}`);
    try {
        const res = await fetch(`${ep.url}/rest/v1/perspective_events?${params.toString()}`, {
            method: 'GET',
            headers: { ...restHeaders(ep), Prefer: 'count=exact', Range: '0-0' },
        });
        if (!res.ok) return { ok: false, reason: 'http', status: res.status };
        const range = res.headers.get('content-range') || '';
        const m = range.match(/\/(\d+)$/);
        return { ok: true, count: m ? parseInt(m[1], 10) : 0 };
    } catch (e: any) {
        return { ok: false, reason: 'network', message: e?.message };
    }
}

/** 窗口结束时间晚于 until 的最近一条总结（可复用即命中）。 */
export async function getLatestPerspectiveSummary(
    rc: Partial<RealtimeConfig> | null | undefined,
    args: { deviceId?: string; until?: string; windowDays?: number },
): Promise<{ ok: true; summary: PerspectiveSummaryRow | null } | { ok: false; reason: 'not_configured' | 'http' | 'network'; status?: number; message?: string }> {
    const ep = resolvePerspectiveEndpoint(rc);
    if (!ep) return { ok: false, reason: 'not_configured' };
    const params = new URLSearchParams();
    params.set('select', 'id,device_id,window_start,window_end,event_count,summary,model,created_at');
    params.set('order', 'window_end.desc');
    params.set('limit', '1');
    if (args.deviceId && args.deviceId.trim()) params.set('device_id', `eq.${args.deviceId.trim()}`);
    if (args.until) params.set('window_end', `gte.${args.until}`);
    try {
        const res = await fetch(`${ep.url}/rest/v1/perspective_summaries?${params.toString()}`, {
            method: 'GET',
            headers: restHeaders(ep),
        });
        if (!res.ok) return { ok: false, reason: 'http', status: res.status };
        const rows = (await res.json()) as PerspectiveSummaryRow[];
        return { ok: true, summary: Array.isArray(rows) && rows.length ? rows[0] : null };
    } catch (e: any) {
        return { ok: false, reason: 'network', message: e?.message };
    }
}

export async function savePerspectiveSummary(
    rc: Partial<RealtimeConfig> | null | undefined,
    args: { deviceId?: string; windowStart: string; windowEnd: string; eventCount: number; summary: string; model: string },
): Promise<{ ok: true } | { ok: false; reason: 'not_configured' | 'http' | 'network'; status?: number; message?: string }> {
    const ep = resolvePerspectiveEndpoint(rc);
    if (!ep) return { ok: false, reason: 'not_configured' };
    try {
        const res = await fetch(`${ep.url}/rest/v1/perspective_summaries`, {
            method: 'POST',
            headers: restHeaders(ep, 'return=minimal'),
            body: JSON.stringify({
                device_id: args.deviceId || 'default',
                window_start: args.windowStart,
                window_end: args.windowEnd,
                event_count: args.eventCount,
                summary: args.summary,
                model: args.model,
            }),
        });
        if (res.status === 201 || res.status === 204) return { ok: true };
        let message = '';
        try { const j = await res.json(); message = j?.message || ''; } catch { /* noop */ }
        return { ok: false, reason: 'http', status: res.status, message };
    } catch (e: any) {
        return { ok: false, reason: 'network', message: e?.message };
    }
}

// ─── 窗口工具（天数上限从配置读，调用方兜底）───────────────────────────────

/** 计算「近 N 天」窗口的 [since, until]（until = now）。 */
export function perspectiveWindow(days: number, until?: string): { since: string; until: string } {
    const untilIso = until || new Date().toISOString();
    const since = new Date(new Date(untilIso).getTime() - Math.max(days, 0.001) * 86400_000).toISOString();
    return { since, until: untilIso };
}

// ─── 查询侧冷却（模块级状态；浏览器与 worker 各自持有，语义均为「同实例内的节流」）───

let lastPerspectiveQueryAt = 0;

/** 距上次调用是否已满 minIntervalSec；未满返回还需等待的秒数。 */
export function checkPerspectiveInterval(minIntervalSec: number): { allowed: boolean; waitSec: number } {
    const min = Math.max(minIntervalSec || 0, 0) * 1000;
    if (min <= 0) return { allowed: true, waitSec: 0 };
    const waitMs = lastPerspectiveQueryAt + min - Date.now();
    return waitMs > 0 ? { allowed: false, waitSec: Math.ceil(waitMs / 1000) } : { allowed: true, waitSec: 0 };
}

/** 记录一次调用时刻（在通过冷却检查后调用）。 */
export function markPerspectiveCalled(): void {
    lastPerspectiveQueryAt = Date.now();
}

/** 测试用：清空冷却状态。 */
export function resetPerspectiveInterval(): void {
    lastPerspectiveQueryAt = 0;
}

/** 清空事件（设置页「清空记录」按钮用）。beforeDays 缺省 = 清全部。 */
export async function clearPerspectiveEvents(
    rc: Partial<RealtimeConfig> | null | undefined,
    args: { beforeDays?: number; deviceId?: string },
): Promise<{ ok: true; count: number } | { ok: false; reason: 'not_configured' | 'http' | 'network'; status?: number; message?: string }> {
    const ep = resolvePerspectiveEndpoint(rc);
    if (!ep) return { ok: false, reason: 'not_configured' };
    const params = new URLSearchParams();
    if (args.beforeDays && args.beforeDays > 0) {
        params.set('ts', `lte.${new Date(Date.now() - args.beforeDays * 86400_000).toISOString()}`);
    }
    if (args.deviceId && args.deviceId.trim()) params.set('device_id', `eq.${args.deviceId.trim()}`);
    const qs = params.toString();
    try {
        const res = await fetch(`${ep.url}/rest/v1/perspective_events${qs ? `?${qs}` : ''}`, {
            method: 'DELETE',
            headers: { ...restHeaders(ep), Prefer: 'count=exact' },
        });
        if (!res.ok) return { ok: false, reason: 'http', status: res.status };
        const range = res.headers.get('content-range') || '';
        const m = range.match(/\/(\d+)$/);
        return { ok: true, count: m ? parseInt(m[1], 10) : 0 };
    } catch (e: any) {
        return { ok: false, reason: 'network', message: e?.message };
    }
}

// ─── 摘要统计（特殊点检测；供工具层直接给 char 或经副 API 总结）────────────

export interface PerspectiveDigest {
    text: string;
    specialties: string[];
}

/**
 * 从原始事件行提炼「特殊情况」：深夜活跃、最高频行为、单日峰值、分时直方图。
 * 小时数取本机时区（worker 端为 UTC——两边都只是展示口径，不影响存储）。
 */
export function buildPerspectiveDigest(rows: PerspectiveEventRow[], windowDays: number): PerspectiveDigest {
    if (!rows.length) return { text: '', specialties: [] };
    const specialties: string[] = [];
    const counts = new Map<string, number>();
    const hourBuckets: number[] = new Array(24).fill(0);
    const dayBuckets = new Map<string, number>();
    for (const r of rows) {
        counts.set(r.type, (counts.get(r.type) || 0) + 1);
        const d = new Date(r.ts);
        if (!Number.isNaN(d.getTime())) {
            hourBuckets[d.getHours()]++;
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            dayBuckets.set(key, (dayBuckets.get(key) || 0) + 1);
        }
    }
    const total = rows.length;
    // 深夜活跃（0-5 点占比 > 15% 且至少 3 条）
    const nightCount = hourBuckets.slice(0, 6).reduce((a, b) => a + b, 0);
    if (nightCount >= 3 && nightCount / total > 0.15) {
        specialties.push(`深夜时段（0-5点）有 ${nightCount} 条操作，占 ${Math.round((nightCount / total) * 100)}%`);
    }
    // 最高频行为
    const topType = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0];
    if (topType && topType[1] >= 3) {
        specialties.push(`最高频行为是「${topType[0]}」（${topType[1]} 次，占 ${Math.round((topType[1] / total) * 100)}%）`);
    }
    // 单日峰值
    let peakDay = '';
    let peakCount = 0;
    for (const [k, v] of dayBuckets) {
        if (v > peakCount) { peakCount = v; peakDay = k; }
    }
    if (peakDay && peakCount >= 5) specialties.push(`单日峰值在 ${peakDay}（${peakCount} 条）`);
    // 分时直方图（紧凑：只列有活动的时段）
    const histMax = Math.max(...hourBuckets, 1);
    const hist = hourBuckets
        .map((c, h) => (c ? `${String(h).padStart(2, '0')}时${'#'.repeat(Math.max(1, Math.round((c / histMax) * 8)))}(${c})` : ''))
        .filter(Boolean)
        .join(' ');
    const lines = [
        `统计窗口：近 ${windowDays} 天，共 ${total} 条事件`,
        ...specialties.map((s) => `· ${s}`),
        hist ? `分时分布：${hist}` : '',
    ].filter(Boolean);
    return { text: lines.join('\n'), specialties };
}
