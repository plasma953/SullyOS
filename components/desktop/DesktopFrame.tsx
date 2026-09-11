import React, { useEffect, useRef } from 'react';
import { setPortalHost } from '../../utils/portalHost';

/**
 * 仿真手机外框。屏幕区即 sully-viewport：
 * 自带 translateZ(0) 让内部 fixed 浮层以框为包含块（与 App.tsx 现有手法一致），
 * portal 宿主 div 只做挂载点（零尺寸、不定位），portal 自身定位。
 * ResizeObserver 把屏幕区尺寸写进 --vp-width/--vp-height，供 dock 等按框宽缩放。
 */
export const DesktopFrame: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const portalHostRef = useRef<HTMLDivElement | null>(null);
    const frameRef = useRef<HTMLDivElement | null>(null);
    const screenRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
        setPortalHost(portalHostRef.current);
        return () => setPortalHost(null);
    }, []);
    useEffect(() => {
        const screen = screenRef.current;
        const frame = frameRef.current;
        if (!screen || !frame) return;
        const write = () => {
            const rect = screen.getBoundingClientRect();
            frame.style.setProperty('--vp-width', `${Math.round(rect.width)}px`);
            frame.style.setProperty('--vp-height', `${Math.round(rect.height)}px`);
        };
        write();
        const ro = new ResizeObserver(write);
        ro.observe(screen);
        return () => ro.disconnect();
    }, []);
    const sizeStyle: React.CSSProperties = { width: 'min(460px, 94vw, calc(min(92vh, 940px) * 393 / 852))', aspectRatio: '393 / 852' };
    return (
        <div ref={frameRef} className="relative select-none" style={sizeStyle} data-desktop-frame>
            {/* 金属边框 */}
            <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-[56px] bg-gradient-to-br from-zinc-600 via-zinc-900 to-black shadow-[0_40px_120px_rgba(0,0,0,0.55),inset_0_1px_1px_rgba(255,255,255,0.35),inset_0_-1px_1px_rgba(0,0,0,0.6)]"
            />
            {/* 侧边键：左音量 ×2，右电源 */}
            <div aria-hidden="true" className="pointer-events-none absolute -left-[2.5px] top-[150px] h-14 w-[3px] rounded-full bg-zinc-700" />
            <div aria-hidden="true" className="pointer-events-none absolute -left-[2.5px] top-[220px] h-20 w-[3px] rounded-full bg-zinc-700" />
            <div aria-hidden="true" className="pointer-events-none absolute -right-[2.5px] top-[190px] h-24 w-[3px] rounded-full bg-zinc-700" />
            {/* 屏幕 */}
            <div
                ref={screenRef}
                className="absolute overflow-hidden bg-black"
                style={{ inset: 12, borderRadius: 44, transform: 'translateZ(0)' }}
                data-sully-viewport
            >
                {children}
                <div ref={portalHostRef} data-sully-portal-host />
            </div>
        </div>
    );
};
