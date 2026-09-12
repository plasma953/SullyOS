// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { getHostGeometry } from './hostViewport';

describe('getHostGeometry', () => {
    it('client 原点为 0，尺寸取可视窗口', () => {
        const g = getHostGeometry(document.body);
        expect(g.ox).toBe(0);
        expect(g.oy).toBe(0);
        expect(g.W).toBe(window.innerWidth);
        expect(g.H).toBe(window.innerHeight);
    });
});
