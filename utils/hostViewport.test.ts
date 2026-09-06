// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { getHostGeometry, SULLY_VIEWPORT_ATTR } from './hostViewport';

describe('getHostGeometry', () => {
    it('框内元素返回框原点与尺寸', () => {
        const frame = document.createElement('div');
        frame.setAttribute(SULLY_VIEWPORT_ATTR, '');
        Object.defineProperty(frame, 'getBoundingClientRect', {
            value: () => ({ left: 700, top: 50, width: 393, height: 852 }),
        });
        const inner = document.createElement('div');
        frame.appendChild(inner);
        document.body.appendChild(frame);
        expect(getHostGeometry(inner)).toEqual({ ox: 700, oy: 50, W: 393, H: 852 });
        frame.remove();
    });
    it('框外回落 client 原点与 window 尺寸', () => {
        const g = getHostGeometry(document.body);
        expect(g.ox).toBe(0);
        expect(g.oy).toBe(0);
        expect(g.W).toBe(window.innerWidth);
        expect(g.H).toBe(window.innerHeight);
    });
});
