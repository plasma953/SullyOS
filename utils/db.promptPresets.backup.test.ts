import { describe, it, expect, beforeEach } from 'vitest';
import { DB, openDB } from './db';
import type { PromptPreset } from '../types';

// Step 5 收口的回归钉子：prompt_presets 是 v72 新增 store，导出/导入两侧的白名单
// 之前都没登记它（正是本步要杜绝的「新 store 漏备」模式）。
// 走「真实链路」：exportFullData → JSON → importFullData → getPromptPresets，
// 与 db.charGroups.test.ts 同款 round-trip 口径。

describe('提示词段落预设 (prompt_presets) 导出/导入 round-trip', () => {
    beforeEach(async () => {
        // 清场，避免跨用例残留串味
        const db = await openDB();
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction('prompt_presets', 'readwrite');
            tx.objectStore('prompt_presets').clear();
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    });

    it('exportFullData 导出 promptPresets，importFullData 后原样恢复（含顺序与启停）', async () => {
        const presets: PromptPreset[] = [
            { id: 'pp-rt-1', name: '世界观', content: '故事发生在近未来……', order: 0, enabled: true, createdAt: 1718900000000, updatedAt: 1718900000000 },
            { id: 'pp-rt-2', name: '文风', content: '用克制的白描。', order: 1, enabled: false, createdAt: 1718900000000, updatedAt: 1718900000000 },
        ];
        for (const p of presets) await DB.savePromptPreset(p);

        // 1) 导出 + 模拟写文件/读文件（结构化克隆断链，暴露引用泄漏）
        const exported = await DB.exportFullData();
        const onDisk = JSON.parse(JSON.stringify(exported));
        const rows = onDisk.promptPresets as PromptPreset[];
        expect(rows).toHaveLength(2);
        expect(rows.find(r => r.id === 'pp-rt-1')?.content).toBe('故事发生在近未来……');
        expect(rows.find(r => r.id === 'pp-rt-2')?.enabled).toBe(false);

        // 2) 清掉本地（模拟换设备）再导入
        await DB.deletePromptPreset('pp-rt-1');
        await DB.deletePromptPreset('pp-rt-2');
        expect(await DB.getPromptPresets()).toHaveLength(0);
        await DB.importFullData(onDisk as any, {});

        // 3) 导入后内容 / order / enabled 全部还原
        const restored = await DB.getPromptPresets();
        expect(restored).toHaveLength(2);
        expect(restored.map(p => p.id)).toEqual(['pp-rt-1', 'pp-rt-2']); // getPromptPresets 按 order 升序
        expect(restored[0]).toMatchObject({ name: '世界观', order: 0, enabled: true });
        expect(restored[1]).toMatchObject({ name: '文风', order: 1, enabled: false });
    });

    it('空 store 导出不产生 promptPresets 字段，导入端对 undefined 无感', async () => {
        const exported = await DB.exportFullData();
        const onDisk = JSON.parse(JSON.stringify(exported));
        expect(onDisk.promptPresets).toEqual([]);

        await DB.importFullData(onDisk as any, {});
        expect(await DB.getPromptPresets()).toHaveLength(0);
    });
});
