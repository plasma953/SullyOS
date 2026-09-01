/**
 * 「预设」App —— 提示词段落预设管理。
 *
 * 这里维护的每一条是一个可复用的 system prompt 段落：内容、顺序、启停。
 * 注入点在 utils/chatPrompts.ts 的 buildSystemPrompt（enabled 的按 order 排序拼接）。
 * 数据存 IndexedDB `prompt_presets` store（v72），随备份动态枚举自动带走。
 *
 * UI 遵循原作玻璃拟态风格：slate 底 + 白/20 玻璃卡片 + Phosphor 线性图标。
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
    ArrowLeft, Plus, Trash, CaretUp, CaretDown, PencilSimple,
    Check, X, NoteBlank,
} from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import type { PromptPreset } from '../types';

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
        DB.deletePromptPreset(id).catch(() => addToast('删除失败', 'error'));
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
    };

    const commitEdit = () => {
        if (!editingId) return;
        const name = draftName.trim() || '未命名段落';
        persist(presets.map(p => p.id === editingId
            ? { ...p, name, content: draftContent, updatedAt: Date.now() } : p),
            '已保存');
        setEditingId(null);
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
                        title="新增段落"
                    >
                        <Plus size={18} weight="bold" />
                    </button>
                </div>
                <p className="text-[11px] text-slate-500 mt-1.5 px-1">
                    启用的段落按顺序注入聊天 system prompt；关掉即停用，随时可再打开。
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
                {presets.map((p, i) => {
                    const editing = editingId === p.id;
                    return (
                        <div
                            key={p.id}
                            className={`rounded-2xl border backdrop-blur-md transition-shadow ${
                                p.enabled
                                    ? 'bg-white/70 border-white/60 shadow-sm'
                                    : 'bg-white/40 border-white/40 opacity-70'
                            }`}
                        >
                            {/* 卡头：名称 + 开关 + 排序 */}
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
                                        disabled={i === presets.length - 1}
                                        className="p-0.5 rounded hover:bg-slate-200/70 disabled:opacity-20 active:scale-90 transition-transform"
                                    >
                                        <CaretDown size={13} weight="bold" className="text-slate-500" />
                                    </button>
                                </div>
                                {/* 启停开关（沿用设置页 violet 口径） */}
                                <label className="relative inline-block w-9 h-5 shrink-0 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        className="opacity-0 w-0 h-0 peer"
                                        checked={p.enabled}
                                        onChange={() => toggleEnabled(p.id)}
                                    />
                                    <div className="absolute inset-0 bg-slate-200 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-violet-500"></div>
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

                            {/* 正文：编辑态 textarea / 展示态摘要 */}
                            {editing ? (
                                <div className="px-3 pb-3">
                                    <textarea
                                        value={draftContent}
                                        onChange={e => setDraftContent(e.target.value)}
                                        rows={6}
                                        className="w-full bg-slate-100 rounded-xl px-3 py-2 text-[13px] leading-relaxed text-slate-700 outline-none focus:ring-2 ring-violet-300 resize-none no-scrollbar"
                                        placeholder="这段提示词的正文……启用后原样注入 system prompt"
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
                })}
            </div>
        </div>
    );
};

export default PresetApp;
