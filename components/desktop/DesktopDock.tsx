import React from 'react';
import { useOS } from '../../context/OSContext';
import { DOCK_APPS, INSTALLED_APPS, Icons } from '../../constants';
import { AppID } from '../../types';

/** Dock 主区：四个常驻 Dock App + 几个高频 App。 */
const QUICK_EXTRAS: AppID[] = [AppID.Character, AppID.Music, AppID.Gallery];

const APP_BY_ID = new Map(INSTALLED_APPS.map((app) => [app.id, app]));

interface DockButtonProps {
    appId: AppID;
    label: string;
    iconName: string;
    active: boolean;
    onClick: () => void;
}

const DockButton: React.FC<DockButtonProps> = ({ label, iconName, active, onClick }) => {
    const Icon = Icons[iconName];
    return (
        <button
            type="button"
            title={label}
            aria-label={label}
            aria-pressed={active}
            onClick={onClick}
            className={`group relative flex h-11 w-11 items-center justify-center rounded-2xl transition-all active:scale-90 ${
                active
                    ? 'bg-white/22 text-white shadow-inner ring-1 ring-white/30'
                    : 'text-white/60 hover:bg-white/12 hover:text-white'
            }`}
        >
            {active && <span className="absolute -left-[9px] top-1/2 h-6 w-1 -translate-y-1/2 rounded-full bg-white/85" />}
            {Icon ? <Icon className="h-5 w-5" /> : null}
        </button>
    );
};

/**
 * 桌面形态的左侧全局 Dock（单 App 全屏，不做多窗口）。
 * 顶部「主屏」回启动器，中部常驻 App，底部设置。
 */
export const DesktopDock: React.FC = () => {
    const { activeApp, openApp } = useOS();

    const mainItems: AppID[] = [
        ...DOCK_APPS,
        ...QUICK_EXTRAS.filter((id) => !DOCK_APPS.includes(id)),
    ];

    return (
        <aside className="absolute left-0 top-0 z-[30] flex h-full w-[68px] shrink-0 flex-col items-center gap-1.5 border-r border-white/10 bg-black/30 py-4 backdrop-blur-2xl">
            <DockButton
                appId={AppID.Launcher}
                label="主屏"
                iconName="Launcher"
                active={activeApp === AppID.Launcher}
                onClick={() => openApp(AppID.Launcher)}
            />
            <div className="my-1.5 h-px w-8 bg-white/12" />
            {mainItems.map((id) => {
                const app = APP_BY_ID.get(id);
                if (!app) return null;
                return (
                    <DockButton
                        key={id}
                        appId={id}
                        label={app.name}
                        iconName={app.icon}
                        active={activeApp === id}
                        onClick={() => openApp(id)}
                    />
                );
            })}
        </aside>
    );
};
