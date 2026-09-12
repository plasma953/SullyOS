// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createWheelPager, type WheelPagerEvent } from './wheelPager';

const evt = (deltaY: number, extra: Partial<WheelPagerEvent> = {}): WheelPagerEvent =>
    ({ deltaY, deltaX: 0, ctrlKey: false, target: null, ...extra });

describe('wheelPager', () => {
    it('累积达到阈值才翻页，方向取累积符号', () => {
        const goPage = vi.fn();
        const pager = createWheelPager(goPage);
        pager.handle(evt(20));
        pager.handle(evt(20));
        expect(goPage).not.toHaveBeenCalled();
        pager.handle(evt(20));
        expect(goPage).toHaveBeenCalledTimes(1);
        expect(goPage).toHaveBeenCalledWith(1);
    });

    it('负向累积翻上一页', () => {
        const goPage = vi.fn();
        const pager = createWheelPager(goPage);
        pager.handle(evt(-60));
        expect(goPage).toHaveBeenCalledWith(-1);
    });

    it('翻页后进入锁定期，期间滚轮被忽略', () => {
        vi.useFakeTimers();
        const goPage = vi.fn();
        const pager = createWheelPager(goPage);
        pager.handle(evt(60));
        pager.handle(evt(60));
        expect(goPage).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(600);
        pager.handle(evt(60));
        expect(goPage).toHaveBeenCalledTimes(2);
        vi.useRealTimers();
    });

    it('停滚 160ms 后累积归零', () => {
        vi.useFakeTimers();
        const goPage = vi.fn();
        const pager = createWheelPager(goPage);
        pager.handle(evt(30));
        vi.advanceTimersByTime(200);
        pager.handle(evt(30));
        expect(goPage).not.toHaveBeenCalled();
        vi.useRealTimers();
    });

    it('横向主导（触控板）与 ctrlKey（捏合）不翻页', () => {
        const goPage = vi.fn();
        const pager = createWheelPager(goPage);
        pager.handle(evt(0, { deltaX: 80 }));
        pager.handle(evt(80, { ctrlKey: true }));
        expect(goPage).not.toHaveBeenCalled();
    });
});

describe('wheelPager · 纵向滚动容器判定（DOM）', () => {
    const makeEl = (opts: { overflowY?: string; scrollHeight?: number; clientHeight?: number; scrollTop?: number } = {}) => {
        const el = document.createElement('div');
        if (opts.overflowY) el.style.overflowY = opts.overflowY;
        Object.defineProperty(el, 'scrollHeight', { value: opts.scrollHeight ?? 0, configurable: true });
        Object.defineProperty(el, 'clientHeight', { value: opts.clientHeight ?? 0, configurable: true });
        Object.defineProperty(el, 'scrollTop', { value: opts.scrollTop ?? 0, writable: true, configurable: true });
        return el;
    };

    const mount = (container: HTMLElement, target: HTMLElement) => {
        container.appendChild(target);
        document.body.appendChild(container);
        return () => container.remove();
    };

    it('内容溢出但滚不动的祖先（overflow 可见）不拦截翻页', () => {
        const wrapper = makeEl({ scrollHeight: 500, clientHeight: 400 });
        const target = document.createElement('span');
        const unmount = mount(wrapper, target);
        const goPage = vi.fn();
        createWheelPager(goPage).handle(evt(120, { target }));
        expect(goPage).toHaveBeenCalledWith(1);
        unmount();
    });

    it('真滚动容器未到底不翻页，到底才翻页', () => {
        const scroller = makeEl({ overflowY: 'auto', scrollHeight: 500, clientHeight: 400, scrollTop: 0 });
        const target = document.createElement('span');
        const unmount = mount(scroller, target);

        const before = vi.fn();
        createWheelPager(before).handle(evt(120, { target }));
        expect(before).not.toHaveBeenCalled();

        scroller.scrollTop = 100;
        const after = vi.fn();
        createWheelPager(after).handle(evt(120, { target }));
        expect(after).toHaveBeenCalledWith(1);
        unmount();
    });

    it('真滚动容器未到顶不翻页，到顶翻上一页', () => {
        const scroller = makeEl({ overflowY: 'auto', scrollHeight: 500, clientHeight: 400, scrollTop: 100 });
        const target = document.createElement('span');
        const unmount = mount(scroller, target);

        const before = vi.fn();
        createWheelPager(before).handle(evt(-120, { target }));
        expect(before).not.toHaveBeenCalled();

        scroller.scrollTop = 0;
        const after = vi.fn();
        createWheelPager(after).handle(evt(-120, { target }));
        expect(after).toHaveBeenCalledWith(-1);
        unmount();
    });
});
