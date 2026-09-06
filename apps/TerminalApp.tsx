import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    ArrowClockwise,
    CaretDown,
    GitDiff,
    List,
    PaperPlaneTilt,
    PencilSimple,
    Plus,
    Stop,
    Trash,
    WarningCircle,
    X,
} from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import { AppID } from '../types';
import ConfirmDialog from '../components/os/ConfirmDialog';
import FilesTab from '../components/terminal/FilesTab';
import TuiTab from '../components/terminal/TuiTab';
import type {
    OpencodeConnection,
    OpencodeFileDiff,
    OpencodeMessageItem,
    OpencodePermission,
    OpencodeSessionInfo,
    OpencodeSessionStatus,
} from '../types';
import {
    OpencodeAuthError,
    OpencodeNetworkError,
    abortSession,
    createSession,
    deleteSession,
    getSessionDiff,
    getSessionStatus,
    listSessionMessages,
    listSessions,
    loadOpencodeConnection,
    renameSession,
    respondPermission,
    runShellCommand,
    runSlashCommand,
    sendPromptAsync,
    subscribeOpencodeEvents,
    type OpencodeEvent,
    type OpencodePermissionResponse,
} from '../utils/opencodeClient';

type InputMode = 'prompt' | 'shell' | 'command';
type TermTab = 'session' | 'files' | 'tui';

const TAB_META: { id: TermTab; label: string }[] = [
    { id: 'session', label: '会话' },
    { id: 'files', label: '文件' },
    { id: 'tui', label: '遥控' },
];

const MODE_META: Record<InputMode, { label: string; placeholder: string }> = {
    prompt: { label: '对话', placeholder: '给电脑下任务…（回车发送）' },
    shell: { label: '命令', placeholder: 'shell 命令，如 git status --short' },
    command: { label: '斜杠', placeholder: '/init 这样：命令名 + 参数' },
};

const POLL_MS = 2000;
const MESSAGE_LIMIT = 100;

const fmtTime = (ts?: number): string => {
    if (!ts) return '';
    try {
        return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(ts);
    } catch { return ''; }
};

const statusLabel = (s?: OpencodeSessionStatus): string =>
    s === 'busy' ? '运行中' : s === 'retry' ? '重试中' : '空闲';

/** 从 parts 里抠正文/推理/工具调用，按服务端顺序渲染。 */
const TextBlock: React.FC<{ text: string }> = ({ text }) => (
    <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed">{text}</pre>
);

const SessionDrawer: React.FC<{
    open: boolean;
    sessions: OpencodeSessionInfo[];
    activeId: string | null;
    statusMap: Record<string, { type: OpencodeSessionStatus }>;
    onSelect: (id: string) => void;
    onNew: () => void;
    onRename: (s: OpencodeSessionInfo) => void;
    onDelete: (s: OpencodeSessionInfo) => void;
    onClose: () => void;
}> = ({ open, sessions, activeId, statusMap, onSelect, onNew, onRename, onDelete, onClose }) => {
    if (!open) return null;
    return (
        <div className="absolute inset-0 z-30">
            <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
            <div className="absolute bottom-0 left-0 top-0 flex w-[78%] max-w-[300px] flex-col bg-white shadow-2xl">
                <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                    <span className="text-xs font-bold text-slate-700">会话（{sessions.length}）</span>
                    <div className="flex items-center gap-1">
                        <button type="button" onClick={onNew} className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 active:scale-95" aria-label="新建会话"><Plus size={15} weight="bold" /></button>
                        <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 active:scale-95" aria-label="关闭"><X size={15} /></button>
                    </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto">
                    {!sessions.length && <p className="px-4 py-8 text-center text-[11px] text-slate-400">还没有会话，点右上角 + 新建一个。</p>}
                    {sessions.map(s => {
                        const st = statusMap[s.id]?.type;
                        const active = s.id === activeId;
                        return (
                            <div key={s.id} className={`flex items-center gap-2 border-b border-slate-50 px-3 py-2.5 ${active ? 'bg-emerald-50/60' : ''}`}>
                                <button type="button" onClick={() => onSelect(s.id)} className="min-w-0 flex-1 text-left">
                                    <span className="block truncate text-xs font-bold text-slate-700">{s.title || '未命名会话'}</span>
                                    <span className="mt-0.5 block truncate text-[9px] text-slate-400">
                                        {st === 'busy' ? '● 运行中' : st === 'retry' ? '○ 重试中' : fmtTime(s.time?.updated)}
                                    </span>
                                </button>
                                <button type="button" onClick={() => onRename(s)} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-300 active:scale-95" aria-label="改名"><PencilSimple size={13} /></button>
                                <button type="button" onClick={() => onDelete(s)} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-300 active:scale-95" aria-label="删除"><Trash size={13} /></button>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

const RenameModal: React.FC<{
    session: OpencodeSessionInfo | null;
    onSubmit: (s: OpencodeSessionInfo, title: string) => void;
    onClose: () => void;
}> = ({ session, onSubmit, onClose }) => {
    const [draft, setDraft] = useState(session?.title || '');
    useEffect(() => { setDraft(session?.title || ''); }, [session?.id]); // eslint-disable-line react-hooks/exhaustive-deps
    if (!session) return null;
    return (
        <div className="absolute inset-0 z-30">
            <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
            <div className="absolute bottom-0 left-0 right-0 rounded-t-3xl bg-white p-4 shadow-2xl">
                <p className="text-xs font-bold text-slate-700">会话改名</p>
                <input
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    onKeyDown={e => {
                        if (e.key === 'Enter') { onSubmit(session, draft); onClose(); }
                        if (e.key === 'Escape') onClose();
                    }}
                    maxLength={60}
                    placeholder="起个名字"
                    className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-700 outline-none placeholder:text-slate-300 focus:border-emerald-400"
                />
                <div className="mt-3 grid grid-cols-2 gap-2">
                    <button type="button" onClick={onClose} className="rounded-xl bg-slate-100 py-2.5 text-xs font-bold text-slate-500 active:scale-95">取消</button>
                    <button
                        type="button"
                        onClick={() => { onSubmit(session, draft); onClose(); }}
                        disabled={!draft.trim() || draft.trim() === session.title}
                        className="rounded-xl bg-emerald-500 py-2.5 text-xs font-bold text-white active:scale-95 disabled:opacity-40"
                    >确定</button>
                </div>
            </div>
        </div>
    );
};

const DiffPanel: React.FC<{
    open: boolean;
    loading: boolean;
    diffs: OpencodeFileDiff[];
    onClose: () => void;
}> = ({ open, loading, diffs, onClose }) => {
    const [expanded, setExpanded] = useState<string | null>(null);
    if (!open) return null;
    return (
        <div className="absolute inset-0 z-30">
            <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
            <div className="absolute bottom-0 left-0 right-0 flex max-h-[75%] flex-col rounded-t-3xl bg-white shadow-2xl">
                <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                    <span className="flex items-center gap-1.5 text-xs font-bold text-slate-700"><GitDiff size={14} /> 本会话改动（{diffs.length} 个文件）</span>
                    <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 active:scale-95" aria-label="关闭"><X size={15} /></button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                    {loading && <p className="py-6 text-center text-[11px] text-slate-400">正在读取 diff…</p>}
                    {!loading && !diffs.length && <p className="py-6 text-center text-[11px] text-slate-400">这个会话还没改过文件。</p>}
                    {diffs.map(d => (
                        <div key={d.file} className="mb-2 overflow-hidden rounded-xl border border-slate-200">
                            <button type="button" onClick={() => setExpanded(expanded === d.file ? null : d.file)} className="flex w-full items-center gap-2 bg-slate-50 px-3 py-2 text-left">
                                <span className="min-w-0 flex-1 truncate font-mono text-[10px] font-bold text-slate-700">{d.file}</span>
                                <span className="shrink-0 text-[9px] font-bold text-emerald-600">+{d.additions}</span>
                                <span className="shrink-0 text-[9px] font-bold text-rose-500">-{d.deletions}</span>
                                <CaretDown size={12} className={`shrink-0 text-slate-400 transition-transform ${expanded === d.file ? 'rotate-180' : ''}`} />
                            </button>
                            {expanded === d.file && (
                                <div className="grid grid-cols-2 gap-px bg-slate-200 text-[9px]">
                                    <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words bg-rose-50/60 p-2 font-mono text-slate-600">{d.before || '（空）'}</pre>
                                    <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words bg-emerald-50/60 p-2 font-mono text-slate-700">{d.after || '（空）'}</pre>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

const TerminalApp: React.FC = () => {
    const { addToast, openApp } = useOS();
    const [conn, setConn] = useState<OpencodeConnection | null>(() => loadOpencodeConnection());
    const [sessions, setSessions] = useState<OpencodeSessionInfo[]>([]);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [messages, setMessages] = useState<OpencodeMessageItem[]>([]);
    const [statusMap, setStatusMap] = useState<Record<string, { type: OpencodeSessionStatus }>>({});
    const [permissions, setPermissions] = useState<OpencodePermission[]>([]);
    const [input, setInput] = useState('');
    const [mode, setMode] = useState<InputMode>('prompt');
    const [tab, setTab] = useState<TermTab>('session');
    const [sending, setSending] = useState(false);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [diffOpen, setDiffOpen] = useState(false);
    const [diffs, setDiffs] = useState<OpencodeFileDiff[]>([]);
    const [diffLoading, setDiffLoading] = useState(false);
    const [sseOn, setSseOn] = useState(false);
    const [pendingDelete, setPendingDelete] = useState<OpencodeSessionInfo | null>(null);
    const [pendingReject, setPendingReject] = useState<OpencodePermission | null>(null);
    const [renameTarget, setRenameTarget] = useState<OpencodeSessionInfo | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const connRef = useRef(conn);
    connRef.current = conn;
    const activeRef = useRef(activeId);
    activeRef.current = activeId;
    // statusMap 的 ref 镜像：2s 轮询 interval 只建一次，读闭包里的 statusMap 会永远过期。
    const statusRef = useRef(statusMap);
    statusRef.current = statusMap;

    const activeStatus = activeId ? statusMap[activeId]?.type : undefined;
    const busy = activeStatus === 'busy' || activeStatus === 'retry';

    const scrollBottom = useCallback((force = false) => {
        const el = scrollRef.current;
        if (!el) return;
        const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
        if (force || nearBottom) el.scrollTop = el.scrollHeight;
    }, []);

    useEffect(() => { scrollBottom(); }, [messages.length, scrollBottom]);

    const failHint = useCallback((error: unknown): string => {
        if (error instanceof OpencodeAuthError) return '密码不对，去设置里对一下 OPENCODE_SERVER_PASSWORD';
        if (error instanceof OpencodeNetworkError) return '连不上电脑：确认开机、serve 在跑、地址/代理填对';
        return '请求被拒绝：确认 serve 版本与地址';
    }, []);

    const refreshSessions = useCallback(async (silent = false) => {
        const c = connRef.current;
        if (!c?.enabled) return;
        try {
            const list = await listSessions(c);
            setSessions([...list].sort((a, b) => (b.time?.updated || 0) - (a.time?.updated || 0)));
        } catch (e) {
            if (!silent) addToast(failHint(e), 'error');
        }
    }, [addToast, failHint]);

    const refreshMessages = useCallback(async (sessionID: string, silent = true) => {
        const c = connRef.current;
        if (!c?.enabled) return;
        try {
            const items = await listSessionMessages(c, sessionID, MESSAGE_LIMIT);
            setMessages(items);
        } catch (e) {
            if (!silent) addToast(failHint(e), 'error');
        }
    }, [addToast, failHint]);

    const refreshStatus = useCallback(async () => {
        const c = connRef.current;
        if (!c?.enabled) return;
        try {
            setStatusMap(await getSessionStatus(c));
        } catch { /* 状态轮询失败不打扰，只靠消息轮询 */ }
    }, []);

    // 初次加载 + 每 2s 轮询：状态必轮询；正忙才轮询消息（省流量）。
    useEffect(() => {
        if (!conn?.enabled) return;
        void refreshSessions(true);
        void refreshStatus();
        const timer = setInterval(() => {
            void refreshStatus();
            const id = activeRef.current;
            const c = connRef.current;
            const st = id ? statusRef.current[id]?.type : undefined;
            if (id && c?.enabled && (st === 'busy' || st === 'retry')) {
                void refreshMessages(id, true);
            }
        }, POLL_MS);
        return () => clearInterval(timer);
    }, [conn?.enabled, refreshSessions, refreshStatus, refreshMessages]);

    // SSE：权限审批与会话增删实时推；断线 5s 后重连。
    useEffect(() => {
        if (!conn?.enabled) return;
        let cancelled = false;
        const controller = new AbortController();
        const onEvent = (e: OpencodeEvent) => {
            const props = (e.properties ?? {}) as Record<string, unknown>;
            switch (e.type) {
                case 'permission.updated': {
                    const p = props as unknown as OpencodePermission;
                    if (p?.id && p?.sessionID) {
                        setPermissions(prev => prev.some(x => x.id === p.id) ? prev : [...prev, p]);
                        if (p.sessionID !== activeRef.current) addToast('电脑请求确认操作，切到对应会话审批', 'info');
                    }
                    break;
                }
                case 'permission.replied':
                    setPermissions(prev => prev.filter(x => x.id !== (props.permissionID as string)));
                    break;
                case 'session.created':
                case 'session.updated':
                case 'session.deleted':
                    void refreshSessions(true);
                    break;
                case 'session.status': {
                    const sid = props.sessionID as string;
                    const status = props.status as { type: OpencodeSessionStatus } | undefined;
                    if (sid && status) {
                        const was = statusMap[sid]?.type;
                        setStatusMap(prev => ({ ...prev, [sid]: status }));
                        if (sid === activeRef.current && (was === 'busy' || was === 'retry') && status.type === 'idle') {
                            void refreshMessages(sid, true);
                        }
                    }
                    break;
                }
                case 'session.error':
                    addToast('电脑端任务出错了，进会话查看', 'error');
                    break;
                default:
                    break;
            }
        };
        const loop = async () => {
            while (!cancelled) {
                setSseOn(false);
                try {
                    setSseOn(true);
                    await subscribeOpencodeEvents(conn, onEvent, controller.signal);
                } catch {
                    setSseOn(false);
                    if (cancelled || controller.signal.aborted) return;
                    await new Promise(r => setTimeout(r, 5000));
                }
                if (!cancelled && !controller.signal.aborted) {
                    await new Promise(r => setTimeout(r, 5000));
                }
            }
        };
        void loop();
        return () => { cancelled = true; controller.abort(); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [conn?.enabled]);

    const selectSession = useCallback((id: string) => {
        setActiveId(id);
        setMessages([]);
        setDiffOpen(false);
        setDrawerOpen(false);
        void refreshMessages(id, false);
        void refreshStatus();
    }, [refreshMessages, refreshStatus]);

    const handleNew = useCallback(async () => {
        const c = connRef.current;
        if (!c?.enabled) return;
        try {
            const s = await createSession(c);
            await refreshSessions(true);
            selectSession(s.id);
            addToast('新会话已建', 'success');
        } catch (e) { addToast(failHint(e), 'error'); }
    }, [addToast, failHint, refreshSessions, selectSession]);

    const handleRename = useCallback(async (s: OpencodeSessionInfo, title: string) => {
        const c = connRef.current;
        if (!c?.enabled) return;
        const next = title.trim();
        if (!next || next === s.title) return;
        try {
            await renameSession(c, s.id, next);
            await refreshSessions(true);
        } catch (e) { addToast(failHint(e), 'error'); }
    }, [addToast, failHint, refreshSessions]);

    const handleDelete = useCallback(async (s: OpencodeSessionInfo) => {
        const c = connRef.current;
        if (!c?.enabled) return;
        try {
            await deleteSession(c, s.id);
            if (s.id === activeRef.current) { setActiveId(null); setMessages([]); }
            await refreshSessions(true);
        } catch (e) { addToast(failHint(e), 'error'); }
    }, [addToast, failHint, refreshSessions]);

    const handleAbort = useCallback(async () => {
        const c = connRef.current;
        const id = activeRef.current;
        if (!c?.enabled || !id) return;
        try {
            await abortSession(c, id);
            addToast('已喊停', 'info');
            void refreshMessages(id, true);
        } catch (e) { addToast(failHint(e), 'error'); }
    }, [addToast, failHint, refreshMessages]);

    const handleSend = useCallback(async () => {
        const c = connRef.current;
        const id = activeRef.current;
        const text = input.trim();
        if (!c?.enabled || !id || !text || sending) return;
        setSending(true);
        try {
            if (mode === 'prompt') {
                await sendPromptAsync(c, id, text);
            } else if (mode === 'shell') {
                await runShellCommand(c, id, text);
            } else {
                const [cmd, ...rest] = text.split(/\s+/);
                await runSlashCommand(c, id, cmd.replace(/^\//, ''), rest.join(' '));
            }
            setInput('');
            scrollBottom(true);
            // 发完先紧轮询三次让首字尽快出现，之后交给忙闲轮询。
            for (let i = 0; i < 3; i++) {
                await new Promise(r => setTimeout(r, 1000));
                await refreshMessages(id, true);
            }
        } catch (e) { addToast(failHint(e), 'error'); }
        finally { setSending(false); }
    }, [addToast, failHint, input, mode, refreshMessages, scrollBottom, sending]);

    const handlePermission = useCallback(async (p: OpencodePermission, response: OpencodePermissionResponse) => {
        const c = connRef.current;
        if (!c?.enabled) return;
        try {
            await respondPermission(c, p.sessionID, p.id, response);
            setPermissions(prev => prev.filter(x => x.id !== p.id));
        } catch (e) { addToast(failHint(e), 'error'); }
    }, [addToast, failHint]);

    const openDiff = useCallback(async () => {
        const c = connRef.current;
        const id = activeRef.current;
        if (!c?.enabled || !id) return;
        setDiffOpen(true);
        setDiffLoading(true);
        try {
            setDiffs(await getSessionDiff(c, id));
        } catch (e) { addToast(failHint(e), 'error'); }
        finally { setDiffLoading(false); }
    }, [addToast, failHint]);

    const activeSession = sessions.find(s => s.id === activeId) ?? null;
    const activePermissions = permissions.filter(p => p.sessionID === activeId);

    if (!conn?.enabled) {
        return (
            <div className="relative flex h-full w-full flex-col items-center justify-center gap-3 overflow-hidden bg-slate-50 px-8 text-center">
                <p className="text-sm font-bold text-slate-700">终端还没连上你的电脑</p>
                <p className="text-[11px] leading-relaxed text-slate-400">去设置里填好 opencode 地址并测试连通，回来就能远程遥控了。</p>
                <button
                    type="button"
                    onClick={() => openApp(AppID.Settings)}
                    className="rounded-xl bg-emerald-500 px-5 py-2.5 text-xs font-bold text-white active:scale-95"
                >去设置连接</button>
            </div>
        );
    }

    return (
        <div className="relative flex h-full w-full flex-col overflow-hidden bg-slate-50">
            {/* 顶栏 */}
            <header className="flex items-center gap-2 border-b border-slate-200/70 bg-white/80 px-3 py-2.5 backdrop-blur">
                <button type="button" onClick={() => setDrawerOpen(true)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 active:scale-95" aria-label="会话列表"><List size={17} /></button>
                <span className={`h-2 w-2 shrink-0 rounded-full ${busy ? 'animate-pulse bg-amber-500' : sseOn ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-bold text-slate-700">{activeSession?.title || '未选会话'}</p>
                    <p className="text-[9px] text-slate-400">{activeSession ? statusLabel(activeStatus) : '从左侧选一个会话开始'}</p>
                </div>
                {busy && (
                    <button type="button" onClick={handleAbort} className="flex h-8 items-center gap-1 rounded-lg bg-rose-100 px-2.5 text-[10px] font-bold text-rose-600 active:scale-95"><Stop size={13} weight="fill" /> 停</button>
                )}
                <button type="button" onClick={openDiff} disabled={!activeId} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 active:scale-95 disabled:opacity-40" aria-label="查看改动"><GitDiff size={16} /></button>
                <button type="button" onClick={() => { void refreshSessions(); if (activeId) void refreshMessages(activeId); }} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 active:scale-95" aria-label="刷新"><ArrowClockwise size={15} /></button>
            </header>
            {/* Tab 切换 */}
            <nav className="flex gap-1.5 border-b border-slate-200/70 bg-white/60 px-3 py-1.5">
                {TAB_META.map(t => (
                    <button
                        key={t.id}
                        type="button"
                        onClick={() => setTab(t.id)}
                        className={`flex-1 rounded-lg py-1.5 text-[10px] font-bold active:scale-95 ${tab === t.id ? 'bg-slate-800 text-white' : 'text-slate-400'}`}
                    >{t.label}</button>
                ))}
            </nav>

            {tab === 'session' ? (
            <>
            {/* 消息流 */}
            <div ref={scrollRef} className="no-scrollbar min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3 py-3">
                {!activeId && (
                    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                        <p className="text-xs font-bold text-slate-500">选个会话，或者新建一个</p>
                        <button type="button" onClick={handleNew} className="flex items-center gap-1.5 rounded-xl bg-emerald-500 px-4 py-2.5 text-[11px] font-bold text-white active:scale-95"><Plus size={14} weight="bold" /> 新建会话</button>
                    </div>
                )}
                {messages.map(item => (
                    <MessageCard key={item.info.id} item={item} />
                ))}
                {activePermissions.map(p => (
                    <div key={p.id} className="rounded-xl border border-amber-300 bg-amber-50 p-3">
                        <p className="flex items-center gap-1.5 text-[11px] font-bold text-amber-800"><WarningCircle size={14} /> 电脑请求确认</p>
                        <p className="mt-1 text-xs text-slate-700">{p.title}</p>
                        {p.pattern && <p className="mt-0.5 truncate font-mono text-[9px] text-slate-400">{Array.isArray(p.pattern) ? p.pattern.join(' ') : p.pattern}</p>}
                        <div className="mt-2 grid grid-cols-3 gap-1.5">
                            <button type="button" onClick={() => void handlePermission(p, 'once')} className="rounded-lg bg-emerald-500 py-2 text-[10px] font-bold text-white active:scale-95">允许本次</button>
                            <button type="button" onClick={() => void handlePermission(p, 'always')} className="rounded-lg bg-emerald-100 py-2 text-[10px] font-bold text-emerald-700 active:scale-95">总是允许</button>
                            <button type="button" onClick={() => setPendingReject(p)} className="rounded-lg bg-slate-200 py-2 text-[10px] font-bold text-slate-600 active:scale-95">拒绝</button>
                        </div>
                    </div>
                ))}
                {busy && <p className="py-1 text-center text-[10px] text-slate-400">电脑正在干活…（{statusLabel(activeStatus)}）</p>}
            </div>

            {/* 底部输入 */}
            {activeId && (
                <footer className="border-t border-slate-200/70 bg-white/90 px-3 pb-3 pt-2 backdrop-blur">
                    <div className="mb-2 flex gap-1.5">
                        {(Object.keys(MODE_META) as InputMode[]).map(m => (
                            <button
                                key={m}
                                type="button"
                                onClick={() => setMode(m)}
                                className={`rounded-lg px-2.5 py-1 text-[10px] font-bold active:scale-95 ${mode === m ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-500'}`}
                            >{MODE_META[m].label}</button>
                        ))}
                    </div>
                    <div className="flex items-end gap-2">
                        <textarea
                            value={input}
                            onChange={e => setInput(e.target.value)}
                            onKeyDown={e => {
                                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSend(); }
                            }}
                            rows={1}
                            placeholder={MODE_META[mode].placeholder}
                            className="max-h-28 min-h-0 flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 font-mono text-xs text-slate-700 outline-none placeholder:text-slate-300 focus:border-emerald-400"
                        />
                        <button
                            type="button"
                            onClick={() => void handleSend()}
                            disabled={sending || !input.trim()}
                            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500 text-white active:scale-95 disabled:opacity-40"
                            aria-label="发送"
                        ><PaperPlaneTilt size={16} weight="fill" /></button>
                    </div>
                </footer>
            )}
            </>
            ) : tab === 'files' ? (
                <FilesTab conn={conn} notify={addToast} />
            ) : (
                <TuiTab conn={conn} notify={addToast} />
            )}

            <SessionDrawer
                open={drawerOpen}
                sessions={sessions}
                activeId={activeId}
                statusMap={statusMap}
                onSelect={selectSession}
                onNew={() => void handleNew()}
                onRename={(s) => setRenameTarget(s)}
                onDelete={(s) => setPendingDelete(s)}
                onClose={() => setDrawerOpen(false)}
            />
            <DiffPanel open={diffOpen} loading={diffLoading} diffs={diffs} onClose={() => setDiffOpen(false)} />
            <RenameModal
                session={renameTarget}
                onSubmit={(s, title) => void handleRename(s, title)}
                onClose={() => setRenameTarget(null)}
            />
            <ConfirmDialog
                isOpen={pendingDelete != null}
                title="删除会话"
                message={pendingDelete ? `删除会话「${pendingDelete.title || '未命名'}」？\n\n消息记录会一起删，文件改动不受影响。` : ''}
                variant="danger"
                confirmText="删除"
                onConfirm={() => { if (pendingDelete) void handleDelete(pendingDelete); setPendingDelete(null); }}
                onCancel={() => setPendingDelete(null)}
            />
            <ConfirmDialog
                isOpen={pendingReject != null}
                title="拒绝操作"
                message={pendingReject ? `拒绝「${pendingReject.title}」？\n\n电脑端当前这一步会停下。` : ''}
                variant="warning"
                confirmText="拒绝"
                onConfirm={() => { if (pendingReject) void handlePermission(pendingReject, 'reject'); setPendingReject(null); }}
                onCancel={() => setPendingReject(null)}
            />
        </div>
    );
};

const MessageCard: React.FC<{ item: OpencodeMessageItem }> = ({ item }) => {
    const { info, parts } = item;
    const [openTool, setOpenTool] = useState<string | null>(null);
    if (info.role === 'user') {
        const text = parts.filter(p => p.type === 'text').map(p => p.text || '').join('\n');
        return (
            <div className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-br-md bg-emerald-500 px-3 py-2 text-xs leading-relaxed text-white">
                    <pre className="whitespace-pre-wrap break-words font-sans">{text || '（空消息）'}</pre>
                    <p className="mt-1 text-right text-[8px] text-emerald-100">{fmtTime(info.time?.created)}</p>
                </div>
            </div>
        );
    }
    const texts = parts.filter(p => (p.type === 'text' || p.type === 'reasoning') && p.text);
    const tools = parts.filter(p => p.type === 'tool');
    return (
        <div className="max-w-[92%] overflow-hidden rounded-2xl rounded-bl-md bg-slate-900 text-slate-100 shadow-sm">
            <div className="space-y-2 px-3 py-2.5">
                {info.error && (
                    <p className="flex items-center gap-1.5 text-[10px] font-bold text-rose-400">
                        <WarningCircle size={13} /> 出错：{info.error.data?.message || info.error.name}
                    </p>
                )}
                {texts.map(t => (
                    <div key={t.id} className={t.type === 'reasoning' ? 'text-slate-400' : 'text-emerald-50'}>
                        <TextBlock text={t.text || ''} />
                    </div>
                ))}
                {!texts.length && !tools.length && !info.error && (
                    <p className="text-[10px] text-slate-500">（还在想…）</p>
                )}
                {tools.map(t => {
                    const st = t.state?.status ?? 'pending';
                    const dot = st === 'completed' ? 'bg-emerald-400' : st === 'error' ? 'bg-rose-400' : st === 'running' ? 'animate-pulse bg-amber-400' : 'bg-slate-500';
                    const open = openTool === t.id;
                    return (
                        <div key={t.id} className="overflow-hidden rounded-lg bg-slate-800">
                            <button type="button" onClick={() => setOpenTool(open ? null : t.id)} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left">
                                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
                                <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-slate-300">{t.tool}{t.state?.title ? ` · ${t.state.title}` : ''}</span>
                                <CaretDown size={11} className={`shrink-0 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`} />
                            </button>
                            {open && (
                                <div className="space-y-1 border-t border-slate-700 px-2.5 py-2">
                                    {!!t.state?.input && <pre className="whitespace-pre-wrap break-words font-mono text-[9px] text-slate-400">in: {JSON.stringify(t.state.input).slice(0, 500)}</pre>}
                                    {!!t.state?.output && <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[9px] text-slate-300">out: {t.state.output.slice(0, 2000)}</pre>}
                                    {!!t.state?.error && <pre className="whitespace-pre-wrap break-words font-mono text-[9px] text-rose-400">{t.state.error.slice(0, 500)}</pre>}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
            <p className="border-t border-slate-800 px-3 py-1 text-right text-[8px] text-slate-500">
                {fmtTime(info.time?.completed ?? info.time?.created)}
                {info.providerID || info.modelID ? ` · ${info.providerID ?? ''} ${info.modelID ?? ''}`.trim() : ''}
            </p>
        </div>
    );
};

export default TerminalApp;
