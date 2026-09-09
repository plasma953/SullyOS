import { useCallback, useRef, type WheelEvent } from 'react';

// ─── 滚轮翻页桥 ─────────────────────────────────────────────
// 把鼠标滚轮（纵向）映射为「上一页/下一页」。只服务桌面鼠标场景：
// 手机无滚轮硬件不触发；触控板横向滚动（deltaX 主导）交给原生横滑。
// 纵向滚动优先：向上遍历祖先，若存在纵向可滚容器且未滚到对应边界，
// 让原生滚动消化这次滚轮，到边界才翻页（动作面板/弹窗内容可滚的场景）。

export interface WheelPagerEvent {
    deltaY: number;
    deltaX: number;
    ctrlKey: boolean;
    target: EventTarget | null;
}

export interface WheelPagerController {
    handle(e: WheelPagerEvent): void;
}

const VERTICAL_OVERFLOW = 8;   // 容器纵向可滚动判定余量(px)
const EDGE_SLACK = 2;          // 滚动边界判定余量(px)
const ACCUM_THRESHOLD = 48;    // 累积位移达到该值才翻页
const IDLE_RESET_MS = 160;     // 停滚多久后累积归零
const DEFAULT_LOCK_MS = 550;   // 翻页后锁这段时间（覆盖 smooth 滚动/过渡动画）

const findVerticalScroller = (start: EventTarget | null): HTMLElement | null => {
    let el = start instanceof Element ? (start as HTMLElement) : null;
    while (el && el !== document.body) {
        if (el.scrollHeight - el.clientHeight > VERTICAL_OVERFLOW) return el;
        el = el.parentElement;
    }
    return null;
};

export const createWheelPager = (
    goPage: (delta: 1 | -1) => void,
    lockMs: number = DEFAULT_LOCK_MS,
): WheelPagerController => {
    let accum = 0;
    let lockUntil = 0;
    let idleTimer: number | null = null;
    return {
        handle(e) {
            if (e.ctrlKey) return; // 捏合缩放
            const { deltaX: dx, deltaY: dy } = e;
            if (Math.abs(dx) > Math.abs(dy)) return; // 横向触控板 → 原生横滑
            if (Math.abs(dy) < 4) return;
            const scroller = findVerticalScroller(e.target);
            if (scroller) {
                const atTop = scroller.scrollTop <= EDGE_SLACK;
                const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - EDGE_SLACK;
                if (dy > 0 && !atBottom) return; // 还能往下滚，交给原生
                if (dy < 0 && !atTop) return;
            }
            const now = Date.now();
            if (now < lockUntil) return;
            if (idleTimer !== null) window.clearTimeout(idleTimer);
            idleTimer = window.setTimeout(() => { accum = 0; idleTimer = null; }, IDLE_RESET_MS);
            accum += dy;
            if (Math.abs(accum) >= ACCUM_THRESHOLD) {
                const delta: 1 | -1 = accum > 0 ? 1 : -1;
                accum = 0;
                lockUntil = now + lockMs;
                goPage(delta);
            }
        },
    };
};

// hook 封装：handler 身份稳定（不受父组件重渲染影响），goPage 每次渲染换新闭包。
export const useWheelPager = (
    goPage: (delta: 1 | -1) => void,
    lockMs: number = DEFAULT_LOCK_MS,
): (e: WheelEvent) => void => {
    const goRef = useRef(goPage);
    goRef.current = goPage;
    const ctrlRef = useRef<WheelPagerController | null>(null);
    if (!ctrlRef.current) ctrlRef.current = createWheelPager((d) => goRef.current(d), lockMs);
    return useCallback((e: WheelEvent) => { ctrlRef.current?.handle(e); }, []);
};
