import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Broom, X } from '@phosphor-icons/react';
import { getMcpResultList, clearMcpResults, type McpResultEntry } from '../../utils/mcpResultMemory';

/**
 * McpMemoryModal — 聊天页「MCP 记忆」弹窗。
 *
 * 展示当前角色留档的 MCP 工具调用结果：
 * · 近期窗口条目（最近 N 轮，随轮次自动滚动淘汰）
 * · 手册类长期条目（长期保存，直到在这里手动清空）
 *
 * 清空范围二选一：只清手册类长期结果 / 全部清空（含近期窗口）。
 * 与 VoiceFavoritesPortal 同款全屏 portal 风格。
 */
interface McpMemoryModalProps {
    charId: string;
    charName?: string;
    onClose: () => void;
}

type FilterTab = 'all' | 'manual';

const timeFormatter = new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
});

const McpMemoryModal: React.FC<McpMemoryModalProps> = ({ charId, charName, onClose }) => {
    const [tab, setTab] = useState<FilterTab>('all');
    // 二次确认：'manual' = 清手册类，'all' = 全部清空；null = 未在确认中
    const [confirming, setConfirming] = useState<null | 'manual' | 'all'>(null);
    const [entries, setEntries] = useState<McpResultEntry[]>(() => getMcpResultList(charId));

    const reload = () => setEntries(getMcpResultList(charId));
    const persistentCount = entries.filter(e => e.persistent).length;
    const recentCount = entries.length - persistentCount;

    const visible = useMemo(
        () => (tab === 'manual' ? entries.filter(e => e.persistent) : entries),
        [entries, tab],
    );

    const doClear = (scope: 'manual' | 'all') => {
        clearMcpResults(charId, scope);
        setConfirming(null);
        reload();
    };

    const portal = (
        <div className="mcp-memory-root">
            <style>{`
                .mcp-memory-root { position: fixed; inset: 0; z-index: 1650; overflow: hidden; color: #172033; background: #f4f1eb; font-family: ui-sans-serif, system-ui, -apple-system, "PingFang SC", sans-serif; animation: mcpMemEnter .22s ease-out both; }
                .mcp-memory-shell { height: 100%; max-width: 760px; margin: 0 auto; display: flex; flex-direction: column; }
                .mcp-memory-list { scrollbar-width: none; }
                .mcp-memory-list::-webkit-scrollbar { display: none; }
                .mcp-memory-row { animation: mcpMemRowEnter .18s ease both; }
                @keyframes mcpMemEnter { from { opacity: 0; } to { opacity: 1; } }
                @keyframes mcpMemRowEnter { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
                @media (prefers-reduced-motion: reduce) { .mcp-memory-root, .mcp-memory-row { animation: none !important; } }
            `}</style>
            <div className="mcp-memory-shell px-4 sm:px-7">
                <header className="shrink-0 pt-[max(16px,env(safe-area-inset-top))] pb-3 border-b border-slate-900/10">
                    <div className="flex items-center justify-between gap-4 h-12">
                        <button type="button" onClick={onClose} className="w-10 h-10 -ml-1 grid place-items-center rounded-full text-slate-600 active:bg-black/5" aria-label="关闭 MCP 记忆">
                            <X size={21} weight="bold" />
                        </button>
                        <div className="min-w-0 text-center">
                            <h1 className="text-[17px] font-bold tracking-[.12em]">MCP 记忆</h1>
                            <p className="mt-0.5 text-[10px] text-slate-500">{charName ? `${charName} · ` : ''}近期 {recentCount} 条 · 长期 {persistentCount} 条</p>
                        </div>
                        <Broom size={20} weight="fill" className="w-10 text-violet-500" />
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                        {([
                            { v: 'all', label: `全部 (${entries.length})` },
                            { v: 'manual', label: `长期手册 (${persistentCount})` },
                        ] as const).map(t => (
                            <button
                                key={t.v}
                                type="button"
                                onClick={() => setTab(t.v)}
                                className={`px-3 py-1.5 rounded-full text-xs font-bold transition-colors ${tab === t.v ? 'bg-violet-500 text-white' : 'bg-white/70 border border-slate-900/10 text-slate-500'}`}
                            >{t.label}</button>
                        ))}
                    </div>
                </header>
                <main className="mcp-memory-list flex-1 min-h-0 overflow-y-auto py-3 space-y-2">
                    {visible.length === 0 ? (
                        <div className="h-full min-h-64 grid place-items-center text-center px-8">
                            <div>
                                <Broom size={34} className="mx-auto text-slate-300" />
                                <p className="mt-4 text-sm font-bold text-slate-500">{tab === 'manual' ? '没有长期保存的手册类结果' : '还没有工具调用记录'}</p>
                                <p className="mt-1.5 text-xs leading-5 text-slate-400">
                                    {tab === 'all'
                                        ? '角色调用 MCP 工具后，结果会按轮次留档在这里，下一轮直接复用、不再重复调用。'
                                        : '在设置 → MCP 工具服务器里把某个服务器的「结果长期保存」设为「总是」，或让智能判定自动识别手册/指南/帮助/文档类工具。'}
                                </p>
                            </div>
                        </div>
                    ) : visible.map(e => (
                        <div key={e.id} className="mcp-memory-row bg-white/70 border border-slate-900/10 rounded-2xl px-3.5 py-3 space-y-1.5">
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-xs font-bold text-slate-700 truncate">{e.serverName} · {e.toolName}</span>
                                {e.persistent ? (
                                    <span className="text-[9px] font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">长期</span>
                                ) : (
                                    <span className="text-[9px] font-bold bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded-full">第 {e.turnId} 轮</span>
                                )}
                                <span className="ml-auto text-[10px] text-slate-400 shrink-0">{timeFormatter.format(new Date(e.createdAt))}</span>
                            </div>
                            <p className="text-[10px] text-slate-400 font-mono break-all leading-relaxed">参数: {e.argsSummary}</p>
                            <p className="text-[11px] text-slate-600 whitespace-pre-wrap break-words leading-relaxed">{e.resultRaw || e.resultSummary}</p>
                        </div>
                    ))}
                </main>
                <footer className="shrink-0 pb-[max(12px,env(safe-area-inset-bottom))] pt-2 border-t border-slate-900/10 flex items-center gap-2">
                    <button
                        type="button"
                        disabled={!persistentCount}
                        onClick={() => (confirming === 'manual' ? doClear('manual') : setConfirming('manual'))}
                        className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-colors disabled:opacity-40 ${confirming === 'manual' ? 'bg-amber-500 text-white' : 'bg-white/70 border border-slate-900/10 text-slate-600'}`}
                    >
                        {confirming === 'manual' ? '再点一次确认清空手册类' : `只清手册类长期结果 (${persistentCount})`}
                    </button>
                    <button
                        type="button"
                        disabled={!entries.length}
                        onClick={() => (confirming === 'all' ? doClear('all') : setConfirming('all'))}
                        className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-colors disabled:opacity-40 ${confirming === 'all' ? 'bg-rose-500 text-white' : 'bg-white/70 border border-slate-900/10 text-slate-600'}`}
                    >
                        {confirming === 'all' ? '再点一次确认全部清空' : `全部清空 (${entries.length})`}
                    </button>
                </footer>
            </div>
        </div>
    );
    return createPortal(portal, document.body);
};

export default McpMemoryModal;
