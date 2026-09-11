import React, { useEffect, useState } from 'react';
import { useOS } from '../../context/OSContext';
import { INSTALLED_APPS, Icons } from '../../constants';
import { AppID } from '../../types';
import { isDevDebugAvailable, subscribeDevDebugAvailability } from '../../utils/devDebug';

/**
 * 桌面形态的「主屏」：全量 App 网格，替代手机版 Launcher 的横向分页 + 底部 dock。
 * 手机/平板竖屏仍走原 Launcher。
 */
export const DesktopHome: React.FC = () => {
    const { openApp } = useOS();
    const [devDebugVisible, setDevDebugVisible] = useState(() => isDevDebugAvailable());
    useEffect(() => subscribeDevDebugAvailability(setDevDebugVisible), []);

    // 与手机版一致：开发模式外隐藏「捏脸·开发」。
    const apps = INSTALLED_APPS.filter((app) => app.id !== AppID.CharCreatorDev || devDebugVisible);

    return (
        <div className="flex h-full w-full flex-col items-center overflow-y-auto px-10 py-12 no-scrollbar">
            <header className="mb-10 w-full max-w-4xl text-center">
                <h1 className="text-2xl font-black tracking-wide text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.45)]">
                    SullyOS
                </h1>
                <p className="mt-1 text-xs font-medium text-white/70 drop-shadow">选择一个应用进入</p>
            </header>

            <div className="grid w-full max-w-4xl grid-cols-[repeat(auto-fill,minmax(92px,1fr))] gap-x-4 gap-y-6">
                {apps.map((app) => {
                    const Icon = Icons[app.icon];
                    return (
                        <button
                            key={app.id}
                            type="button"
                            title={app.name}
                            onClick={() => openApp(app.id)}
                            className="group flex flex-col items-center gap-2 rounded-2xl p-2 transition-transform active:scale-95"
                        >
                            <span className="flex h-16 w-16 items-center justify-center rounded-[20px] bg-white/16 text-white shadow-[0_8px_24px_rgba(0,0,0,0.28)] ring-1 ring-white/25 backdrop-blur-xl transition-colors group-hover:bg-white/24">
                                {Icon ? <Icon className="h-7 w-7" /> : null}
                            </span>
                            <span className="max-w-[92px] truncate text-[11px] font-bold text-white/85 drop-shadow">
                                {app.name}
                            </span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
};
