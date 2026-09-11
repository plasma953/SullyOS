import { useEffect, useState } from 'react';

/**
 * 布局形态判定（Web 三端适配的唯一事实来源）。
 *
 * - phone   ：手机/平板竖屏用现有 UI（铺满、底部 dock、手机框语义）
 * - desktop ：平板横屏与电脑宽屏用桌面 UI（左侧 Dock + 全尺寸内容区）
 *
 * 判定只看宽高：宽度 >= 1024 且高度 >= 600 进桌面形态。pointer:fine 不参与
 * 「是否进桌面」的判定——平板横屏是触屏但也该进桌面；它只影响 hover 之类的细腻度。
 * 用户的 desktopMode 手动三档（auto/on/off）作为覆盖，保留逃生口。
 */
export type LayoutMode = 'phone' | 'desktop';
export type DesktopModePref = 'auto' | 'on' | 'off' | undefined;

export const LAYOUT_MIN_WIDTH = 1024;
export const LAYOUT_MIN_HEIGHT = 600;

export const isDesktopLayoutViewport = (width: number, height: number): boolean =>
    width >= LAYOUT_MIN_WIDTH && height >= LAYOUT_MIN_HEIGHT;

export const resolveLayoutMode = (
    desktopMode: DesktopModePref,
    width: number,
    height: number,
): LayoutMode => {
    if (desktopMode === 'on') return 'desktop';
    if (desktopMode === 'off') return 'phone';
    return isDesktopLayoutViewport(width, height) ? 'desktop' : 'phone';
};

const readSize = (): { width: number; height: number } => ({
    width: typeof window === 'undefined' ? 0 : window.innerWidth,
    height: typeof window === 'undefined' ? 0 : window.innerHeight,
});

/** 订阅窗口尺寸变化，返回当前布局形态。 */
export const useLayoutMode = (desktopMode: DesktopModePref): LayoutMode => {
    const [size, setSize] = useState(readSize);
    useEffect(() => {
        const onResize = () => setSize(readSize());
        window.addEventListener('resize', onResize);
        window.addEventListener('orientationchange', onResize);
        return () => {
            window.removeEventListener('resize', onResize);
            window.removeEventListener('orientationchange', onResize);
        };
    }, []);
    return resolveLayoutMode(desktopMode, size.width, size.height);
};
