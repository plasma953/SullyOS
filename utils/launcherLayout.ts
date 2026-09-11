/**
 * 启动器布局数据模型：Dock 恒 4 格，网格 = 全部可用 App − Dock 成员。
 * Dock 与网格的成员/顺序分别持久化在 theme.launcherDockOrder / theme.launcherAppOrder。
 * 纯函数，无 React 依赖，供 Provider 与拖拽逻辑复用。
 */

export type LauncherKind = 'app' | 'dock';

export const DOCK_SLOTS = 4;

export const sameOrder = (a: string[], b: string[]): boolean =>
    a.length === b.length && a.every((value, index) => value === b[index]);

export function normalizeDockOrder(saved: string[] | undefined, availableIds: string[], defaults: string[]): string[] {
    const available = new Set(availableIds);
    const out: string[] = [];
    const push = (id: string) => {
        if (out.length >= DOCK_SLOTS) return;
        if (!available.has(id) || out.includes(id)) return;
        out.push(id);
    };
    (saved || []).forEach(push);
    defaults.forEach(push);
    availableIds.forEach(push);
    return out;
}

export function normalizeAppOrder(saved: string[] | undefined, allIds: string[], dockIds: string[]): string[] {
    const dock = new Set(dockIds);
    const gridIds = allIds.filter(id => !dock.has(id));
    const valid = new Set(gridIds);
    const out: string[] = [];
    (saved || []).forEach(id => {
        if (valid.has(id) && !out.includes(id)) out.push(id);
    });
    gridIds.forEach(id => {
        if (!out.includes(id)) out.push(id);
    });
    return out;
}

export function reorderIds<T extends string>(items: T[], source: T, target: T): T[] {
    const from = items.indexOf(source);
    const to = items.indexOf(target);
    if (from < 0 || to < 0 || from === to) return items;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return next;
}

export function swapDockAndGrid(
    appOrder: string[],
    dockOrder: string[],
    source: { id: string; kind: LauncherKind },
    target: { id: string; kind: LauncherKind },
): { appOrder: string[]; dockOrder: string[] } {
    if (source.kind === target.kind || source.id === target.id) return { appOrder, dockOrder };
    const sourceFromDock = source.kind === 'dock';
    const sourceIndex = sourceFromDock ? dockOrder.indexOf(source.id) : appOrder.indexOf(source.id);
    const targetIndex = sourceFromDock ? appOrder.indexOf(target.id) : dockOrder.indexOf(target.id);
    if (sourceIndex < 0 || targetIndex < 0) return { appOrder, dockOrder };
    const nextApp = [...appOrder];
    const nextDock = [...dockOrder];
    if (sourceFromDock) {
        nextDock[sourceIndex] = target.id;
        nextApp[targetIndex] = source.id;
    } else {
        nextApp[sourceIndex] = target.id;
        nextDock[targetIndex] = source.id;
    }
    return { appOrder: nextApp, dockOrder: nextDock };
}
