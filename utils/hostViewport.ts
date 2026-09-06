export const SULLY_VIEWPORT_ATTR = 'data-sully-viewport';

export interface HostGeometry {
    /** fixed 定位坐标系原点（框内 = 框相对 viewport 的偏移；框外 = 0）。 */
    ox: number;
    oy: number;
    /** 可用宽高（框内 = 框尺寸；框外 = 可视窗口）。 */
    W: number;
    H: number;
}

/**
 * fixed 定位 + client 坐标换算的唯一入口。
 * 框内返回框的原点与尺寸（调用方把 client 坐标减去 ox/oy 后再 clamp 到 W/H）；
 * 框外回落可视窗口（mobile 语义不变：visualViewport 优先，与现有写法一致）。
 */
export const getHostGeometry = (el: Element | null): HostGeometry => {
    const host = el?.closest?.(`[${SULLY_VIEWPORT_ATTR}]`) ?? null;
    if (host) {
        const rect = host.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
            return { ox: Math.round(rect.left), oy: Math.round(rect.top), W: Math.round(rect.width), H: Math.round(rect.height) };
        }
    }
    const view = el?.ownerDocument?.defaultView ?? (typeof window !== 'undefined' ? window : undefined);
    if (typeof window === 'undefined' || !view) return { ox: 0, oy: 0, W: 0, H: 0 };
    const vv = (view as Window).visualViewport;
    return { ox: 0, oy: 0, W: Math.round(vv?.width ?? view.innerWidth), H: Math.round(vv?.height ?? view.innerHeight) };
};
