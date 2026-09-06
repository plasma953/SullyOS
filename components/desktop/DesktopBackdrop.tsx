import React, { useEffect, useState } from 'react';
import { representativeColorFromWallpaper } from '../../utils/dominantHue';

const toBgValue = (wp: string): string => {
    // 与 components/PhoneShell.tsx getBgStyle 同规则：url 前缀包 url()，否则原样当 background。
    const isUrl = wp.startsWith('http') || wp.startsWith('data:') || wp.startsWith('blob:');
    return isUrl ? `url(${wp})` : wp;
};

const BlurLayer: React.FC<{ wallpaper: string }> = ({ wallpaper }) => (
    <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
        <div
            className="absolute inset-0 bg-cover bg-center"
            style={{
                backgroundImage: toBgValue(wallpaper),
                filter: 'blur(60px) brightness(0.72) saturate(1.25)',
                transform: 'scale(1.12)',
            }}
        />
    </div>
);

export const DesktopBackdrop: React.FC<{ wallpaper: string; mode: 'blur' | 'color' }> = ({ wallpaper, mode }) => {
    const [color, setColor] = useState<string | null>(null);
    useEffect(() => {
        if (mode !== 'color') return;
        let alive = true;
        representativeColorFromWallpaper(wallpaper).then((c) => { if (alive) setColor(c); });
        return () => { alive = false; };
    }, [mode, wallpaper]);
    if (mode === 'color' && color) {
        return <div className="absolute inset-0" style={{ background: color }} aria-hidden="true" />;
    }
    // blur 模式，或 color 取色失败时退化为模糊壁纸，保证背景不断层。
    return <BlurLayer wallpaper={wallpaper} />;
};
