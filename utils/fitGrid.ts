/**
 * 桌面主页应用网格的自适应计算：在容器尺寸里选「单元格最大」的列数，
 * 全部 App 默认一屏放下；小于最小单元格时降级为定宽 + 容器内部滚动。
 */

export interface FitGridInput {
    width: number;
    height: number;
    count: number;
    gapX?: number;
    gapY?: number;
    minCell?: number;
    maxCell?: number;
}

export interface FitGridResult {
    cols: number;
    rows: number;
    cell: number;
    scroll: boolean;
}

export const computeFitGrid = ({
    width,
    height,
    count,
    gapX = 12,
    gapY = 10,
    minCell = 84,
    maxCell = 200,
}: FitGridInput): FitGridResult => {
    if (count <= 0) return { cols: 1, rows: 0, cell: maxCell, scroll: false };
    if (width <= 0 || height <= 0) return { cols: 1, rows: count, cell: minCell, scroll: true };

    let best: FitGridResult = { cols: 1, rows: count, cell: 0, scroll: false };
    const maxCols = Math.min(12, count);
    for (let cols = 1; cols <= maxCols; cols++) {
        const rows = Math.ceil(count / cols);
        const cellW = (width - gapX * (cols - 1)) / cols;
        const cellH = (height - gapY * (rows - 1)) / rows;
        const cell = Math.min(cellW, cellH, maxCell);
        const betterCell = cell > best.cell + 0.5;
        const balancedTie = Math.abs(cell - best.cell) <= 0.5
            && Math.abs(cols - rows) < Math.abs(best.cols - best.rows);
        if (betterCell || balancedTie) {
            best = { cols, rows, cell, scroll: false };
        }
    }
    if (best.cell >= minCell) return best;

    const cols = Math.max(1, Math.min(count, Math.floor((width + gapX) / (minCell + gapX))));
    const rows = Math.ceil(count / cols);
    return { cols, rows, cell: minCell, scroll: true };
};
