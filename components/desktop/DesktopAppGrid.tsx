import React, { useEffect, useRef, useState } from 'react';
import { AppConfig, AppID } from '../../types';
import AppIcon from '../os/AppIcon';
import { computeFitGrid, type FitGridResult } from '../../utils/fitGrid';

interface DesktopAppGridProps {
    apps: AppConfig[];
    openApp: (id: AppID) => void;
    editing: boolean;
}

const INITIAL_FIT: FitGridResult = { cols: 6, rows: 1, cell: 96, scroll: false };

const sameFit = (a: FitGridResult, b: FitGridResult) =>
    a.cols === b.cols && a.rows === b.rows && a.cell === b.cell && a.scroll === b.scroll;

/**
 * 桌面主页应用网格：ResizeObserver 量容器 → computeFitGrid 定列数/单元尺寸，
 * 全部 App 默认一屏装下；极端小窗时容器内部滚动，整页不滚。
 * 图标走 AppIcon，条目保留拖拽标记，供 Launcher 的 useLauncherDrag 跨容器互换。
 */
export const DesktopAppGrid: React.FC<DesktopAppGridProps> = ({ apps, openApp, editing }) => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const [fit, setFit] = useState<FitGridResult>(INITIAL_FIT);

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const measure = () => {
            const rect = el.getBoundingClientRect();
            setFit(prev => {
                const next = computeFitGrid({ width: rect.width, height: rect.height, count: apps.length });
                return sameFit(prev, next) ? prev : next;
            });
        };
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, [apps.length]);

    const iconSize = Math.round(Math.max(40, Math.min(56, fit.cell * 0.55)));

    return (
        <div
            ref={containerRef}
            className={`h-full min-h-0 ${fit.scroll ? 'overflow-y-auto no-scrollbar' : 'overflow-hidden'}`}
        >
            <div
                className={`grid place-items-center ${fit.scroll ? '' : 'h-full'}`}
                style={{
                    gridTemplateColumns: `repeat(${fit.cols}, minmax(0, 1fr))`,
                    gridAutoRows: fit.scroll ? `${fit.cell}px` : `minmax(${fit.cell}px, 1fr)`,
                    gap: '10px 12px',
                    '--app-icon-size': `${iconSize}px`,
                } as React.CSSProperties}
            >
                {apps.map(app => (
                    <div
                        key={app.id}
                        data-launcher-item={app.id}
                        data-launcher-kind="app"
                        className={`relative transition-transform duration-200 active:scale-95 ${editing ? 'launcher-edit-item' : ''}`}
                    >
                        <AppIcon app={app} onClick={() => { if (!editing) openApp(app.id); }} size="md" />
                    </div>
                ))}
            </div>
        </div>
    );
};

export default DesktopAppGrid;
