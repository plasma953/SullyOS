/**
 * 系统状态面板 —— 常驻展示组件。
 *
 * 设置页顶部的非弹窗区块：状态灯卡片组，所有后端功能的存在性/有效性一目了然。
 * 结果缓存 localStorage（60 秒内复用，跨进设置页不闪灰），「重新探测」按钮手动强刷。
 * 探测逻辑见 utils/statusPanel.ts。
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ArrowClockwise } from '@phosphor-icons/react';
import type { APIConfig } from '../types';
import { probeAllStatus, type StatusEntry, type BridgeProbeStatus } from '../utils/statusPanel';

const CACHE_KEY = 'status_panel_cache_v1';
const CACHE_TTL_MS = 60 * 1000;

const STATUS_STYLES: Record<BridgeProbeStatus, { dot: string; text: string }> = {
    ok: { dot: 'bg-emerald-500', text: 'text-emerald-600' },
    warn: { dot: 'bg-amber-500', text: 'text-amber-600' },
    err: { dot: 'bg-red-500', text: 'text-red-600' },
    off: { dot: 'bg-slate-300', text: 'text-slate-400' },
    checking: { dot: 'bg-slate-400 animate-pulse', text: 'text-slate-400' },
};

interface CachedPayload {
    at: number;
    entries: StatusEntry[];
}

const readCache = (): CachedPayload | null => {
    try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as CachedPayload;
        if (!parsed || typeof parsed.at !== 'number' || !Array.isArray(parsed.entries)) return null;
        return parsed;
    } catch {
        return null;
    }
};

interface StatusPanelProps {
    apiConfig: APIConfig;
    /** 嵌在 SettingsSection 里时的标题。 */
    title?: string;
}

const StatusPanel: React.FC<StatusPanelProps> = ({ apiConfig, title }) => {
    const label = title || '系统状态';
    const [entries, setEntries] = useState<StatusEntry[] | null>(null);
    const [checking, setChecking] = useState(false);
    const mounted = useRef(true);

    const runProbe = useCallback(async (force: boolean) => {
        if (!force) {
            const cached = readCache();
            if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
                setEntries(cached.entries);
                return;
            }
        }
        setChecking(true);
        try {
            const result = await probeAllStatus(apiConfig);
            if (!mounted.current) return;
            setEntries(result);
            try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), entries: result })); } catch { /* 存储满就算了 */ }
        } finally {
            if (mounted.current) setChecking(false);
        }
    }, [apiConfig]);

    useEffect(() => {
        mounted.current = true;
        runProbe(false);
        // 60 秒静默刷新：面板常驻时自动保持新鲜。
        const timer = setInterval(() => { runProbe(true); }, CACHE_TTL_MS);
        return () => { mounted.current = false; clearInterval(timer); };
    }, [runProbe]);

    return (
        <div>
            <div className="flex items-center gap-2 mb-3">
                <h3 className="text-sm font-bold text-slate-700">{label}</h3>
                <button
                    onClick={() => runProbe(true)}
                    disabled={checking}
                    className="ml-auto p-1.5 rounded-full hover:bg-slate-200/70 active:scale-90 transition-transform disabled:opacity-40"
                    title="重新探测"
                >
                    <ArrowClockwise size={15} weight="bold" className={`text-slate-500 ${checking ? 'animate-spin' : ''}`} />
                </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
                {(entries ?? []).map((e) => {
                    const st = STATUS_STYLES[e.status] || STATUS_STYLES.off;
                    return (
                        <div
                            key={e.key}
                            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/60 backdrop-blur border border-white/50"
                        >
                            <span className={`shrink-0 w-2 h-2 rounded-full ${st.dot}`} />
                            <span className="text-xs font-semibold text-slate-700 truncate">{e.label}</span>
                            {e.detail ? (
                                <span className={`ml-auto text-[10px] ${st.text} truncate max-w-[45%]`} title={e.detail}>
                                    {e.detail}
                                </span>
                            ) : null}
                        </div>
                    );
                })}
                {entries === null ? (
                    <>
                        {[0, 1, 2, 3].map((i) => (
                            <div key={i} className="h-9 rounded-xl bg-white/40 border border-white/40 animate-pulse" />
                        ))}
                    </>
                ) : null}
            </div>
            {entries !== null && entries.length === 0 ? (
                <p className="text-xs text-slate-400">暂无可探测条目</p>
            ) : null}
        </div>
    );
};

export default StatusPanel;
