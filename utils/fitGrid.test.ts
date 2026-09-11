import { describe, expect, it } from 'vitest';
import { computeFitGrid } from './fitGrid';

describe('computeFitGrid', () => {
    it('空列表返回空网格', () => {
        expect(computeFitGrid({ width: 800, height: 600, count: 0 }))
            .toEqual({ cols: 1, rows: 0, cell: 200, scroll: false });
    });

    it('宽裕容器取单元格最大方案，一屏放下', () => {
        expect(computeFitGrid({ width: 1400, height: 980, count: 34 }))
            .toEqual({ cols: 7, rows: 5, cell: 188, scroll: false });
    });

    it('受限容器按可行列数缩放，不滚动', () => {
        const result = computeFitGrid({ width: 596, height: 728, count: 34 });
        expect(result.cols).toBe(5);
        expect(result.rows).toBe(7);
        expect(result.cell).toBeCloseTo(95.43, 2);
        expect(result.scroll).toBe(false);
    });

    it('极小容器降级为最小单元格 + 内部滚动', () => {
        expect(computeFitGrid({ width: 400, height: 300, count: 34 }))
            .toEqual({ cols: 4, rows: 9, cell: 84, scroll: true });
    });

    it('单元格达到上限后优先方阵', () => {
        expect(computeFitGrid({ width: 3000, height: 2000, count: 8 }))
            .toEqual({ cols: 3, rows: 3, cell: 200, scroll: false });
    });

    it('宽或高为 0 时直接进入滚动兜底', () => {
        expect(computeFitGrid({ width: 0, height: 600, count: 5 }))
            .toEqual({ cols: 1, rows: 5, cell: 84, scroll: true });
    });
});
