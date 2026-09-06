// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import {
    isPipSupported,
    PIP_WINDOW_FALLBACK_SIZE,
    installPipBridge,
    uninstallPipBridge,
    snapshotPlayingMedia,
} from './pipWindow';

describe('pipWindow basics', () => {
    it('无 API 时不支持', () => {
        expect(isPipSupported()).toBe(false);
    });
    it('默认窗口尺寸在 PiP 合法范围内', () => {
        expect(PIP_WINDOW_FALLBACK_SIZE.width).toBeGreaterThanOrEqual(200);
        expect(PIP_WINDOW_FALLBACK_SIZE.height).toBeGreaterThanOrEqual(100);
    });
});

type Listener = (e: Event) => void;

const makePipMock = () => {
    const winListeners = new Map<string, Set<Listener>>();
    const docListeners = new Map<string, Set<Listener>>();
    const on = (m: Map<string, Set<Listener>>) => (type: string, h: Listener) => {
        if (!m.has(type)) m.set(type, new Set());
        m.get(type)!.add(h);
    };
    const off = (m: Map<string, Set<Listener>>) => (type: string, h: Listener) => {
        m.get(type)?.delete(h);
    };
    const doc = {
        visibilityState: 'visible' as DocumentVisibilityState,
        addEventListener: on(docListeners),
        removeEventListener: off(docListeners),
        fire: (e: Event) => { docListeners.get(e.type)?.forEach((h) => h(e)); },
    };
    const win = {
        closed: false,
        document: doc,
        addEventListener: on(winListeners),
        removeEventListener: off(winListeners),
        fire: (e: Event) => { winListeners.get(e.type)?.forEach((h) => h(e)); },
        listenerCount: (type: string) => winListeners.get(type)?.size ?? 0,
    };
    return { win: win as unknown as Window, doc, fireWin: win.fire, countWin: win.listenerCount };
};

describe('pipBridge', () => {
    afterEach(() => uninstallPipBridge());

    it('转发 keydown 到主 window 并保留 key', () => {
        const { win, fireWin } = makePipMock();
        const got: string[] = [];
        const main = (e: Event) => { got.push((e as KeyboardEvent).key); };
        window.addEventListener('keydown', main);
        try {
            installPipBridge(win);
            fireWin(new KeyboardEvent('keydown', { key: 'a' }));
            expect(got).toEqual(['a']);
        } finally {
            window.removeEventListener('keydown', main);
        }
    });

    it('visibilityState 会话期间跟 PiP，卸载后恢复', () => {
        const before = document.visibilityState;
        const { win, doc } = makePipMock();
        installPipBridge(win);
        expect(document.visibilityState).toBe('visible');
        doc.visibilityState = 'hidden';
        expect(document.visibilityState).toBe('hidden');
        uninstallPipBridge();
        expect(document.visibilityState).toBe(before);
    });

    it('卸载后不再转发', () => {
        const { win, fireWin, countWin } = makePipMock();
        installPipBridge(win);
        expect(countWin('keydown')).toBe(1);
        uninstallPipBridge();
        expect(countWin('keydown')).toBe(0);
        const got: string[] = [];
        const main = (e: Event) => { got.push((e as KeyboardEvent).key); };
        window.addEventListener('keydown', main);
        try {
            fireWin(new KeyboardEvent('keydown', { key: 'b' }));
            expect(got).toEqual([]);
        } finally {
            window.removeEventListener('keydown', main);
        }
    });

    it('move 前在播、move 后暂停的媒体被 resume', () => {
        const audio = document.createElement('audio');
        document.body.appendChild(audio);
        let played = 0;
        Object.defineProperty(audio, 'paused', { value: false, configurable: true });
        (audio as unknown as { play: () => Promise<void> }).play = () => { played += 1; return Promise.resolve(); };
        try {
            snapshotPlayingMedia();
            // 模拟跨文档 move 导致暂停
            Object.defineProperty(audio, 'paused', { value: true, configurable: true });
            const { win } = makePipMock();
            installPipBridge(win);
            expect(played).toBe(1);
        } finally {
            audio.remove();
        }
    });
});
