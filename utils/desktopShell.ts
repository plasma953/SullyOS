import { useEffect, useState } from 'react';

export interface DesktopViewport { width: number; height: number; pointerFine: boolean; }

export const DESKTOP_MIN_WIDTH = 900;
export const DESKTOP_MIN_HEIGHT = 600;

export const isDesktopViewport = (width: number, height: number, pointerFine: boolean): boolean =>
    pointerFine && width >= DESKTOP_MIN_WIDTH && height >= DESKTOP_MIN_HEIGHT;

export const resolveDesktopMode = (
    mode: 'auto' | 'on' | 'off' | undefined,
    vp: DesktopViewport,
): boolean => {
    if (mode === 'on') return true;
    if (mode === 'off') return false;
    return isDesktopViewport(vp.width, vp.height, vp.pointerFine);
};

const readViewport = (): DesktopViewport => ({
    width: typeof window === 'undefined' ? 0 : window.innerWidth,
    height: typeof window === 'undefined' ? 0 : window.innerHeight,
    pointerFine: typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: fine)').matches,
});

export const useDesktopViewport = (): DesktopViewport => {
    const [vp, setVp] = useState<DesktopViewport>(readViewport);
    useEffect(() => {
        const onResize = () => setVp(readViewport());
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);
    return vp;
};
