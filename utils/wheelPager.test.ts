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
