import React from 'react';
import { useOS } from '../../context/OSContext';
import { resolveDesktopMode, useDesktopViewport } from '../../utils/desktopShell';
import { DesktopBackdrop } from './DesktopBackdrop';
import { DesktopFrame } from './DesktopFrame';

/**
 * 桌面外壳总装：非桌面模式直接透传 children（fragment，DOM 与原来一致）；
 * 桌面模式渲染全屏背景 + 居中手机框。内部读 theme，经 updateTheme 持久化。
 */
export const DesktopHost: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { theme } = useOS();
    const vp = useDesktopViewport();
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
