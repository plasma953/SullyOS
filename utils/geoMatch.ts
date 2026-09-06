/**
 * geoMatch — LLM 生成的地点自由文本 ↔ 真实 POI 的对齐器（纯函数）
 *
 * 双管机制的第二管：日程 / 世界 / 见面 prompt 里已经注入了城市地点库，
 * 生成之后再把解析出的地点串与库做一次归一化模糊匹配——命中就挂上真实
 * POI（UI 显示真实地址/距离），没命中就原样保留自由文本，绝不强行安。
 */

/** 归一化：去空白与中英文标点、统一小写、去尾部「市」字（"南京市"→"南京"）。 */
export const normalizePlaceText = (s: unknown): string => {
    if (typeof s !== 'string') return '';
    let t = s.replace(/[\s\p{P}]/gu, '').toLowerCase();
    if (t.length > 2 && t.endsWith('市')) t = t.slice(0, -1);
    return t;
};

/** 短串编辑距离（中文地名都很短，直接 O(n*m) 动态规划）。 */
export const editDistance = (a: string, b: string): number => {
    if (a === b) return 0;
    const m = a.length;
    const n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    const dp: number[] = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
        let prev = dp[0];
        dp[0] = i;
        for (let j = 1; j <= n; j++) {
            const cur = dp[j];
            dp[j] = Math.min(
                dp[j] + 1,
                dp[j - 1] + 1,
                prev + (a[i - 1] === b[j - 1] ? 0 : 1),
            );
            prev = cur;
        }
    }
    return dp[n];
};

export interface PlaceMatchResult<T> {
    place: T;
    /** 'exact' 全等 / 'contains' 互相包含 / 'fuzzy' 编辑距离命中。 */
    level: 'exact' | 'contains' | 'fuzzy';
}

/**
 * 地点串 → 地点库分级匹配。
 * 短查询（≤2 字，如"公园"）不做 contains 匹配——否则"公园"会吞掉库里所有公园。
 * fuzzy 阈值按较短串长度 25% 取整（至少容 1 字），再短就只认全等/包含。
 */
export const matchPlace = <T extends { name: string }>(
    text: unknown,
    places: T[],
): PlaceMatchResult<T> | null => {
    const q = normalizePlaceText(text);
    if (!q || places.length === 0) return null;

    const withNorm = places
        .map((p) => ({ p, n: normalizePlaceText(p.name) }))
        .filter((x) => x.n.length > 0);
    if (withNorm.length === 0) return null;

    const exact = withNorm.find((x) => x.n === q);
    if (exact) return { place: exact.p, level: 'exact' };

    if (q.length > 2) {
        const contains = withNorm
            .filter((x) => x.n.includes(q) || q.includes(x.n))
            // 名字越长越具体：命中多个时取最长的，避免"公园"吞掉"滨河公园"
            .sort((a, b) => b.n.length - a.n.length);
        if (contains.length > 0) return { place: contains[0].p, level: 'contains' };
    }

    let best: { p: T; d: number } | null = null;
    for (const x of withNorm) {
        const d = editDistance(q, x.n);
        const threshold = Math.max(1, Math.floor(Math.min(q.length, x.n.length) * 0.25));
        if (d <= threshold && (!best || d < best.d)) {
            best = { p: x.p, d };
        }
    }
    if (best) return { place: best.p, level: 'fuzzy' };
    return null;
};
