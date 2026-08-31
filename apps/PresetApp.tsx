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
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
    ArrowLeft, Plus, Trash, CaretUp, CaretDown, PencilSimple,
    Check, X, NoteBlank, ArrowCounterClockwise,
    ChatCircle, Heart, MusicNote, SpeakerHigh, Brain, BellRinging,
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
import type { PromptPreset } from '../types';

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
                    <button
                        onClick={handleAdd}
                        className="ml-auto p-2 rounded-full bg-violet-500 text-white shadow-sm hover:bg-violet-600 active:scale-90 transition-transform"
                        title="新增自定义段落"
                    >
                        <Plus size={18} weight="bold" />
                    </button>
                </div>
                <p className="text-[11px] text-slate-500 mt-1.5 px-1">
                    内置提示词可直接编辑、随时一键恢复；自定义段落按顺序注入聊天 system prompt。
                </p>
            </div>

            {/* 列表 */}
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
        </div>
    );
};

export default PresetApp;