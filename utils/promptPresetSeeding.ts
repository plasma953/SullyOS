/**
 * 内置提示词条目的一次性播种（首次加载 / 版本升级补缺）。
 *
 * 规则：prompt_presets 里缺哪个 sourceKey 就补哪条——已存在的行**永不覆盖**，
 * 用户对内容的编辑、启停、排序都原样保留。OSContext 启动时调用，跑一次成本
 * 是一次全表读 + （冷启动时）18 次写，之后秒回。
 */
import { DB } from './db';
import { BUILTIN_PROMPT_ENTRIES } from './promptPresetCatalog';
import { invalidatePromptPresetCache } from './promptPresetRuntime';
import type { PromptPreset } from '../types';

export const seedBuiltinPromptPresets = async (): Promise<void> => {
    try {
        const rows = await DB.getPromptPresets();
        const present = new Set<string>();
        for (const r of rows || []) {
            if (r.sourceKey) present.add(r.sourceKey);
        }
        const now = Date.now();
        let seeded = 0;
        for (const entry of BUILTIN_PROMPT_ENTRIES) {
            if (present.has(entry.sourceKey)) continue;
            const row: PromptPreset = {
                id: crypto.randomUUID(),
                sourceKey: entry.sourceKey,
                category: entry.category,
                name: entry.name,
                content: entry.content,
                order: entry.order,
                enabled: true,
                builtinVersion: entry.builtinVersion,
                createdAt: now,
                updatedAt: now,
            };
            await DB.savePromptPreset(row);
            seeded++;
        }
        if (seeded > 0) {
            invalidatePromptPresetCache();
            console.log(`[PresetPrompt] seeded ${seeded} builtin prompt entries`);
        }
    } catch (e) {
        console.warn('[PresetPrompt] seeding builtin entries failed:', e);
    }
};
