export interface HostGeometry {
    /** fixed 定位坐标系原点（无处不 0：一律按可视窗口算）。 */
    ox: number;
    oy: number;
    /** 可用宽高（可视窗口；visualViewport 优先，与既有写法一致）。 */
    W: number;
    H: number;
}

/**
 * fixed 定位 + client 坐标换算的唯一入口。
 * 2026-09-11 移除窗口化手机框后不再有「框内坐标系」，统一回落可视窗口。
 */
export const getHostGeometry = (el?: Element | null): HostGeometry => {
    const view = el?.ownerDocument?.defaultView ?? (typeof window !== 'undefined' ? window : undefined);
    if (!view) return { ox: 0, oy: 0, W: 0, H: 0 };
    const vv = (view as Window).visualViewport;
    return { ox: 0, oy: 0, W: Math.round(vv?.width ?? view.innerWidth), H: Math.round(vv?.height ?? view.innerHeight) };
};
