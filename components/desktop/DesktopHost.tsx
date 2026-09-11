import React from 'react';
import { useOS } from '../../context/OSContext';
import { resolveDesktopMode, useDesktopViewport } from '../../utils/desktopShell';
import { useLayoutMode } from '../../utils/layoutMode';
import { DesktopBackdrop } from './DesktopBackdrop';
import { DesktopFrame } from './DesktopFrame';

/**
 * 桌面外壳总装，三态：
 *   1. desktop（宽 >= 1024 或用户强制 on）→ 全屏桌面 UI，无手机框；
 *      左侧全局 Dock 由 PhoneShell 内部渲染。
 *   2. phone + 桌面窗口化（900x600 + 鼠标）→ 保留居中手机框（DesktopFrame）。
 *   3. 其余 → 透传（手机/平板铺满）。
 */
export const DesktopHost: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { theme } = useOS();
    const vp = useDesktopViewport();
    const layoutMode = useLayoutMode(theme.desktopMode);

    if (layoutMode === 'desktop') {
        return (
            <div className="fixed inset-0 z-0 overflow-hidden bg-black">
                <DesktopBackdrop wallpaper={theme.wallpaper ?? ''} mode={theme.desktopBackdrop ?? 'blur'} />
                <div className="relative z-10 h-full w-full">{children}</div>
            </div>
        );
    }

    if (!resolveDesktopMode(theme.desktopMode, vp)) return <>{children}</>;

    return (
        <div className="fixed inset-0 z-0 overflow-hidden bg-black">
            <DesktopBackdrop wallpaper={theme.wallpaper ?? ''} mode={theme.desktopBackdrop ?? 'blur'} />
            <div className="relative z-10 flex h-full w-full items-center justify-center">
                <DesktopFrame>{children}</DesktopFrame>
            </div>
        </div>
    );
};
