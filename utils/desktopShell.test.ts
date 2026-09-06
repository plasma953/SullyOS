import { describe, it, expect } from 'vitest';
import { isDesktopViewport, resolveDesktopMode } from './desktopShell';

describe('isDesktopViewport', () => {
    it('宽屏鼠标判定为桌面', () => {
        expect(isDesktopViewport(1920, 1080, true)).toBe(true);
    });
    it('窄屏/触屏/矮窗口不判定', () => {
        expect(isDesktopViewport(390, 844, false)).toBe(false);
        expect(isDesktopViewport(1920, 1080, false)).toBe(false);
        expect(isDesktopViewport(1920, 500, true)).toBe(false);
        expect(isDesktopViewport(800, 900, true)).toBe(false);
    });
    it('边界 900x600 通过', () => {
        expect(isDesktopViewport(900, 600, true)).toBe(true);
    });
});

describe('resolveDesktopMode', () => {
    const vp = { width: 1920, height: 1080, pointerFine: true };
    it('on 强制开，off 强制关，auto/undefined 跟随视口', () => {
        expect(resolveDesktopMode('on', { width: 390, height: 844, pointerFine: false })).toBe(true);
        expect(resolveDesktopMode('off', vp)).toBe(false);
        expect(resolveDesktopMode('auto', vp)).toBe(true);
        expect(resolveDesktopMode(undefined, vp)).toBe(true);
        expect(resolveDesktopMode('auto', { width: 390, height: 844, pointerFine: false })).toBe(false);
    });
});
