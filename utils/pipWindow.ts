// ─── Document PiP 投屏悬浮窗 ─────────────────────────────────────
// 把整个 #root DOM 节点搬进系统级置顶小窗（Chromium only）。
// React 18 事件挂在根容器上，跟节点走，状态零丢失；所有逻辑仍跑在主窗口，
// 不存在双实例竞争。关闭（pagehide）时原样搬回。本文件只做 move/restore
// 生命周期 + 样式/变量迁移；事件桥与音频 resume 见 installPipBridge。

// TS DOM 库没有 Document PiP 类型，这里补最小形状，不污染全局 d.ts。
declare global {
    interface Window {
        documentPictureInPicture?: {
            requestWindow(options?: { width?: number; height?: number }): Promise<Window>;
        };
    }
}

import { setPortalHost } from './portalHost';

export const PIP_WINDOW_FALLBACK_SIZE = { width: 420, height: 900 };
const PIP_MIN_SIZE = { width: 200, height: 100 };

export const isPipSupported = (): boolean =>
    typeof window !== 'undefined' && !!window.documentPictureInPicture?.requestWindow;

// ─── 会话态（关闭即还原，不残留） ───
let activePip: Window | null = null;
let originParent: HTMLElement | null = null;
let originNext: Node | null = null;
let placeholder: HTMLElement | null = null;
let restoring = false;

export const isPipActive = (): boolean => !!activePip && !activePip.closed;

const ROOT_ID = 'root';

const clampPipSize = (width: number, height: number): { width: number; height: number } => {
    const maxW = window.screen?.availWidth ?? width;
    const maxH = window.screen?.availHeight ?? height;
    return {
        width: Math.max(PIP_MIN_SIZE.width, Math.min(width, maxW)),
        height: Math.max(PIP_MIN_SIZE.height, Math.min(height, maxH)),
    };
};

// 样式迁移：克隆全部 <style> 与 <link rel=stylesheet>（只 clone 节点，不读 cssRules，避跨域）。
const cloneStylesTo = (pipDoc: Document): void => {
    const head = pipDoc.head;
    document.querySelectorAll('style, link[rel="stylesheet"]').forEach((node) => {
        head.appendChild(node.cloneNode(true));
    });
};

// PiP 需要的 :root 变量。只列 SullyOS 实际消费的（见 index.html 与 iosStandalone），
// 不做全量复制；--app-height 按 PiP 窗口实时高度重建。
const PIP_ROOT_VARS = [
    '--app-height',
    '--safe-top',
    '--safe-bottom',
    '--chrome-top',
    '--standalone-safe-area-top',
    '--standalone-safe-area-bottom',
    '--visual-viewport-height',
    '--keyboard-inset',
    '--primary-hue',
    '--primary-sat',
    '--primary-lightness',
    '--sully-emoji-size',
];

export const syncPipVars = (pipWin: Window): void => {
    const src = document.documentElement;
    const dst = pipWin.document.documentElement;
    // 皮肤挂在 <html data-skin> 上（OSContext 写入），选择器依赖它，必须带过去。
    dst.dataset.skin = src.dataset.skin ?? '';
    if (src.className) dst.className = src.className;
    const srcStyle = src.style;
    PIP_ROOT_VARS.forEach((name) => {
        const value = srcStyle.getPropertyValue(name);
        if (value) dst.style.setProperty(name, value);
    });
    dst.style.setProperty('--app-height', `${Math.round(pipWin.innerHeight)}px`);
    // 桌面端安全区恒为 0（PiP 窗无刘海），防止主窗口残留值污染。
    dst.style.setProperty('--safe-top', '0px');
    dst.style.setProperty('--safe-bottom', '0px');
};

const moveRootTo = (pipDoc: Document): void => {
    const root = document.getElementById(ROOT_ID);
    if (!root || !root.parentElement) return;
    originParent = root.parentElement as HTMLElement;
    originNext = root.nextSibling;
    placeholder = document.createElement('div');
    placeholder.setAttribute('data-pip-placeholder', '');
    originParent.insertBefore(placeholder, root);
    pipDoc.body.appendChild(root);
};

const restoreRoot = (): void => {
    const root = activePip?.document.getElementById(ROOT_ID) ?? document.getElementById(ROOT_ID);
    if (root && originParent) {
        if (placeholder && placeholder.parentElement === originParent) {
            originParent.insertBefore(root, placeholder);
        } else if (originNext && originNext.parentElement === originParent) {
            originParent.insertBefore(root, originNext);
        } else {
            originParent.appendChild(root);
        }
    }
    placeholder?.remove();
    originParent = null;
    originNext = null;
    placeholder = null;
    setPortalHost(null);
};

export const restorePipShell = (): void => {
    if (restoring) return;
    restoring = true;
    try {
        uninstallPipBridge();
        restoreRoot();
    } finally {
        const pip = activePip;
        activePip = null;
        restoring = false;
        try {
            if (pip && !pip.closed) pip.close();
        } catch { /* 已关就不用再关 */ }
    }
};

export const openPipShell = async (opts?: { width?: number; height?: number }): Promise<Window | null> => {
    if (!isPipSupported()) return null;
    if (isPipActive()) return activePip;
    const api = window.documentPictureInPicture;
    if (!api) return null;
    const size = clampPipSize(opts?.width ?? PIP_WINDOW_FALLBACK_SIZE.width, opts?.height ?? PIP_WINDOW_FALLBACK_SIZE.height);
    const pipWin = await api.requestWindow({ width: size.width, height: size.height });
    activePip = pipWin;
    cloneStylesTo(pipWin.document);
    if (document.title) pipWin.document.title = document.title;
    syncPipVars(pipWin);
    snapshotPlayingMedia();
    moveRootTo(pipWin.document);
    setPortalHost(pipWin.document.body);
    installPipBridge(pipWin);
    pipWin.addEventListener('pagehide', () => restorePipShell(), { once: true });
    pipWin.addEventListener('resize', () => {
        if (isPipActive()) syncPipVars(pipWin);
    });
    return pipWin;
};

export const closePipShell = (): void => {
    if (isPipActive()) restorePipShell();
};

// ─── 事件桥与音频 resume ───
// PiP 文档有自己的事件系统：主 window 上的全局监听（keydown 快捷键、
// visibilitychange 前后台逻辑）在 PiP 聚焦时收不到事件。桥把 PiP 的事件
// 转发回主 window；会话结束全部拆除。所有转发包 try/catch，桥失败不阻断开窗。
let bridgeOff: Array<() => void> | null = null;
let playingBeforeMove: HTMLMediaElement[] = [];
let origVisibilityDesc: PropertyDescriptor | undefined;
let visibilityOverridden = false;

/** move 前记录正在播放的媒体（测试钩子，open 内部调用）。 */
export const snapshotPlayingMedia = (): void => {
    playingBeforeMove = [];
    try {
        document.querySelectorAll('audio,video').forEach((el) => {
            const media = el as HTMLMediaElement;
            if (!media.paused && !media.ended) playingBeforeMove.push(media);
        });
    } catch { playingBeforeMove = []; }
};

const resumePlayingMedia = (): void => {
    const list = playingBeforeMove;
    playingBeforeMove = [];
    list.forEach((media) => {
        try {
            // 跨文档 move 可能暂停媒体；还在播的不碰（避免重播闪断）。
            if (media.isConnected && media.paused) {
                void media.play()?.catch?.(() => {});
            }
        } catch { /* 自动播放策略拦截则保持暂停，用户点一次即恢复 */ }
    });
};

const VIS_EVENT = 'visibilitychange';

export const installPipBridge = (pipWin: Window): void => {
    uninstallPipBridge();
    const off: Array<() => void> = [];
    (['keydown', 'keyup'] as const).forEach((type) => {
        const handler = (e: Event) => {
            try {
                const src = e as KeyboardEvent;
                window.dispatchEvent(new KeyboardEvent(type, {
                    key: src.key,
                    code: src.code,
                    location: src.location,
                    ctrlKey: src.ctrlKey,
                    shiftKey: src.shiftKey,
                    altKey: src.altKey,
                    metaKey: src.metaKey,
                    repeat: src.repeat,
                    bubbles: true,
                    cancelable: true,
                }));
            } catch { /* 合成失败就丢掉，不阻断 */ }
        };
        pipWin.addEventListener(type, handler);
        off.push(() => pipWin.removeEventListener(type, handler));
    });
    const visHandler = () => {
        try { document.dispatchEvent(new Event(VIS_EVENT)); } catch { /* ignore */ }
    };
    try { pipWin.document.addEventListener(VIS_EVENT, visHandler); } catch { /* ignore */ }
    off.push(() => { try { pipWin.document.removeEventListener(VIS_EVENT, visHandler); } catch { /* ignore */ } });
    // visibilityState 是只读属性，读它的代码（回到前台补收、音频图恢复）需要 PiP 的值。
    try {
        origVisibilityDesc =
            Object.getOwnPropertyDescriptor(document, 'visibilityState') ??
            Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState');
        Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            get: () => (pipWin.closed ? 'hidden' : pipWin.document.visibilityState),
        });
        visibilityOverridden = true;
    } catch { visibilityOverridden = false; }
    bridgeOff = off;
    resumePlayingMedia();
};

export const uninstallPipBridge = (): void => {
    if (bridgeOff) {
        bridgeOff.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
        bridgeOff = null;
    }
    if (!visibilityOverridden) return;
    visibilityOverridden = false;
    try {
        if (origVisibilityDesc) Object.defineProperty(document, 'visibilityState', origVisibilityDesc);
        else delete (document as unknown as Record<string, unknown>).visibilityState;
    } catch { /* 恢复失败则保持，下次会话覆盖 */ }
    origVisibilityDesc = undefined;
};
