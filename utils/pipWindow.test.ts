// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { isPipSupported, PIP_WINDOW_FALLBACK_SIZE } from './pipWindow';

describe('pipWindow basics', () => {
    it('无 API 时不支持', () => {
        expect(isPipSupported()).toBe(false);
    });
    it('默认窗口尺寸在 PiP 合法范围内', () => {
        expect(PIP_WINDOW_FALLBACK_SIZE.width).toBeGreaterThanOrEqual(200);
        expect(PIP_WINDOW_FALLBACK_SIZE.height).toBeGreaterThanOrEqual(100);
    });
});
