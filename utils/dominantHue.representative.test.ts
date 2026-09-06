import { describe, it, expect } from 'vitest';
import { representativeColorOfPixels, representativeColorFromWallpaper } from './dominantHue';

const solidPixels = (r: number, g: number, b: number, n = 24 * 24): Uint8ClampedArray => {
    const data = new Uint8ClampedArray(n * 4);
    for (let i = 0; i < n; i++) { data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = 255; }
    return data;
};

describe('representativeColorOfPixels', () => {
    it('纯红返回红色系 hex', () => {
        const c = representativeColorOfPixels(solidPixels(220, 40, 40));
        expect(c).toMatch(/^#[0-9a-f]{6}$/);
        const r = parseInt(c!.slice(1, 3), 16);
        expect(r).toBeGreaterThan(150);
    });
    it('全灰/全透明返回 null', () => {
        expect(representativeColorOfPixels(solidPixels(200, 200, 200))).toBeNull();
        expect(representativeColorOfPixels(solidPixels(10, 10, 10))).toBeNull();
        const t = solidPixels(220, 40, 40);
        for (let i = 3; i < t.length; i += 4) t[i] = 0;
        expect(representativeColorOfPixels(t)).toBeNull();
    });
});

describe('representativeColorFromWallpaper', () => {
    it('渐变串提取平均色', async () => {
        const c = await representativeColorFromWallpaper('linear-gradient(135deg,#d23c3c,#7a1f1f)');
        expect(c).toMatch(/^#[0-9a-f]{6}$/);
    });
    it('空串返回 null', async () => {
        await expect(representativeColorFromWallpaper('')).resolves.toBeNull();
    });
});
