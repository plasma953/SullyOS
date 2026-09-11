import { describe, it, expect } from 'vitest';
import { resolveLayoutMode, isDesktopLayoutViewport, LAYOUT_MIN_WIDTH, LAYOUT_MIN_HEIGHT } from './layoutMode';

describe('resolveLayoutMode', () => {
  it('手机竖屏 / 平板竖屏 / 手机横屏 → phone', () => {
    expect(resolveLayoutMode('auto', 393, 852)).toBe('phone');   // 手机竖屏
    expect(resolveLayoutMode('auto', 768, 1024)).toBe('phone');  // 平板竖屏
    expect(resolveLayoutMode('auto', 852, 393)).toBe('phone');   // 手机横屏
  });

  it('平板横屏 / 电脑宽屏 → desktop', () => {
    expect(resolveLayoutMode('auto', 1024, 768)).toBe('desktop');   // 平板横屏
    expect(resolveLayoutMode('auto', 1440, 900)).toBe('desktop');   // 电脑全屏
    expect(resolveLayoutMode('auto', 1920, 1080)).toBe('desktop');
  });

  it('电脑窗口化（宽不足）→ phone', () => {
    expect(resolveLayoutMode('auto', 900, 700)).toBe('phone');
    expect(resolveLayoutMode('auto', LAYOUT_MIN_WIDTH - 1, LAYOUT_MIN_HEIGHT)).toBe('phone');
  });

  it('高度不足（如超宽扁窗）→ phone', () => {
    expect(resolveLayoutMode('auto', 1600, LAYOUT_MIN_HEIGHT - 1)).toBe('phone');
  });

  it('desktopMode 手动覆盖优先于尺寸', () => {
    expect(resolveLayoutMode('on', 393, 852)).toBe('desktop');
    expect(resolveLayoutMode('off', 1920, 1080)).toBe('phone');
  });
});

describe('isDesktopLayoutViewport', () => {
  it('边界值：恰好达到阈值算桌面', () => {
    expect(isDesktopLayoutViewport(LAYOUT_MIN_WIDTH, LAYOUT_MIN_HEIGHT)).toBe(true);
    expect(isDesktopLayoutViewport(LAYOUT_MIN_WIDTH - 1, LAYOUT_MIN_HEIGHT)).toBe(false);
    expect(isDesktopLayoutViewport(LAYOUT_MIN_WIDTH, LAYOUT_MIN_HEIGHT - 1)).toBe(false);
  });
});
