import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useOS } from './OSContext';
import { DOCK_APPS, INSTALLED_APPS } from '../constants';
import { AppConfig, AppID } from '../types';
import { isDevDebugAvailable, subscribeDevDebugAvailability } from '../utils/devDebug';
import {
    LauncherKind,
    normalizeAppOrder,
    normalizeDockOrder,
    reorderIds,
    sameOrder,
    swapDockAndGrid,
} from '../utils/launcherLayout';

/**
 * 启动器布局状态（手机 Dock 与电脑左侧 Dock 共用唯一事实来源）。
 * - Dock 恒 4 格，跨容器拖动 = 对调；顺序写回 theme.launcherDockOrder / launcherAppOrder。
 * - editing 为长按进入的布局编辑态；拖拽的四个样式类也在这里挂一份，两个入口共用。
 */

interface LauncherLayoutContextValue {
    gridApps: AppConfig[];
    dockApps: AppConfig[];
    editing: boolean;
    beginEdit: () => void;
    finishEdit: () => void;
    drop: (source: { id: string; kind: LauncherKind }, target: { id: string; kind: LauncherKind }) => void;
}

const LauncherLayoutContext = createContext<LauncherLayoutContextValue | null>(null);

export const useLauncherLayout = (): LauncherLayoutContextValue => {
    const ctx = useContext(LauncherLayoutContext);
    if (!ctx) throw new Error('useLauncherLayout must be used within LauncherLayoutProvider');
    return ctx;
};

const APP_BY_ID = new Map<string, AppConfig>(INSTALLED_APPS.map(app => [app.id as string, app]));

const DRAG_STYLE = `
  @keyframes jiggleEdit {
    0%, 100% { transform: rotate(-0.8deg); }
    50% { transform: rotate(0.8deg); }
  }
  .launcher-edit-item {
    touch-action: none;
    cursor: grab;
    transition: transform 180ms cubic-bezier(.2,.75,.25,1), opacity 150ms ease, filter 150ms ease;
    will-change: transform;
    animation: jiggleEdit 1.2s ease-in-out infinite;
  }
  .launcher-dragging {
    cursor: grabbing;
    opacity: .18;
  }
  .launcher-drag-ghost {
    opacity: .96;
    filter: drop-shadow(0 12px 14px rgba(75,65,54,.18));
    cursor: grabbing;
  }
  .launcher-drop-target {
    transform: scale(.93);
    opacity: .52;
    outline: 1.5px dashed rgba(75,65,54,.36);
    outline-offset: 5px;
    border-radius: 1.35rem;
    animation: none;
  }
  @media (prefers-reduced-motion: reduce) {
    .launcher-edit-item { animation: none; }
  }
`;

export const LauncherLayoutProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { theme, updateTheme } = useOS();

    // 跟随 DevDebug 可用性：prod 用户在设置页解锁后，「捏脸·开发」立刻出现。
    const [devDebugVisible, setDevDebugVisible] = useState(() => isDevDebugAvailable());
    useEffect(() => subscribeDevDebugAvailability(setDevDebugVisible), []);

    const availableIds = useMemo(
        () => INSTALLED_APPS
            .filter(app => app.id !== AppID.CharCreatorDev || devDebugVisible)
            .map(app => app.id as string),
        [devDebugVisible],
    );

    const [dockOrder, setDockOrder] = useState<string[]>(() => normalizeDockOrder(theme.launcherDockOrder, availableIds, DOCK_APPS as string[]));
    const [appOrder, setAppOrder] = useState<string[]>(() => normalizeAppOrder(
        theme.launcherAppOrder,
        availableIds,
        normalizeDockOrder(theme.launcherDockOrder, availableIds, DOCK_APPS as string[]),
    ));
    const [editing, setEditing] = useState(false);

    const dockOrderRef = useRef(dockOrder);
    dockOrderRef.current = dockOrder;
    const appOrderRef = useRef(appOrder);
    appOrderRef.current = appOrder;

    // 非编辑态与 theme 同步（外部写入/换端）；编辑中不打断用户手上的顺序。
    useEffect(() => {
        if (editing) return;
        const next = normalizeDockOrder(theme.launcherDockOrder, availableIds, DOCK_APPS as string[]);
        setDockOrder(prev => (sameOrder(prev, next) ? prev : next));
    }, [editing, theme.launcherDockOrder, availableIds]);

    useEffect(() => {
        if (editing) return;
        setAppOrder(prev => {
            const next = normalizeAppOrder(
                prev.length ? prev : theme.launcherAppOrder,
                availableIds,
                dockOrderRef.current,
            );
            return sameOrder(prev, next) ? prev : next;
        });
    }, [editing, availableIds, theme.launcherAppOrder, theme.launcherDockOrder, dockOrder]);

    const beginEdit = useCallback(() => setEditing(true), []);
    const finishEdit = useCallback(() => setEditing(false), []);

    const drop = useCallback((source: { id: string; kind: LauncherKind }, target: { id: string; kind: LauncherKind }) => {
        if (source.id === target.id) return;
        if (source.kind === target.kind) {
            if (source.kind === 'app') {
                const next = reorderIds(appOrderRef.current, source.id, target.id);
                if (next === appOrderRef.current) return;
                appOrderRef.current = next;
                setAppOrder(next);
            } else {
                const next = reorderIds(dockOrderRef.current, source.id, target.id);
                if (next === dockOrderRef.current) return;
                dockOrderRef.current = next;
                setDockOrder(next);
            }
        } else {
            const swapped = swapDockAndGrid(appOrderRef.current, dockOrderRef.current, source, target);
            if (swapped.appOrder === appOrderRef.current && swapped.dockOrder === dockOrderRef.current) return;
            appOrderRef.current = swapped.appOrder;
            dockOrderRef.current = swapped.dockOrder;
            setAppOrder(swapped.appOrder);
            setDockOrder(swapped.dockOrder);
        }
        void updateTheme({
            launcherAppOrder: appOrderRef.current,
            launcherDockOrder: dockOrderRef.current,
        });
    }, [updateTheme]);

    const gridApps = useMemo(
        () => appOrder.map(id => APP_BY_ID.get(id)).filter(Boolean) as AppConfig[],
        [appOrder],
    );
    const dockApps = useMemo(
        () => dockOrder.map(id => APP_BY_ID.get(id)).filter(Boolean) as AppConfig[],
        [dockOrder],
    );

    const value = useMemo(
        () => ({ gridApps, dockApps, editing, beginEdit, finishEdit, drop }),
        [gridApps, dockApps, editing, beginEdit, finishEdit, drop],
    );

    return (
        <LauncherLayoutContext.Provider value={value}>
            <style>{DRAG_STYLE}</style>
            {children}
        </LauncherLayoutContext.Provider>
    );
};
