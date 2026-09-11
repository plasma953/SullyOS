import React from 'react';
import { useOS } from '../../context/OSContext';
import { DOCK_APPS, INSTALLED_APPS } from '../../constants';
import { AppID, type AppConfig } from '../../types';
import AppIcon from '../os/AppIcon';

/** Dock 主区：四个常驻 Dock App + 几个高频 App。 */
const QUICK_EXTRAS: AppID[] = [AppID.Character, AppID.Music, AppID.Gallery];

const APP_BY_ID = new Map(INSTALLED_APPS.map((app) => [app.id, app]));

/** 「主屏」按钮用的合成 AppConfig（Launcher 不在 INSTALLED_APPS 里）。 */
const HOME_APP: AppConfig = { id: AppID.Launcher, name: '主屏', icon: 'Launcher', color: 'slate' };

const DockItem: React.FC<{ app: AppConfig; active: boolean; onClick: () => void }> = ({ app, active, onClick }) => (
    <div className={`relative flex items-center justify-center rounded-2xl transition-colors ${active ? 'bg-white/22' : 'hover:bg-white/12'}`}>
        {active && <span className="pointer-events-none absolute -left-[9px] top-1/2 h-6 w-1 -translate-y-1/2 rounded-full bg-white/85" />}
        <AppIcon app={app} onClick={onClick} size="md" variant="dock" />
    </div>
);

/**
 * 桌面形态的左侧全局 Dock（单 App 全屏，不做多窗口）。
 * 顶部「主屏」回启动器，中部常驻 App。图标复用手机端原生 AppIcon（玻璃底 + 主题色 + 自定义图标）。
 */
export const DesktopDock: React.FC = () => {
    const { activeApp, openApp } = useOS();

    const mainItems: AppID[] = [
        ...DOCK_APPS,
        ...QUICK_EXTRAS.filter((id) => !DOCK_APPS.includes(id)),
    ];

    return (
        <aside className="absolute left-0 top-0 z-[30] flex h-full w-[68px] shrink-0 flex-col items-center gap-1.5 border-r border-white/10 bg-black/30 py-4 backdrop-blur-2xl">
            <DockItem app={HOME_APP} active={activeApp === AppID.Launcher} onClick={() => openApp(AppID.Launcher)} />
            <div className="my-1.5 h-px w-8 bg-white/12" />
            {mainItems.map((id) => {
                const app = APP_BY_ID.get(id);
                if (!app) return null;
                return (
                    <DockItem
                        key={id}
                        app={app}
                        active={activeApp === id}
                        onClick={() => openApp(id)}
                    />
                );
            })}
        </aside>
    );
};
