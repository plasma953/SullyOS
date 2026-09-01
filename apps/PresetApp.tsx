/**
 * 「预设」App —— 提示词总集（可编辑合集）。
 *
 * 改版：预设应用是一个**合集**——每条提示词片段都显示全文，支持逐条自主编辑；
 * 顶部「拼接顺序」流程条明示所有片段如何按顺序拼成最终 system prompt。
 *
 * 注入路径（拼接顺序的真实来源，UI 与代码同步维护）：
 * - 自定义段落（无 sourceKey）：拼在角色卡之后、易变状态之前（chatPrompts P3 段）。
 * - chat.steel*：聊天钢印，拼在 system prompt 末尾（模型开口前最后读到）。
 * - voice.*：语音指南，注入对应语音功能的提示词块。
 * - memory.* / amsg.*：技术模板，按 resolveTechnicalPrompt 在各自功能内替换默认值。
 * 数据存 IndexedDB `prompt_presets` store（v72），随备份动态枚举自动带走。
 *
 * UI 遵循原作玻璃拟态风格：slate 底 + 白/20 玻璃卡片 + Phosphor 线性图标。
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
    ArrowLeft, Plus, Trash, CaretUp, CaretDown, PencilSimple,
    Check, X, NoteBlank, Eye, Info,
} from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import type { PromptPreset } from '../types';
import {
    BUILTIN_PROMPT_ENTRIES, PROMPT_CATEGORY_META, type PromptCategory,
} from '../utils/promptPresetCatalog';
import { invalidatePromptPresetCache, applyBuiltinDefaultsToPreset } from '../utils/promptPresetRuntime';

/** 内置条目在各注入点的位置说明（order → 拼接位置文案，与 chatPrompts 实际逻辑同步维护） */
const BUILTIN_INJECTION_WHERE: Record<string, string> = {
    'chat.steelExpression': '聊天 · recency 尾部（模型开口前最后读到的内容之一）',
    'chat.steelYourself': '聊天 · recency 尾部（紧跟「关于对方的表达」之后）',
    'date.digDeeper': '约会模式 · 深挖块（见面提示词内）',
    'song.craftRules': '写歌 · 每次创作或点评前',
    'voice.minimax': '语音 · MiniMax 合成前注入',
    'voice.fish': '语音 · Fish 合成前注入',
    'voice.elevenlabsV3': '语音 · ElevenLabs v3 注入',
    'voice.elevenlabsStd': '语音 · ElevenLabs 标准版注入',
    'voice.date': '约会语音 · 注入约会提示词',
    'memory.reflectTask': '记忆 · 反刍任务模板',
    'memory.personalityDetect': '记忆 · 人格检测模板',
    'memory.extractionRules': '记忆 · 抽取规则模板',
    'memory.extractionEntityRule': '记忆 · 实体抽取规则模板',
    'memory.extractionMain': '记忆 · 抽取主模板',
    'memory.recallRouter': '记忆 · 检索路由模板',
    'amsg.emotionEval': '主动消息 · 情绪评估主模板',
    'amsg.emotionEvalMindful': '主动消息 · 情绪评估（正念模式）',
    'amsg.emotionEvalLiving': '主动消息 · 情绪评估（生活模式）',
    'chat.perspectiveTool': '聊天 · ChatApp 行为规范内（透视窗使用指南）',
    'rel.genGuide': '人物关系 · 生成任务模板（神经连接 → 人物关系）',
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
    /** 当前展开的片段 id（展示态默认收起正文，点卡片切换展开/收起） */
    const [expandedId, setExpandedId] = useState<string | null>(null);
    /** 拼接顺序面板展开状态 */
    const [showOrderMap, setShowOrderMap] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
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
            invalidatePromptPresetCache();
            if (msg) addToast(msg, 'success');
        } catch (e: any) {
            addToast(e?.message || '保存失败', 'error');
        }
    }, [addToast]);

    const handleAdd = () => {
        const now = Date.now();
        const item: PromptPreset = {
            id: crypto.randomUUID(),
            name: '新段落',
            content: '',
            order: (presets.length ? Math.max(...presets.map(p => p.order ?? 0)) : 0) + 1,
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

    const toggleEnabled = (id: string) => {
        persist(presets.map(p => p.id === id
            ? { ...p, enabled: !p.enabled, updatedAt: Date.now() } : p));
    };

    /** 上下移：交换相邻两项的 order（按当前展示顺序操作，写回双方）。 */
    const move = (index: number, dir: -1 | 1) => {
        const target = index + dir;
        if (target < 0 || target >= presets.length) return;
        const next = [...presets];
        const a = next[index];
        const b = next[target];
        const tmp = a.order;
        next[index] = { ...b, order: tmp, updatedAt: Date.now() };
        next[target] = { ...a, order: b.order, updatedAt: Date.now() };
        persist(next);
    };

    const startEdit = (p: PromptPreset) => {
        setEditingId(p.id);
        setDraftName(p.name);
        setDraftContent(p.content);
        setExpandedId(p.id);
    };

    const commitEdit = () => {
        if (!editingId) return;
        const name = draftName.trim() || '未命名段落';
        persist(presets.map(p => p.id === editingId
            ? { ...p, name, content: draftContent, updatedAt: Date.now() } : p),
            '已保存');
        setEditingId(null);
    };
    // ── 拼接顺序图（可视化拼接顺序）──
    const sorted = [...presets].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const activeCustom = sorted.filter(p => !p.sourceKey && p.enabled && (p.content || '').trim());
    const chatSteels = sorted.filter(p => p.sourceKey?.startsWith('chat.steel'));
    const otherBuiltin = sorted.filter(p => p.sourceKey && !p.sourceKey!.startsWith('chat.steel'));

    const CATEGORY_COLOR: Record<string, string> = {
        chat: 'bg-violet-50 text-violet-600',
        date: 'bg-rose-50 text-rose-500',
        song: 'bg-sky-50 text-sky-600',
        voice: 'bg-emerald-50 text-emerald-600',
        memory: 'bg-amber-50 text-amber-600',
        amsg: 'bg-indigo-50 text-indigo-600',
    };

    const categoryChip = (p: PromptPreset) => {
        if (!p.sourceKey) {
            return <span className="px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-slate-100 text-slate-500 shrink-0">自定义</span>;
        }
        const meta = PROMPT_CATEGORY_META.find(c => c.id === (p.category as PromptCategory));
        if (!meta) return null;
        return <span className={`px-1.5 py-0.5 rounded-md text-[9px] font-bold shrink-0 ${CATEGORY_COLOR[p.category || ''] || 'bg-slate-100 text-slate-500'}`}>{meta.label}</span>;
    };

    const chipFor = (p: PromptPreset) => (
        <button
            key={p.id}
            onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}
            className={`px-2 py-0.5 rounded-full text-[10px] font-bold max-w-[130px] truncate transition-all active:scale-95 ${
                p.enabled ? 'bg-white text-slate-600 shadow-sm' : 'bg-slate-100 text-slate-300 line-through'
            }`}
        >
            {p.name}
        </button>
    );

    const orderStages: { n: number; title: string; desc?: string; chips?: PromptPreset[] }[] = [
        { n: 1, title: '角色卡骨架', desc: '身份 · 核心性格 · 世界观 · 世界书 · 印象 · 记忆库（角色页编辑）' },
        { n: 2, title: '自定义段落', chips: activeCustom, desc: activeCustom.length ? undefined : '（暂无启用中的段落 · 在下方创建）' },
        { n: 3, title: '实时状态', desc: '当前时间 · 记忆召回 · 情绪底色 · 天气 · 日程 · 音乐' },
        { n: 4, title: '情境与模式块', desc: '世界书触发块 · 表情包 · 双语 / HTML / 思考链等，按情境插入' },
        { n: 5, title: 'recency 尾部（钢印）', chips: chatSteels, desc: '模型开口前最后读到的内容' },
        { n: 6, title: '独立注入点', chips: otherBuiltin, desc: '语音 / 记忆 / 主动消息 / 约会 / 写歌模板，在各功能注入点生效' },
    ];

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
                    <h1 className="text-lg font-bold text-slate-800">提示词</h1>
                    <button
                        onClick={handleAdd}
                        className="ml-auto p-2 rounded-full bg-violet-500 text-white shadow-sm hover:bg-violet-600 active:scale-90 transition-transform"
                        title="新增段落"
                    >
                        <Plus size={18} weight="bold" />
                    </button>
                </div>
                {/* 拼接顺序入口条 */}
                <button
                    onClick={() => setShowOrderMap(s => !s)}
                    className="mt-2 w-full flex items-center justify-between px-3 py-2 rounded-xl bg-violet-50/70 hover:bg-violet-50 active:scale-[0.99] transition-all"
                >
                    <span className="flex items-center gap-1.5 text-xs font-bold text-violet-600">
                        <Eye size={13} weight="bold" /> 拼接顺序 · 如何拼成最终 system prompt
                    </span>
                    <CaretDown size={13} weight="bold" className={`text-violet-400 transition-transform ${showOrderMap ? 'rotate-180' : ''}`} />
                </button>
                {showOrderMap && (
                    <div className="mt-2 px-3 py-2.5 rounded-xl bg-white/70 border border-white/60 space-y-2">
                        {orderStages.map(st => (
                            <div key={st.n} className="flex items-start gap-2">
                                <div className="w-4 h-4 rounded-full bg-violet-500 text-white text-[9px] font-bold flex items-center justify-center shrink-0 mt-0.5">{st.n}</div>
                                <div className="min-w-0 flex-1">
                                    <p className="text-[11px] font-bold text-slate-700 leading-tight">{st.title}</p>
                                    {st.desc && <p className="text-[9.5px] text-slate-400 leading-tight">{st.desc}</p>}
                                    {st.chips && st.chips.length > 0 && (
                                        <div className="flex flex-wrap gap-1 mt-1">{st.chips.map(chipFor)}</div>
                                    )}
                                </div>
                            </div>
                        ))}
                        <p className="text-[9.5px] text-slate-400 pt-1.5 border-t border-slate-100">
                            各段全文都在下方卡片里，逐条可编辑；点击灰点可跳到对应段落。
                        </p>
                    </div>
                )}
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
                {sorted.map((p, i) => {
                    const editing = editingId === p.id;
                    const expanded = expandedId === p.id;
                    const builtin = p.sourceKey ? BUILTIN_PROMPT_ENTRIES.find(e => e.sourceKey === p.sourceKey) : undefined;
                    const customized = builtin ? (p.content ?? '') !== builtin.content : false;
                    const where = p.sourceKey ? BUILTIN_INJECTION_WHERE[p.sourceKey] : undefined;
                    return (
                        <div
                            key={p.id}
                            className={`rounded-2xl border backdrop-blur-md transition-shadow ${
                                p.enabled
                                    ? 'bg-white/70 border-white/60 shadow-sm'
                                    : 'bg-white/40 border-white/40 opacity-70'
                            }`}
                        >
                            {/* 卡头：名称 + 分类 + 启停 + 排序 */}
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
                                    <div
                                        onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}
                                        className="flex items-center gap-1.5 min-w-0 flex-1 cursor-pointer"
                                    >
                                        <span className="text-sm font-bold text-slate-800 truncate">{p.name}</span>
                                        {categoryChip(p)}
                                        {customized && (
                                            <span className="px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-amber-50 text-amber-500 shrink-0">已改</span>
                                        )}
                                    </div>
                                )}
                                {/* 编辑 */}
                                {!editing && (
                                    <button
                                        onClick={() => startEdit(p)}
                                        className="p-1.5 rounded-full hover:bg-slate-200/70 active:scale-90 transition-transform shrink-0"
                                        title="编辑全文"
                                    >
                                        <PencilSimple size={13} className="text-slate-500" />
                                    </button>
                                )}
                                {/* 上下移 */}
                                <div className="flex flex-col -space-y-1 shrink-0">
                                    <button
                                        onClick={() => move(i, -1)}
                                        disabled={i === 0}
                                        className="p-0.5 rounded hover:bg-slate-200/70 disabled:opacity-20 active:scale-90 transition-transform"
                                    >
                                        <CaretUp size={13} weight="bold" className="text-slate-500" />
                                    </button>
                                    <button
                                        onClick={() => move(i, 1)}
                                        disabled={i === sorted.length - 1}
                                        className="p-0.5 rounded hover:bg-slate-200/70 disabled:opacity-20 active:scale-90 transition-transform"
                                    >
                                        <CaretDown size={13} weight="bold" className="text-slate-500" />
                                    </button>
                                </div>
                                {/* 启停 */}
                                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                                    <input
                                        type="checkbox"
                                        className="opacity-0 w-0 h-0 peer"
                                        checked={p.enabled}
                                        onChange={() => toggleEnabled(p.id)}
                                    />
                                    <div className="absolute inset-0 bg-slate-200 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-violet-500"></div>
                                    <div className="w-8 h-5"></div>
                                </label>
                                {/* 删除 */}
                                <button
                                    onClick={() => handleDelete(p.id)}
                                    className="p-1.5 rounded-full hover:bg-red-50 active:scale-90 transition-transform shrink-0"
                                    title="删除"
                                >
                                    <Trash size={15} className="text-red-400" />
                                </button>
                            </div>

                            {/* 正文：编辑态 textarea / 展示态全文（长文收起）*/}
                            {editing ? (
                                <div className="px-3 pb-3">
                                    <textarea
                                        value={draftContent}
                                        onChange={e => setDraftContent(e.target.value)}
                                        rows={8}
                                        className="w-full bg-slate-100 rounded-xl px-3 py-2 text-[13px] leading-relaxed text-slate-700 outline-none focus:ring-2 ring-violet-300 resize-none no-scrollbar"
                                        placeholder="这段提示词的正文……启用后按上方拼接顺序注入"
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
                                <div className="px-3 pb-3">
                                    {where && (
                                        <p className="text-[10px] text-slate-400 mb-1 flex items-start gap-1 leading-tight">
                                            <Info size={11} weight="bold" className="shrink-0 mt-0.5" />{where}
                                        </p>
                                    )}
                                    <p
                                        onClick={() => p.content && p.content.length > 120 && setExpandedId(expandedId === p.id ? null : p.id)}
                                        className={`text-[13px] leading-relaxed whitespace-pre-wrap ${
                                            p.content ? 'text-slate-600' : 'text-slate-400 italic'
                                        }`}
                                    >
                                        {p.content
                                            ? ((expanded || p.content.length <= 120) ? p.content : p.content.slice(0, 120) + '……')
                                            : '（空段落，点右上角编辑填写）'}
                                    </p>
                                    {p.content && p.content.length > 120 && (
                                        <button
                                            onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}
                                            className="mt-1 text-[10px] font-bold text-violet-500 active:scale-95 transition-transform"
                                        >
                                            {expanded ? '收起' : '展开全文'}
                                        </button>
                                    )}
                                    {builtin && customized && (
                                        <button
                                            onClick={() => persist(presets.map(x => x.id === p.id ? applyBuiltinDefaultsToPreset(x) : x), '已恢复内置默认')}
                                            className="mt-1.5 block text-[10px] font-bold text-slate-400 hover:text-slate-600 active:scale-95 transition-transform"
                                        >
                                            恢复内置默认文案
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default PresetApp;