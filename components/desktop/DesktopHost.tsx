import React, { useEffect, useState } from 'react';
import { useOS } from '../../context/OSContext';
import { resolveDesktopMode, useDesktopViewport } from '../../utils/desktopShell';
import { closePipShell, isPipSupported, onPipChange, openPipShell } from '../../utils/pipWindow';
import { DesktopBackdrop } from './DesktopBackdrop';
import { DesktopFrame } from './DesktopFrame';

/**
 * 桌面外壳总装：非桌面模式直接透传 children（fragment，DOM 与原来一致）；
 * 桌面模式渲染全屏背景 + 居中手机框。内部读 theme，经 updateTheme 持久化。
 * 投屏按钮只在桌面模式 + 支持 PiP + 未投屏时出现（视口级 fixed，不被框裁剪）。
 */
export const DesktopHost: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { theme } = useOS();
    const vp = useDesktopViewport();
    const [pipActive, setPipActive] = useState(false);
    useEffect(() => onPipChange(setPipActive), []);
    if (!resolveDesktopMode(theme.desktopMode, vp)) return <>{children}</>;
    const toggleCast = () => {
        if (pipActive) closePipShell();
        else void openPipShell().catch(() => {});
    };
    return (
        <div className="fixed inset-0 z-0 overflow-hidden bg-black">
            <DesktopBackdrop wallpaper={theme.wallpaper ?? ''} mode={theme.desktopBackdrop ?? 'blur'} />
            <div className="relative z-10 flex h-full w-full items-center justify-center">
                <DesktopFrame>{children}</DesktopFrame>
            </div>
            {isPipSupported() && !pipActive && (
                <button
                    type="button"
                    onClick={toggleCast}
                    aria-label="投屏到悬浮窗"
                    title="投屏到悬浮窗（置顶小窗）"
                    className="absolute bottom-6 right-6 z-20 flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white ring-1 ring-white/20 backdrop-blur transition hover:bg-white/20 active:scale-90"
                >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5" aria-hidden="true">
                        <rect x="2.5" y="4.5" width="14" height="10" rx="2" />
                        <path d="M6 18.5h9M9.5 21h4M18.5 9.5l2-2m-2 5.5 2 2" strokeLinecap="round" />
                    </svg>
                </button>
            )}
        </div>
    );
};
