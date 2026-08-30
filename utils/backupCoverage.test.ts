import { describe, it, expect } from 'vitest';
import {
    findUnregisteredBackupStores,
    knownBackupStoreFieldMap,
    excludedBackupStores,
    exportSwitchDefaultCase,
    SINGLETON_BACKUP_STORES,
} from './backupCoverage';

// Step 5 备份覆盖兜底的纯函数钉子：
// findUnregisteredBackupStores 按 db.objectStoreNames 动态枚举补齐登记清单遗漏——
// 历史上剧院/家园/生活记录/角色小红书主页都从这份清单漏过，导出的备份整类数据丢失。

describe('findUnregisteredBackupStores（备份覆盖兜底）', () => {
    it('把登记清单遗漏、导入端已支持的 store 补齐，保持枚举顺序', () => {
        const dbStores = ['characters', 'prompt_presets', 'xhs_owned_posts', 'worlds'];
        const registered = ['characters', 'worlds'];
        expect(findUnregisteredBackupStores(dbStores, registered)).toEqual(['prompt_presets', 'xhs_owned_posts']);
    });

    it('EXCLUDED（blob_assets / api_call_log）永不进包', () => {
        const missing = findUnregisteredBackupStores(['blob_assets', 'api_call_log'], []);
        expect(missing).toEqual([]);
        expect(excludedBackupStores().has('blob_assets')).toBe(true);
        expect(excludedBackupStores().has('api_call_log')).toBe(true);
    });

    it('导入端尚无恢复语义的未知 store 不进包（保证 roundtrip 完整）', () => {
        expect(findUnregisteredBackupStores(['totally_new_store_v99'], [])).toEqual([]);
    });

    it('已登记的 store 不重复出现', () => {
        expect(findUnregisteredBackupStores(['messages'], ['messages', 'prompt_presets'])).toEqual([]);
    });

    it('本轮实查的关键字段都在 KNOWN 映射里', () => {
        const known = knownBackupStoreFieldMap();
        expect(known['prompt_presets']).toBe('promptPresets');
        expect(known['xhs_owned_posts']).toBe('xhsOwnedPosts');
        expect(known['memory_vectors']).toBeUndefined(); // 向量走二进制旁路，不入普通映射
    });
});

describe('exportSwitchDefaultCase（主 switch 漂移防护）', () => {
    it('数组 store 整组落包', () => {
        const backupData: Record<string, any> = {};
        const hit = exportSwitchDefaultCase(backupData, 'prompt_presets', [{ id: 'a' }]);
        expect(hit).toBe(true);
        expect(backupData.promptPresets).toEqual([{ id: 'a' }]);
    });

    it('单例 store 取首条（与 vr_music / life_sim 显式 case 同语义）', () => {
        const backupData: Record<string, any> = {};
        expect(SINGLETON_BACKUP_STORES.has('life_sim')).toBe(true);
        exportSwitchDefaultCase(backupData, 'life_sim', [{ id: 'main' }]);
        expect(backupData.lifeSimState).toEqual({ id: 'main' });
    });

    it('单例 store 空表落 undefined 而非 null', () => {
        const backupData: Record<string, any> = {};
        exportSwitchDefaultCase(backupData, 'vr_music', []);
        expect(backupData.vrMusicRoom).toBeUndefined();
    });

    it('未知 store 不落包（返回 false）', () => {
        const backupData: Record<string, any> = {};
        expect(exportSwitchDefaultCase(backupData, 'unknown_store', [1])).toBe(false);
        expect(Object.keys(backupData)).toEqual([]);
    });
});
