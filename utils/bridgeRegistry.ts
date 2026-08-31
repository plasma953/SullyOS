/**
 * 外部连接桥注册表 —— 多桥清单的归一化与兼容读取。
 *
 * v1 时代 apiConfig.bridge 是单桥；多桥化后新增 apiConfig.bridges 数组。
 * 这里收敛两条规则：
 *   1. getEffectiveBridges：读「有效桥清单」的唯一入口 —— bridges 数组优先，
 *      空/缺省时回退旧 bridge 单桥（老配置零迁移照常工作）。
 *   2. normalizeBridges：写盘前的整理 —— 补 id、丢空行、去重 id。
 * 旧 bridge 字段在保存多桥配置时被显式清空（bridge: undefined），
 * JSON.stringify 会丢掉 undefined 字段，存储里不会留双份。
 */
import type { APIConfig, BridgeConfig } from '../types';

export const makeBridgeId = (): string =>
    `bridge_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export const getEffectiveBridges = (apiConfig: Pick<APIConfig, 'bridges' | 'bridge'>): BridgeConfig[] => {
    if (Array.isArray(apiConfig.bridges) && apiConfig.bridges.length > 0) {
        return apiConfig.bridges.filter((b) => b && typeof b === 'object');
    }
    // 旧单桥兼容：有 url 或开着都算一条，转成单元素数组。
    if (apiConfig.bridge && (apiConfig.bridge.url || apiConfig.bridge.enabled)) {
        return [{ ...apiConfig.bridge }];
    }
    return [];
};

export const normalizeBridges = (bridges?: BridgeConfig[] | null): BridgeConfig[] | undefined => {
    if (!Array.isArray(bridges)) return undefined;
    const cleaned = bridges
        .filter((b) => b && typeof b.url === 'string' && b.url.trim())
        .map((b) => ({
            ...b,
            id: b.id || makeBridgeId(),
            name: String(b.name || '').trim() || '未命名桥',
            url: b.url.trim().replace(/\/+$/, ''),
            token: b.token && String(b.token).trim() ? String(b.token).trim() : undefined,
            healthPath: b.healthPath && String(b.healthPath).trim() ? String(b.healthPath).trim() : '/',
            enabled: b.enabled === true,
        }));
    const seen = new Set<string>();
    for (const b of cleaned) {
        while (b.id && seen.has(b.id)) b.id = makeBridgeId();
        if (b.id) seen.add(b.id);
    }
    return cleaned;
};
