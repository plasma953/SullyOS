/**
 * perspectiveTelemetry — 透视窗埋点层（DOM 侧包装）
 *
 * 上报内容只有「用户在 SullyOS 里做了什么操作」（打开哪个 App、发了消息、切了角色），
 * 不含任何聊天内容 / 角色设定 / API 配置。事件进 Supabase perspective_events，
 * 供 char 通过 [[PERSPECTIVE_QUERY]] 工具查看（「透视窗」功能）。
 *
 * 节流：同 type 事件 2 秒内合并（保留首次 value），防连点打爆。
 * 开关：realtimeConfig.perspectiveEnabled + 端点齐备才发；OSContext 持有配置，
 *       这里用 setPerspectiveTelemetryRuntime 注入，保持本文件不直接 import React 上下文。
 *
 * 环境无关部分（type 规范化 / 上报 fetch）在 utils/perspective.ts。
 */

import { reportPerspectiveEvent } from './perspective';
import type { RealtimeConfig } from '../types';

const MERGE_WINDOW_MS = 2000;

export interface PerspectiveTelemetryRuntime {
    getConfig: () => RealtimeConfig | undefined;
    /** 设备标识；缺省 'default'。 */
    getDeviceId?: () => string | undefined;
}

let runtime: PerspectiveTelemetryRuntime | null = null;

/** OSContext 挂载后注入；避免本模块依赖 React。 */
export function setPerspectiveTelemetryRuntime(rt: PerspectiveTelemetryRuntime | null): void {
    runtime = rt;
}

// ─── 合并节流（按 type 键控，窗口内只发首条）─────────────────────────────────

const pendingByKey = new Map<string, { type: string; value: string | null; timer: ReturnType<typeof setTimeout> }>();

function flush(key: string): void {
    const item = pendingByKey.get(key);
    if (!item) return;
    pendingByKey.delete(key);
    clearTimeout(item.timer);
    void report(item.type, item.value, true);
}

/** 带节流的上报入口（OS 层埋点唯一入口）。 */
export function emitPerspectiveEvent(type: string, value?: string | null): void {
    const key = type;
    if (pendingByKey.has(key)) {
        // 窗口内重复事件：更新 value 为最新（保留首次触发时间），不重排 timer。
        const item = pendingByKey.get(key)!;
        item.value = value ?? null;
        return;
    }
    const timer = setTimeout(() => flush(key), MERGE_WINDOW_MS);
    pendingByKey.set(key, { type, value: value ?? null, timer });
}

async function report(type: string, value: string | null, flushed = false): Promise<void> {
    const cfg = runtime?.getConfig();
    if (!cfg) return;
    try {
        await reportPerspectiveEvent(cfg, {
            type,
            value,
            deviceId: runtime?.getDeviceId?.() || 'default',
        });
        if (!flushed) { /* 成功与否对 UI 无感，失败仅 console */ }
    } catch { /* 网络层异常静默：埋点永不影响主流程 */ }
}

// ─── 生命周期埋点（初始化时挂一次）─────────────────────────────────────────

let lifecycleInstalled = false;

/** 探测运行设备形态（给 char 读的 value，只写 ios/android/desktop）。 */
export function detectDevicePlatform(): string {
    try {
        const ua = navigator.userAgent || '';
        if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
        if (/android/i.test(ua)) return 'android';
        return 'desktop';
    } catch { return 'unknown'; }
}

/**
 * 挂页面生命周期埋点：会话开始 / 回到前台。幂等，多次调用只装一次。
 * 在 OSContext 首次挂载时调用。
 */
export function installPerspectiveLifecycle(): void {
    if (lifecycleInstalled || typeof window === 'undefined') return;
    lifecycleInstalled = true;
    try {
        emitPerspectiveEvent('os.session_start', detectDevicePlatform());
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                emitPerspectiveEvent('os.session_resume', detectDevicePlatform());
            }
        });
    } catch { /* SSR / 受限环境静默 */ }
}
