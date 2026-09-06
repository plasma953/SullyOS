import React, { useState } from 'react';
import { CaretLeft, FileText, Folder, MagnifyingGlass, SpinnerGap } from '@phosphor-icons/react';
import type { OpencodeConnection, OpencodeFileNode } from '../../types';
import { listFiles, readFileContent, searchText } from '../../utils/opencodeClient';

const CONTENT_PREVIEW_LIMIT = 20000;

type FindMatch = {
    path?: string;
    lines?: string;
    line_number?: number;
    [key: string]: unknown;
};

/** 文件 Tab：目录树懒加载 + 读文件 + 全文搜索。 */
const FilesTab: React.FC<{
    conn: OpencodeConnection;
    notify: (message: string, type?: any) => void;
}> = ({ conn, notify }) => {
    const [stack, setStack] = useState<string[]>([]);
    const [nodes, setNodes] = useState<OpencodeFileNode[]>([]);
    const [loading, setLoading] = useState(false);
    const [viewPath, setViewPath] = useState<string | null>(null);
    const [viewText, setViewText] = useState<string | null>(null);
    const [viewTruncated, setViewTruncated] = useState(false);
    const [query, setQuery] = useState('');
    const [searching, setSearching] = useState(false);
    const [matches, setMatches] = useState<FindMatch[] | null>(null);

    const cwd = stack.join('/');

    const load = async (path: string) => {
        setLoading(true);
        setViewPath(null);
        setMatches(null);
        try {
            const list = await listFiles(conn, path);
            setNodes([...list].sort((a, b) =>
                a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1));
        } catch { notify('目录读不出来：确认 serve 在跑', 'error'); }
        finally { setLoading(false); }
    };

    const openDir = (name: string) => {
        const next = [...stack, name];
        setStack(next);
        void load(next.join('/'));
    };

    const goBack = () => {
        const next = stack.slice(0, -1);
        setStack(next);
        void load(next.join('/'));
    };

    const openFile = async (path: string) => {
        setLoading(true);
        try {
            const file = await readFileContent(conn, path);
            if (file.type !== 'text') {
                setViewPath(path);
                setViewText(null);
                return;
            }
            setViewPath(path);
            setViewText(file.content.slice(0, CONTENT_PREVIEW_LIMIT));
            setViewTruncated(file.content.length > CONTENT_PREVIEW_LIMIT);
        } catch { notify('文件读不出来', 'error'); }
        finally { setLoading(false); }
    };

    const runSearch = async () => {
        const q = query.trim();
        if (!q) return;
        setSearching(true);
        setViewPath(null);
        try {
            const res = await searchText(conn, q);
            setMatches((Array.isArray(res) ? res : []) as FindMatch[]);
        } catch { notify('搜索失败', 'error'); }
        finally { setSearching(false); }
    };

    React.useEffect(() => { void load(''); // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-center gap-2 border-b border-slate-200/70 bg-white/80 px-3 py-2">
                <div className="flex min-w-0 flex-1 items-center gap-1 text-[10px] text-slate-500">
                    {!!stack.length && (
                        <button type="button" onClick={goBack} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-500 active:scale-95" aria-label="上一级"><CaretLeft size={15} /></button>
                    )}
                    <span className="truncate font-mono">/{cwd}</span>
                </div>
            </div>
            <div className="flex items-center gap-2 border-b border-slate-200/70 bg-white/60 px-3 py-2">
                <input
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') void runSearch(); }}
                    placeholder="全文搜索，如 TODO"
                    className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-[11px] text-slate-700 outline-none placeholder:text-slate-300 focus:border-emerald-400"
                />
                <button type="button" onClick={() => void runSearch()} disabled={searching || !query.trim()} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-800 text-white active:scale-95 disabled:opacity-40" aria-label="搜索">
                    {searching ? <SpinnerGap size={14} className="animate-spin" /> : <MagnifyingGlass size={14} />}
                </button>
            </div>
            <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-3 py-2">
                {loading && <p className="py-6 text-center text-[11px] text-slate-400">读取中…</p>}
                {matches && (
                    <div className="space-y-1.5">
                        <p className="px-1 text-[10px] text-slate-400">搜到 {matches.length} 处</p>
                        {matches.map((m, i) => (
                            <button key={i} type="button" onClick={() => m.path && void openFile(String(m.path))} className="block w-full rounded-lg bg-white px-3 py-2 text-left shadow-sm">
                                <span className="block truncate font-mono text-[10px] font-bold text-slate-700">{String(m.path ?? '未知路径')}</span>
                                {!!m.lines && <span className="mt-0.5 block truncate font-mono text-[9px] text-slate-400">L{m.line_number ?? '?'} · {String(m.lines).slice(0, 80)}</span>}
                            </button>
                        ))}
                        {!matches.length && <p className="py-6 text-center text-[11px] text-slate-400">没搜到，换个词试试。</p>}
                    </div>
                )}
                {!matches && !loading && !nodes.length && <p className="py-6 text-center text-[11px] text-slate-400">空目录。</p>}
                {!matches && nodes.map(n => (
                    <button
                        key={n.path}
                        type="button"
                        onClick={() => n.type === 'directory' ? openDir(n.name) : void openFile(n.path)}
                        className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left active:bg-slate-100"
                    >
                        {n.type === 'directory'
                            ? <Folder size={16} weight="fill" className="shrink-0 text-amber-500" />
                            : <FileText size={16} className="shrink-0 text-slate-400" />}
                        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-slate-700">{n.name}</span>
                    </button>
                ))}
            </div>
            {viewPath && (
                <div className="absolute inset-0 z-30">
                    <div className="absolute inset-0 bg-slate-900/40" onClick={() => setViewPath(null)} />
                    <div className="absolute bottom-0 left-0 right-0 flex max-h-[80%] flex-col rounded-t-3xl bg-slate-900 shadow-2xl">
                        <div className="flex items-center justify-between border-b border-slate-700 px-4 py-3">
                            <span className="min-w-0 flex-1 truncate font-mono text-[11px] font-bold text-slate-200">{viewPath}</span>
                            <button type="button" onClick={() => setViewPath(null)} className="ml-2 shrink-0 rounded-lg bg-slate-700 px-3 py-1.5 text-[10px] font-bold text-slate-200 active:scale-95">关闭</button>
                        </div>
                        <div className="min-h-0 flex-1 overflow-y-auto p-3">
                            {viewText == null
                                ? <p className="py-6 text-center text-[11px] text-slate-400">二进制文件，不预览。</p>
                                : <pre className="whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed text-emerald-50">{viewText}</pre>}
                            {viewTruncated && <p className="mt-2 text-center text-[9px] text-slate-500">太长只显示前 {CONTENT_PREVIEW_LIMIT} 字。</p>}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default FilesTab;
