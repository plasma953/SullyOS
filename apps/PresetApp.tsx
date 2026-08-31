/**
 * 「预设」App —— 提示词预设管理。
 *
 * 两个区块：
 * 1. 内置提示词（P3 目录播种，带 sourceKey）：聊天钢印 / 约会 / 写歌 / 语音 /
 *    记忆 / 主动消息 六大类。可原地编辑、可启停（技术模板停用 = 注入时回退
 *    内置默认，见 promptPresetRuntime.resolveTechnicalPrompt），一键恢复默认。
 * 2. 自定义段落（无 sourceKey）：内容 / 顺序 / 启停，注入点 chatPrompts 的
 *    buildSystemPrompt（enabled 的按 order 排序拼接）。
 *
 * 数据存 IndexedDB `prompt_presets` store（v72），随备份动态枚举自动带走。
 * 所有写路径之后都调 invalidatePromptPresetCache()，让同步注入点立刻看到新值。
 *
 * UI 遵循原作玻璃拟态风格：slate 底 + 白/20 玻璃卡片 + Phosphor 线性图标。
 */
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
    ArrowLeft, Plus, Trash, CaretUp, CaretDown, PencilSimple,
    Check, X, NoteBlank, ArrowCounterClockwise,
    ChatCircle, Heart, MusicNote, SpeakerHigh, Brain, BellRinging,
    Eye, UserCircle, ArrowsClockwise, Stack,
} from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import {
    PROMPT_CATEGORY_META,
    getBuiltinEntry,
    type PromptCategory,
} from '../utils/promptPresetCatalog';
import {
    applyBuiltinDefaultsToPreset,
    invalidatePromptPresetCache,
} from '../utils/promptPresetRuntime';
import { seedBuiltinPromptPresets } from '../utils/promptPresetSeeding';
import type { PromptPreset, CharacterProfile } from '../types';
import {
    composePromptPreview,
    PROMPT_TOKEN_ESTIMATE_NOTE,
    type PromptPreviewResult,
} from '../utils/promptPreviewComposer';

/** 分类 → 图标（保持与系统其他 App 一致的线性风格）。 */
const CATEGORY_ICON: Record<PromptCategory, React.ElementType> = {
    chat: ChatCircle,
    date: Heart,
    song: MusicNote,
    voice: SpeakerHigh,
    memory: Brain,
    amsg: BellRinging,
};

const PresetApp: React.FC = () => {
    const { closeApp, addToast } = useOS();
    const [presets, setPresets] = useState<PromptPreset[]>([]);
    const [loading, setLoading] = useState(true);
    /** 正在内联编辑的段落 id；null = 无。 */
    const [editingId, setEditingId] = useState<string | null>(null);
    /** 编辑草稿（name / content），确认时统一写回。 */
    const [draftName, setDraftName] = useState('');
    const [draftContent, setDraftContent] = useState('');

    // ---------- 注入预览视图 ----------
    /** null = 管理视图；非 null = 预览视图（当前选中的角色） */
    const [previewChar, setPreviewChar] = useState<CharacterProfile | null>(null);
    /** 记住上次预览的角色：退出预览后顶栏眼睛按钮可一键重进 */
    const previewCharRef = useRef<CharacterProfile | null>(null);
    const [previewData, setPreviewData] = useState<PromptPreviewResult | null>(null);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [previewSim, setPreviewSim] = useState('');
    /** 已展开原文的块 id 集合 */
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

    const loadPreview = useCallback(async (char: CharacterProfile, simText: string) => {
        setPreviewLoading(true);
        try {
            const msgs = simText.split('\n').map(l => l.trim()).filter(Boolean);
            const r = await composePromptPreview(char, { recentMessages: msgs });
            setPreviewData(r);
        } catch {
            addToast('预览组装失败，请重试', 'error');
        } finally {
            setPreviewLoading(false);
        }
    }, [addToast]);

    const openPreview = useCallback((char: CharacterProfile) => {
        previewCharRef.current = char;
        setPreviewChar(char);
        setExpandedIds(new Set());
        loadPreview(char, previewSim);
    }, [loadPreview, previewSim]);

    const closePreview = () => {
        setPreviewChar(null);
        setPreviewData(null);
    };

    const toggleExpanded = (id: string) => {
        setExpandedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const load = useCallback(async () => {
        setLoading(true);
        try {
            // 打开面板时补一次播种（幂等、毫秒级）：OSContext 冷启动已跑过，
            // 这里兜底「内置目录升级新增条目」的场景，保证分组视图完整。
            await seedBuiltinPromptPresets();
            setPresets(await DB.getPromptPresets());
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const persist = useCallback(async (next: PromptPreset[], msg?: string) => {
        setPresets(next);
        try {
            for (const p of next) await DB.savePromptPreset(p);
            invalidatePromptPresetCache(); // 同步注入点（写歌/约会深挖）立即感知
            if (msg) addToast(msg, 'success');
        } catch (e: any) {
            addToast(e?.message || '保存失败', 'error');
        }
    }, [addToast]);

    // ---------- 分组视图 ----------
    const builtinRows = useMemo(
        () => presets.filter(p => !!p.sourceKey),
        [presets],
    );
    const customRows = useMemo(
        () => presets.filter(p => !p.sourceKey).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
        [presets],
    );
    const grouped = useMemo(
        () => PROMPT_CATEGORY_META
            .map(meta => ({
                meta,
                rows: builtinRows
                    .filter(p => p.category === meta.id)
                    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
            }))
            .filter(g => g.rows.length > 0),
        [builtinRows],
    );

    // ---------- 自定义段落操作 ----------
    const handleAdd = () => {
        const now = Date.now();
        const item: PromptPreset = {
            id: crypto.randomUUID(),
            name: '新段落',
            content: '',
            order: (customRows.length ? Math.max(...customRows.map(p => p.order ?? 0)) : 0) + 1,
            enabled: true,
            createdAt: now,
            updatedAt: now,
        };
        persist([...presets, item]);
        setEditingId(item.id);
        setDraftName(item.name);
        setDraftContent('');
    };

    const handleDelete = (id: string) => {
        const next = presets.filter(p => p.id !== id);
        setPresets(next);
        DB.deletePromptPreset(id).then(() => invalidatePromptPresetCache()).catch(() => addToast('删除失败', 'error'));
        if (editingId === id) setEditingId(null);
    };

    /** 上下移：交换相邻两项的 order（仅自定义区，按当前展示顺序操作）。 */
    const move = (index: number, dir: -1 | 1) => {
        const target = index + dir;
        if (target < 0 || target >= customRows.length) return;
        const a = customRows[index];
        const b = customRows[target];
        const next = presets.map(p => {
            if (p.id === a.id) return { ...p, order: b.order, updatedAt: Date.now() };
            if (p.id === b.id) return { ...p, order: a.order, updatedAt: Date.now() };
            return p;
        });
        persist(next);
    };

    // ---------- 通用操作 ----------
    const toggleEnabled = (id: string) => {
        persist(presets.map(p => p.id === id
            ? { ...p, enabled: !p.enabled, updatedAt: Date.now() } : p));
    };

    const startEdit = (p: PromptPreset) => {
        setEditingId(p.id);
        setDraftName(p.name);
        setDraftContent(p.content);
    };

    const commitEdit = () => {
        if (!editingId) return;
        const name = draftName.trim() || '未命名段落';
        persist(presets.map(p => p.id === editingId
            ? { ...p, name, content: draftContent, updatedAt: Date.now() } : p),
            '已保存');
        setEditingId(null);
    };

    /** 内置条目：一键恢复默认（名字 + 内容 + 版本；启停/顺序保留）。 */
    const handleRestore = (p: PromptPreset) => {
        const restored = applyBuiltinDefaultsToPreset(p);
        persist(presets.map(x => x.id === p.id ? restored : x), '已恢复默认文案');
    };

    /** 单张预设卡（内置 / 自定义共用骨架，差异用 props 控制）。 */
    const renderCard = (p: PromptPreset, index: number, opts: { builtin: boolean; listLen: number; movable: boolean }) => {
        const editing = editingId === p.id;
        const builtinEntry = p.sourceKey ? getBuiltinEntry(p.sourceKey) : undefined;
        const customized = !!builtinEntry && p.content !== builtinEntry.content;
        const disabledHint = builtinEntry
            ? (builtinEntry.mutable ? '停用后此段不注入' : '技术模板：停用后注入时回退内置默认')
            : '停用后此段不注入';
        return (
            <div
                key={p.id}
                className={`rounded-2xl border backdrop-blur-md transition-shadow ${
                    p.enabled
                        ? 'bg-white/70 border-white/60 shadow-sm'
                        : 'bg-white/40 border-white/40 opacity-70'
                }`}
            >
                {/* 卡头：名称 + （内置）状态徽标 + 排序 + 开关 + 恢复/删除 */}
                <div className="flex items-center gap-1.5 px-3 pt-2.5 pb-1.5">
                    {editing ? (
                        <input
                            value={draftName}
                            onChange={e => setDraftName(e.target.value)}
                            className="flex-1 min-w-0 bg-slate-100 rounded-lg px-2 py-1 text-sm font-bold text-slate-800 outline-none focus:ring-2 ring-violet-300"
                            placeholder="段落名"
                            autoFocus
                        />
                    ) : (
                        <button
                            onClick={() => startEdit(p)}
                            className="flex items-center gap-1.5 min-w-0 flex-1 text-left"
                        >
                            <PencilSimple size={13} className="text-slate-400 shrink-0" />
                            <span className="text-sm font-bold text-slate-800 truncate">{p.name}</span>
                            {customized && (
                                <span className="shrink-0 text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-1.5 py-px">已修改</span>
                            )}
                        </button>
                    )}
                    {/* 上下移（仅自定义段落） */}
                    {opts.movable && (
                        <div className="flex flex-col -space-y-1 shrink-0">
                            <button
                                onClick={() => move(index, -1)}
                                disabled={index === 0}
                                className="p-0.5 rounded hover:bg-slate-200/70 disabled:opacity-20 active:scale-90 transition-transform"
                            >
                                <CaretUp size={13} weight="bold" className="text-slate-500" />
                            </button>
                            <button
                                onClick={() => move(index, 1)}
                                disabled={index === opts.listLen - 1}
                                className="p-0.5 rounded hover:bg-slate-200/70 disabled:opacity-20 active:scale-90 transition-transform"
                            >
                                <CaretDown size={13} weight="bold" className="text-slate-500" />
                            </button>
                        </div>
                    )}
                    {/* 启停开关（沿用设置页 violet 口径） */}
                    <label className="relative inline-block w-9 h-5 shrink-0 cursor-pointer" title={disabledHint}>
                        <input
                            type="checkbox"
                            className="opacity-0 w-0 h-0 peer"
                            checked={p.enabled}
                            onChange={() => toggleEnabled(p.id)}
                        />
                        <div className="absolute inset-0 bg-slate-200 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-violet-500"></div>
                    </label>
                    {/* 恢复默认（仅内置）/ 删除（仅自定义） */}
                    {opts.builtin ? (
                        <button
                            onClick={() => handleRestore(p)}
                            disabled={!customized}
                            className="p-1.5 rounded-full hover:bg-violet-50 active:scale-90 transition-transform shrink-0 disabled:opacity-20"
                            title="恢复默认文案"
                        >
                            <ArrowCounterClockwise size={15} className="text-violet-500" />
                        </button>
                    ) : (
                        <button
                            onClick={() => handleDelete(p.id)}
                            className="p-1.5 rounded-full hover:bg-red-50 active:scale-90 transition-transform shrink-0"
                            title="删除"
                        >
                            <Trash size={15} className="text-red-400" />
                        </button>
                    )}
                </div>

                {/* 正文：编辑态 textarea / 展示态摘要 */}
                {editing ? (
                    <div className="px-3 pb-3">
                        <textarea
                            value={draftContent}
                            onChange={e => setDraftContent(e.target.value)}
                            rows={opts.builtin ? 8 : 6}
                            className="w-full bg-slate-100 rounded-xl px-3 py-2 text-[13px] leading-relaxed text-slate-700 outline-none focus:ring-2 ring-violet-300 resize-none no-scrollbar"
                            placeholder={opts.builtin
                                ? '支持 {{char}} / {{user}} 身份占位符；__XXX__ 数据槽位照常回填'
                                : '这段提示词的正文……启用后原样注入 system prompt'}
                            autoFocus={draftName !== '新段落'}
                        />
                        <div className="flex justify-end gap-2 mt-2">
                            <button
                                onClick={() => setEditingId(null)}
                                className="px-3 py-1.5 rounded-xl bg-slate-200/80 text-slate-600 text-xs font-bold active:scale-95 transition-transform"
                            >
                                <X size={13} weight="bold" className="inline -mt-0.5 mr-0.5" />取消
                            </button>
                            <button
                                onClick={commitEdit}
                                className="px-3 py-1.5 rounded-xl bg-violet-500 text-white text-xs font-bold active:scale-95 transition-transform"
                            >
                                <Check size={13} weight="bold" className="inline -mt-0.5 mr-0.5" />保存
                            </button>
                        </div>
                    </div>
                ) : (
                    <button onClick={() => startEdit(p)} className="block w-full text-left px-3 pb-3">
                        <p className={`text-[13px] leading-relaxed whitespace-pre-wrap ${
                            p.content ? 'text-slate-600' : 'text-slate-400 italic'
                        }`}>
                            {p.content ? (p.content.length > 120 ? p.content.slice(0, 120) + '…' : p.content) : '（空段落，点这里填写）'}
                        </p>
                    </button>
                )}
            </div>
        );
    };

    // ---------- 预览视图视觉配置 ----------
    const SEGMENT_META: Record<string, { label: string; chip: string; hint: string }> = {
        stable: { label: 'stable · 稳定段', chip: 'bg-sky-100 text-sky-700 border-sky-200', hint: '人设/世界书/记忆——几轮甚至几天不变，进 prompt 前缀缓存' },
        volatileState: { label: 'volatile · 易变状态', chip: 'bg-amber-100 text-amber-700 border-amber-200', hint: '时间/天气/日程/音乐——每轮都变，进历史消息后的实时状态' },
        recencyTail: { label: 'recency · 收尾钢印', chip: 'bg-violet-100 text-violet-700 border-violet-200', hint: '模型开口前最后读到的纪律锚点' },
    };
    const ROLE_BADGE: Record<string, { label: string; cls: string }> = {
        content: { label: '参与内容', cls: 'bg-emerald-50 text-emerald-600 border-emerald-200' },
        discipline: { label: '结构纪律', cls: 'bg-violet-50 text-violet-600 border-violet-200' },
        disabled: { label: '未注入', cls: 'bg-slate-100 text-slate-400 border-slate-200' },
    };
    const SOURCE_DOT: Record<string, string> = {
        char: 'bg-violet-400', worldbook: 'bg-emerald-400', user: 'bg-pink-400',
        memory: 'bg-sky-400', preset: 'bg-amber-400', builtin: 'bg-slate-400',
        mcp: 'bg-teal-400', schedule: 'bg-orange-400', music: 'bg-fuchsia-400',
        group: 'bg-indigo-400', system: 'bg-slate-300', diary: 'bg-rose-400', realtime: 'bg-cyan-400',
    };

    const renderPreviewView = () => {
        const segOrder = ['stable', 'volatileState', 'recencyTail'] as const;
        return (
            <div className="flex-1 overflow-y-auto no-scrollbar px-4 py-3 pb-24 space-y-3">
                {/* 头部：角色 + 生成时间 + token 小计 */}
                <div className="rounded-2xl border border-white/60 bg-white/70 backdrop-blur-md px-4 py-3 space-y-2">
                    <div className="flex items-center gap-2">
                        <UserCircle size={18} className="text-violet-500" />
                        <span className="text-sm font-bold text-slate-800">{previewChar!.name} · 聊天注入预览</span>
                        <button
                            onClick={() => previewChar && loadPreview(previewChar, previewSim)}
                            className="ml-auto p-1.5 rounded-full hover:bg-slate-200/70 active:scale-90 transition-transform"
                            title="重新组装"
                        >
                            <ArrowsClockwise size={15} className={previewLoading ? 'text-violet-400 animate-spin' : 'text-slate-500'} />
                        </button>
                    </div>
                    <p className="text-[11px] text-slate-500 leading-relaxed">
                        角色时区 {previewData?.charTimeZone || '—'} · 角色本地时间 {previewData?.charNow || '—'} · {PROMPT_TOKEN_ESTIMATE_NOTE}
                    </p>
                    {previewData && (
                        <div className="flex items-center gap-2 flex-wrap pt-0.5">
                            {segOrder.map(seg => {
                                const t = previewData.totals[seg];
                                const total = Math.max(1, previewData.totals.all);
                                const pct = Math.round((t / total) * 100);
                                return (
                                    <span key={seg} className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${SEGMENT_META[seg].chip}`}>
                                        {SEGMENT_META[seg].label} ≈{t} tok ({pct}%)
                                    </span>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* 模拟最近对话输入 */}
                <div className="rounded-2xl border border-white/60 bg-white/70 backdrop-blur-md px-4 py-3 space-y-2">
                    <label className="text-xs font-bold text-slate-600 flex items-center gap-1.5">
                        <Stack size={13} className="text-violet-500" /> 模拟最近对话（每行一条，user / assistant 交替，用于世界书关键词命中演示）
                    </label>
                    <textarea
                        value={previewSim}
                        onChange={e => setPreviewSim(e.target.value)}
                        rows={3}
                        placeholder={'例：\n我们周末去爬山吧\n好呀，记得带上相机'}
                        className="w-full bg-slate-100 rounded-xl px-3 py-2 text-[13px] leading-relaxed text-slate-700 outline-none focus:ring-2 ring-violet-300 resize-none no-scrollbar"
                    />
                    <div className="flex justify-end">
                        <button
                            onClick={() => previewChar && loadPreview(previewChar, previewSim)}
                            className="px-3 py-1.5 rounded-xl bg-violet-500 text-white text-xs font-bold active:scale-95 transition-transform"
                        >
                            按这段对话重新扫描
                        </button>
                    </div>
                </div>

                {previewLoading && !previewData && (
                    <p className="text-center text-xs text-slate-400 pt-8">正在组装注入内容…</p>
                )}

                {/* 三段分组块列表 */}
                {previewData && segOrder.map(seg => {
                    const blocks = previewData.blocks.filter(b => b.segment === seg);
                    if (blocks.length === 0) return null;
                    return (
                        <div key={seg} className="space-y-2">
                            <div className="flex items-center gap-1.5 px-1 pt-1">
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${SEGMENT_META[seg].chip}`}>{SEGMENT_META[seg].label}</span>
                                <span className="text-[10px] text-slate-400">{blocks.length} 块 · {SEGMENT_META[seg].hint}</span>
                            </div>
                            {blocks.map(b => {
                                const expanded = expandedIds.has(b.id);
                                const badge = ROLE_BADGE[b.role];
                                const dot = SOURCE_DOT[b.sourceType] || 'bg-slate-300';
                                return (
                                    <div
                                        key={b.id}
                                        className={`rounded-2xl border backdrop-blur-md transition-shadow ${
                                            b.enabled ? 'bg-white/70 border-white/60 shadow-sm' : 'bg-white/40 border-white/40 opacity-75'
                                        }`}
                                    >
                                        <button
                                            onClick={() => toggleExpanded(b.id)}
                                            className="w-full text-left px-3 pt-2.5 pb-1.5"
                                        >
                                            <div className="flex items-center gap-1.5 flex-wrap">
                                                <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
                                                <span className="text-[13px] font-bold text-slate-800">{b.title}</span>
                                                <span className={`shrink-0 text-[9px] font-bold px-1.5 py-px rounded-full border ${badge.cls}`}>{badge.label}</span>
                                                <span className="ml-auto shrink-0 text-[10px] text-slate-400 font-mono">{b.enabled ? `~${b.tokenEstimate} tok` : '—'}</span>
                                            </div>
                                            <div className="mt-0.5 text-[10px] text-slate-400 truncate">
                                                {b.sourceLabel}{b.insertionPoint ? ` · ${b.insertionPoint}` : ''}{b.order !== undefined ? ` · 顺序 ${b.order}` : ''}
                                            </div>
                                        </button>
                                        {expanded && (
                                            <div className="px-3 pb-3 space-y-1.5">
                                                {b.hitInfo && (
                                                    <p className="text-[10px] font-bold text-emerald-600">{b.hitInfo}</p>
                                                )}
                                                {b.conditionNote && (
                                                    <p className="text-[10px] text-slate-400 leading-relaxed">{b.conditionNote}</p>
                                                )}
                                                <pre className="bg-slate-100 rounded-xl px-3 py-2 text-[11px] leading-relaxed text-slate-700 whitespace-pre-wrap break-words max-h-72 overflow-y-auto no-scrollbar font-sans">{b.content}</pre>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    );
                })}
            </div>
        );
    };

    return (
        <div className="h-full w-full bg-slate-100 flex flex-col">
            {/* 顶栏 */}
            <div className="px-4 pt-3 pb-3 bg-white/60 backdrop-blur-xl border-b border-white/40 shrink-0">
                <div className="flex items-center gap-2">
                    <button
                        onClick={closeApp}
                        className="p-2 rounded-full hover:bg-slate-200/70 active:scale-90 transition-transform"
                    >
                        <ArrowLeft size={22} weight="bold" className="text-slate-700" />
                    </button>
                    <h1 className="text-lg font-bold text-slate-800">预设</h1>
                    {previewChar ? (
                        <button
                            onClick={closePreview}
                            className="ml-auto px-3 py-1.5 rounded-full bg-white/80 border border-white/60 text-slate-600 text-xs font-bold active:scale-95 transition-transform"
                        >
                            返回管理
                        </button>
                    ) : (
                        <div className="ml-auto flex items-center gap-2">
                            <button
                                onClick={() => { if (previewCharRef.current) openPreview(previewCharRef.current); }}
                                className="p-2 rounded-full bg-white/80 border border-white/60 text-slate-600 hover:bg-slate-200/70 active:scale-90 transition-transform"
                                title="查看上次预览的角色"
                            >
                                <Eye size={17} weight="bold" />
                            </button>
                            <button
                                onClick={handleAdd}
                                className="p-2 rounded-full bg-violet-500 text-white shadow-sm hover:bg-violet-600 active:scale-90 transition-transform"
                                title="新增自定义段落"
                            >
                                <Plus size={18} weight="bold" />
                            </button>
                        </div>
                    )}
                </div>
                <p className="text-[11px] text-slate-500 mt-1.5 px-1">
                    {previewChar
                        ? '预览该角色聊天 system prompt 的完整注入清单——按三段式分组，点击卡片展开原文。'
                        : '内置提示词可直接编辑、随时一键恢复；自定义段落按顺序注入聊天 system prompt。'}
                </p>
            </div>

            {/* 角色选择弹层（进入预览前选择角色） */}
            {charPickerOpen && (
                <div className="absolute inset-0 z-40 flex items-end" onClick={() => setCharPickerOpen(false)}>
                    <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
                    <div
                        className="relative w-full max-h-[70%] bg-slate-100 rounded-t-3xl shadow-2xl flex flex-col animate-slide-in-bottom"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="shrink-0 px-4 pt-3 pb-2 flex items-center gap-2 border-b border-white/60">
                            <UserCircle size={17} className="text-violet-500" />
                            <span className="text-sm font-bold text-slate-700">选择要预览的角色</span>
                            <button
                                onClick={() => setCharPickerOpen(false)}
                                className="ml-auto p-1.5 rounded-full hover:bg-slate-200/70 active:scale-90 transition-transform"
                            >
                                <X size={15} weight="bold" className="text-slate-500" />
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto no-scrollbar px-4 py-2 pb-[max(12px,env(safe-area-inset-bottom))] space-y-1.5">
                            {pickerChars.length === 0 && (
                                <p className="text-center text-xs text-slate-400 py-8">还没有角色</p>
                            )}
                            {pickerChars.map(c => (
                                <button
                                    key={c.id}
                                    onClick={() => { setCharPickerOpen(false); openPreview(c); }}
                                    className="w-full text-left px-3 py-2.5 rounded-xl bg-white/70 border border-white/60 active:bg-violet-50 transition-colors"
                                >
                                    <span className="text-sm font-bold text-slate-700">{c.name}</span>
                                    {c.description && <span className="ml-2 text-[11px] text-slate-400 truncate">{c.description}</span>}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* 预览视图 */}
            {previewChar && renderPreviewView()}

            {/* 列表 */}
            {!previewChar && (
            <div className="flex-1 overflow-y-auto no-scrollbar px-4 py-3 pb-24 space-y-3">
                {loading && (
                    <p className="text-center text-xs text-slate-400 pt-8">加载中…</p>
                )}
                {!loading && presets.length === 0 && (
                    <div className="flex flex-col items-center pt-14 text-slate-400">
                        <NoteBlank size={44} weight="light" />
                        <p className="text-sm mt-3">还没有预设段落</p>
                        <p className="text-xs mt-1 text-slate-400/80">点右上角 + 建第一条</p>
                    </div>
                )}

                {/* 内置提示词：按分类分组 */}
                {grouped.map(g => {
                    const Icon = CATEGORY_ICON[g.meta.id];
                    return (
                        <div key={g.meta.id} className="space-y-3">
                            <div className="flex items-center gap-1.5 px-1 pt-2 first:pt-0">
                                <Icon size={14} weight="bold" className="text-violet-500" />
                                <span className="text-xs font-bold text-slate-500 tracking-wide">内置 · {g.meta.label}</span>
                                <span className="text-[10px] text-slate-400">{g.rows.length} 条</span>
                            </div>
                            {g.rows.map(p => renderCard(p, 0, { builtin: true, listLen: g.rows.length, movable: false }))}
                        </div>
                    );
                })}

                {/* 自定义段落 */}
                {(customRows.length > 0 || builtinRows.length === 0) && (
                    <div className="space-y-3">
                        {builtinRows.length > 0 && (
                            <div className="flex items-center gap-1.5 px-1 pt-2">
                                <Plus size={14} weight="bold" className="text-slate-400" />
                                <span className="text-xs font-bold text-slate-500 tracking-wide">自定义段落</span>
                                <span className="text-[10px] text-slate-400">{customRows.length} 条</span>
                            </div>
                        )}
                        {customRows.map((p, i) => renderCard(p, i, { builtin: false, listLen: customRows.length, movable: true }))}
                    </div>
                )}
            </div>
            )}
        </div>
    );
};

export default PresetApp;