/**
 * 系统状态面板 —— 探测层。
 *
 * 逐项探测各后端功能的存在性 / 连通性，给设置页顶部的常驻状态面板
 * （components/StatusPanel.tsx）消费。全部条目独立 try/catch + 超时控制，
 * 单项挂了不拖累整块；结果在调用方缓存，60 秒静默刷新。
 *
 * 状态口径：
 *   ok      绿 —— 在且连通
 *   warn    琥珀 —— 在，但配置不完整 / 行为异常
 *   err     红 —— 配了但不可达
 *   off     灰 —— 未启用（合法状态，不是错误）
 *   checking 脉冲 —— 探测中
 */
import type { APIConfig, BridgeConfig } from '../types';
import { DB } from './db';
import { ActiveMsgStore } from './activeMsgStore';

export type BridgeProbeStatus = 'ok' | 'warn' | 'err' | 'off' | 'checking';

export interface StatusEntry {
    key: string;
    label: string;
    status: BridgeProbeStatus;
    /** 一句话说明（如「47ms」「HTTP 403」「未启用」）。 */
    detail?: string;
}

/** 带超时的 fetch（AbortController）。 */
const fetchWithTimeout = async (url: string, ms: number, headers?: Record<string, string>): Promise<Response> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
        return await fetch(url, { signal: ctrl.signal, headers });
    } finally {
        clearTimeout(timer);
    }
};

/** 毫秒数 → 「xxx ms」，探测耗时展示。 */
const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`);

/** 提取 JSON 错误体里的 message 字段（主代理 /agent/v1 的 4xx 都带）。 */
const errMessage = (body: unknown): string | undefined => {
    if (!body || typeof body !== 'object') return undefined;
    const m = (body as Record<string, unknown>).message;
    return typeof m === 'string' ? m : undefined;
};

/**
 * 主代理中转：`GET {agentUrl}/agent/v1/health`；4xx 说明服务在、是鉴权/参数口径问题 → warn。
 */
export const probeAgent = async (apiConfig: APIConfig): Promise<StatusEntry> => {
    const entry: StatusEntry = { key: 'agent', label: '主代理中转', status: 'off', detail: '未配置' };
    const base = (apiConfig.agentUrl || '').replace(/\/+$/, '');
    if (!base) return entry;
    const t0 = performance.now();
    try {
        const res = await fetchWithTimeout(`${base}/agent/v1/health`, 5000);
        const ms = fmtMs(performance.now() - t0);
        if (res.ok) {
            return { key: 'agent', label: '主代理中转', status: 'ok', detail: ms };
        }
        if (res.status < 500) {
            let body: unknown = null;
            try { body = await res.json(); } catch { /* body 可能不是 JSON */ }
            const msg = errMessage(body);
            return { key: 'agent', label: '主代理中转', status: 'warn', detail: `HTTP ${res.status}${msg ? ' · ' + msg : ''}` };
        }
        return { key: 'agent', label: '主代理中转', status: 'err', detail: `HTTP ${res.status}` };
    } catch (e: any) {
        return { key: 'agent', label: '主代理中转', status: 'err', detail: e?.name === 'AbortError' ? '超时' : '不可达' };
    }
};

/**
 * 外部连接桥：`GET {url}{healthPath}`，3 秒超时。
 * 默认 path 是 `/`：只要域名活着就算连通；对方有专用健康端点时用户自填。
 */
export const probeBridge = async (bridge?: BridgeConfig): Promise<StatusEntry> => {
    const entry: StatusEntry = { key: 'bridge', label: '外部连接桥', status: 'off', detail: '未启用' };
    if (!bridge?.enabled || !bridge.url) return entry;
    const base = bridge.url.replace(/\/+$/, '');
    const path = bridge.healthPath || '/';
    const t0 = performance.now();
    try {
        const headers: Record<string, string> = {};
        if (bridge.token) headers['Authorization'] = `Bearer ${bridge.token}`;
        const res = await fetchWithTimeout(`${base}${path.startsWith('/') ? path : '/' + path}`, 3000, headers);
        const ms = fmtMs(performance.now() - t0);
        if (res.ok) return { key: 'bridge', label: '外部连接桥', status: 'ok', detail: ms };
        if (res.status < 500) return { key: 'bridge', label: '外部连接桥', status: 'warn', detail: `HTTP ${res.status}` };
        return { key: 'bridge', label: '外部连接桥', status: 'err', detail: `HTTP ${res.status}` };
    } catch (e: any) {
        return { key: 'bridge', label: '外部连接桥', status: 'err', detail: e?.name === 'AbortError' ? '超时' : '不可达' };
    }
};

/**
 * 主动消息 2.0（AMSG worker）：配置在 amsg2GlobalConfig（activeMsgStore），按角色开关。
 * 这里只探 worker 地址可达性；任务细节看 ActiveMsg2 面板。
 */
export const probeAmsgWorker = async (_apiConfig: APIConfig): Promise<StatusEntry> => {
    const entry: StatusEntry = { key: 'amsg', label: '主动消息 worker', status: 'off', detail: '未配置' };
    try {
        const cfg = await ActiveMsgStore.getGlobalConfig();
        if (!cfg || !cfg.workerUrl) return entry;
        const base = cfg.workerUrl.replace(/\/+$/, '');
        const t0 = performance.now();
        const res = await fetchWithTimeout(`${base}/health`, 5000);
        const ms = fmtMs(performance.now() - t0);
        if (res.ok) return { key: 'amsg', label: '主动消息 worker', status: 'ok', detail: ms };
        if (res.status < 500) return { key: 'amsg', label: '主动消息 worker', status: 'warn', detail: `HTTP ${res.status}` };
        return { key: 'amsg', label: '主动消息 worker', status: 'err', detail: `HTTP ${res.status}` };
    } catch (e: any) {
        return { key: 'amsg', label: '主动消息 worker', status: 'err', detail: e?.name === 'AbortError' ? '超时' : '不可达' };
    }
};

/** 本地日 key（与 dailySchedule 同口径的简化版，避免引入时区依赖）。 */
const getLocalDateKeySafe = (): string => {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/**
 * 日程忙碌检测：本地能力，今天的日程存在即 ok；日程还没生成是 off。零网络依赖。
 */
export const probeBusy = async (): Promise<StatusEntry> => {
    try {
        const chars = await DB.getAllCharacters();
        if (!chars || chars.length === 0) {
            return { key: 'busy', label: '日程忙碌检测', status: 'off', detail: '无角色' };
        }
        let withSchedule = 0;
        let busyNow = 0;
        const now = new Date();
        for (const c of chars) {
            const sched = await DB.getDailySchedule(c.id, getLocalDateKeySafe());
            if (sched && sched.slots && sched.slots.length) {
                withSchedule++;
                const minutes = now.getHours() * 60 + now.getMinutes();
                for (let i = sched.slots.length - 1; i >= 0; i--) {
                    const parts = (sched.slots[i].startTime || '').split(':').map(Number);
                    const h = parts[0], m = parts[1];
                    if (Number.isFinite(h) && Number.isFinite(m) && minutes >= h * 60 + m) {
                        if (sched.slots[i].busy) busyNow++;
                        break;
                    }
                }
            }
        }
        if (withSchedule === 0) {
            return { key: 'busy', label: '日程忙碌检测', status: 'off', detail: '今日无日程' };
        }
        return {
            key: 'busy', label: '日程忙碌检测', status: 'ok',
            detail: busyNow > 0 ? `${busyNow} 个角色忙` : `${withSchedule} 份日程`,
        };
    } catch {
        return { key: 'busy', label: '日程忙碌检测', status: 'err', detail: '读取失败' };
    }
};

/**
 * 提示词预设：本地 store 有启用条目即 ok；没有条目是 off（不是错误）。
 */
export const probePresets = async (): Promise<StatusEntry> => {
    try {
        const rows = await DB.getPromptPresets();
        const enabled = rows.filter((p) => p.enabled && (p.content || '').trim()).length;
        if (rows.length === 0) return { key: 'presets', label: '提示词预设', status: 'off', detail: '无预设' };
        return { key: 'presets', label: '提示词预设', status: 'ok', detail: `${enabled}/${rows.length} 启用` };
    } catch {
        return { key: 'presets', label: '提示词预设', status: 'err', detail: '读取失败' };
    }
};

/** 全量探测（并行、互不拖累）。设置页状态面板的唯一入口。 */
export const probeAllStatus = async (apiConfig: APIConfig): Promise<StatusEntry[]> => {
    const tasks: Array<Promise<StatusEntry>> = [
        probeAgent(apiConfig),
        probeAmsgWorker(apiConfig),
        probeBusy(),
        probePresets(),
        probeBridge(apiConfig.bridge),
    ];
    const settled = await Promise.allSettled(tasks);
    return settled.map((r) => r.status === 'fulfilled'
        ? r.value
        : { key: 'unknown', label: '探测失败', status: 'err' as const });
};
