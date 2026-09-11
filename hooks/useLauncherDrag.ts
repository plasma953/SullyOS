import { useCallback, useEffect, useRef } from 'react';

/**
 * 启动器图标拖拽控制器（从 apps/Launcher.tsx 抽出，供手机/桌面根与电脑左侧 Dock 共用）。
 * - 长按 520ms 进入编辑态；编辑态内按下即拖。
 * - ghost 克隆跟随指针，落点用 elementFromPoint 找 [data-launcher-item]；同类或 app↔dock 合法。
 * - 两个入口各持一个实例：指针从 Dock 拖到网格（或反向）时靠 setPointerCapture + elementFromPoint 跨容器。
 */

export type LauncherDragKind = 'app' | 'dock' | 'widget';

export interface LauncherDragPoint {
    id: string;
    kind: LauncherDragKind;
}

interface LauncherPointerState {
    pointerId: number;
    key: string;
    kind: LauncherDragKind;
    x: number;
    y: number;
    active: boolean;
    element: HTMLElement;
    ghost?: HTMLElement;
    grabOffsetX?: number;
    grabOffsetY?: number;
    lastTarget?: string;
    lastTargetKind?: LauncherDragKind;
    targetElement?: HTMLElement;
}

export interface UseLauncherDragOptions {
    editing: boolean;
    beginEdit: () => void;
    onDrop: (source: LauncherDragPoint, target: LauncherDragPoint) => void;
    /** 不在编辑态时是否允许长按进入编辑；电脑端只在主页开放。 */
    canBeginEdit?: boolean;
    /** 手机端横向分页：拖到左右边缘时的翻页回调。 */
    onPageTurn?: (direction: -1 | 1) => void;
    onPageTurnEnd?: () => void;
}

const LONG_PRESS_MS = 520;
const MOVE_CANCEL_PX = 9;

export const useLauncherDrag = <T extends HTMLElement = HTMLDivElement>({
    editing,
    beginEdit,
    onDrop,
    canBeginEdit = true,
    onPageTurn,
    onPageTurnEnd,
}: UseLauncherDragOptions) => {
    const refs = useRef({ editing, canBeginEdit, beginEdit, onDrop, onPageTurn, onPageTurnEnd });
    refs.current = { editing, canBeginEdit, beginEdit, onDrop, onPageTurn, onPageTurnEnd };

    const pointerRef = useRef<LauncherPointerState | null>(null);
    const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const suppressClickUntil = useRef(0);

    const clearPressTimer = useCallback(() => {
        if (pressTimer.current) clearTimeout(pressTimer.current);
        pressTimer.current = null;
    }, []);

    const clearDropTarget = useCallback(() => {
        const pointer = pointerRef.current;
        pointer?.targetElement?.classList.remove('launcher-drop-target');
        if (pointer) {
            pointer.targetElement = undefined;
            pointer.lastTarget = undefined;
            pointer.lastTargetKind = undefined;
        }
    }, []);

    const activateDrag = useCallback((pointer: LauncherPointerState) => {
        if (pointer.ghost) return;
        const rect = pointer.element.getBoundingClientRect();
        const ghost = pointer.element.cloneNode(true) as HTMLElement;
        ghost.removeAttribute('data-launcher-item');
        ghost.removeAttribute('data-launcher-kind');
        ghost.classList.remove('launcher-edit-item', 'launcher-drop-target');
        ghost.classList.add('launcher-drag-ghost');
        Object.assign(ghost.style, {
            position: 'fixed',
            left: `${rect.left}px`,
            top: `${rect.top}px`,
            width: `${rect.width}px`,
            height: `${rect.height}px`,
            margin: '0',
            pointerEvents: 'none',
            zIndex: '9999',
            transform: 'scale(1.055)',
            transformOrigin: 'center',
            transition: 'none',
        });
        document.body.appendChild(ghost);
        pointer.ghost = ghost;
        pointer.grabOffsetX = pointer.x - rect.left;
        pointer.grabOffsetY = pointer.y - rect.top;
        pointer.element.classList.add('launcher-dragging');
        pointer.element.style.pointerEvents = 'none';
    }, []);

    const onPointerDown = useCallback((e: React.PointerEvent<T>) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        const root = e.currentTarget;
        const item = (e.target as HTMLElement).closest<HTMLElement>('[data-launcher-item]');
        if (!item) return;
        const key = item.dataset.launcherItem;
        const kind = item.dataset.launcherKind as LauncherDragKind | undefined;
        if (!key || !kind) return;
        const { editing: isEditing, canBeginEdit: canBegin } = refs.current;
        if (!isEditing && !canBegin) return;
        clearPressTimer();
        pointerRef.current = { pointerId: e.pointerId, key, kind, x: e.clientX, y: e.clientY, active: isEditing, element: item };
        if (isEditing) {
            activateDrag(pointerRef.current);
            root.setPointerCapture(e.pointerId);
            e.preventDefault();
            return;
        }
        pressTimer.current = setTimeout(() => {
            if (!pointerRef.current || pointerRef.current.pointerId !== e.pointerId) return;
            pointerRef.current.active = true;
            activateDrag(pointerRef.current);
            root.setPointerCapture(e.pointerId);
            suppressClickUntil.current = Date.now() + 700;
            refs.current.beginEdit();
        }, LONG_PRESS_MS);
    }, [activateDrag, clearPressTimer]);

    const onPointerMove = useCallback((e: React.PointerEvent<T>) => {
        const pointer = pointerRef.current;
        if (!pointer || pointer.pointerId !== e.pointerId) return;
        if (!pointer.active) {
            if (Math.hypot(e.clientX - pointer.x, e.clientY - pointer.y) > MOVE_CANCEL_PX) {
                clearPressTimer();
                pointerRef.current = null;
            }
            return;
        }
        e.preventDefault();
        if (pointer.ghost) {
            pointer.ghost.style.left = `${e.clientX - (pointer.grabOffsetX || 0)}px`;
            pointer.ghost.style.top = `${e.clientY - (pointer.grabOffsetY || 0)}px`;
        }
        const rootRect = e.currentTarget.getBoundingClientRect();
        if (pointer.kind === 'app' && refs.current.onPageTurn) {
            if (e.clientX <= rootRect.left + 72) refs.current.onPageTurn(-1);
            else if (e.clientX >= rootRect.right - 72) refs.current.onPageTurn(1);
            else refs.current.onPageTurnEnd?.();
        }
        const target = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-launcher-item]');
        const targetKey = target?.dataset.launcherItem;
        const targetKind = target?.dataset.launcherKind as LauncherDragKind | undefined;
        const crossKind = (pointer.kind === 'app' && targetKind === 'dock') || (pointer.kind === 'dock' && targetKind === 'app');
        const validTarget = !!targetKey && !!targetKind && (targetKind === pointer.kind || crossKind) && targetKey !== pointer.key;
        if (!validTarget) {
            clearDropTarget();
            return;
        }
        if (target === pointer.targetElement) return;
        pointer.targetElement?.classList.remove('launcher-drop-target');
        target?.classList.add('launcher-drop-target');
        pointer.targetElement = target;
        pointer.lastTarget = targetKey;
        pointer.lastTargetKind = targetKind;
    }, [clearDropTarget, clearPressTimer]);

    const finishPointer = useCallback((e?: React.PointerEvent<T>) => {
        const pointer = pointerRef.current;
        if (e && pointer && pointer.pointerId !== e.pointerId) return;
        clearPressTimer();
        refs.current.onPageTurnEnd?.();
        if (pointer?.active) {
            suppressClickUntil.current = Date.now() + 500;
            pointer.element.style.pointerEvents = '';
            pointer.element.classList.remove('launcher-dragging');
            pointer.ghost?.remove();
            pointer.targetElement?.classList.remove('launcher-drop-target');
            if (pointer.lastTarget && pointer.lastTargetKind) {
                refs.current.onDrop(
                    { id: pointer.key, kind: pointer.kind },
                    { id: pointer.lastTarget, kind: pointer.lastTargetKind },
                );
            }
        }
        pointerRef.current = null;
    }, [clearPressTimer]);

    const onContextMenu = useCallback((e: React.MouseEvent) => {
        if ((e.target as HTMLElement).closest('[data-launcher-item]')) e.preventDefault();
    }, []);

    useEffect(() => () => {
        clearPressTimer();
        const pointer = pointerRef.current;
        pointer?.ghost?.remove();
        if (pointer) {
            pointer.element.style.pointerEvents = '';
            pointer.element.classList.remove('launcher-dragging');
            pointer.targetElement?.classList.remove('launcher-drop-target');
        }
        pointerRef.current = null;
    }, [clearPressTimer]);

    return {
        handlers: {
            onPointerDown,
            onPointerMove,
            onPointerUp: finishPointer,
            onPointerCancel: finishPointer,
            onContextMenu,
        },
        suppressClickUntil,
        cancelDrag: finishPointer,
        clearDropTarget,
    };
};
