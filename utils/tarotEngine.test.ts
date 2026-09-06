import { describe, it, expect } from 'vitest';
import {
  hashSeed,
  mulberry32,
  shuffleDeck,
  drawSpread,
  drawDailyCard,
} from './tarotEngine';

describe('hashSeed', () => {
  it('is deterministic for the same input', () => {
    expect(hashSeed('2026-09-06|user')).toBe(hashSeed('2026-09-06|user'));
  });

  it('differs for different inputs', () => {
    expect(hashSeed('2026-09-06|user')).not.toBe(hashSeed('2026-09-07|user'));
    expect(hashSeed('2026-09-06|user')).not.toBe(hashSeed('2026-09-06|char-1'));
  });
});

describe('mulberry32', () => {
  it('produces a deterministic sequence within [0, 1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = [a(), a(), a()];
    const seqB = [b(), b(), b()];
    expect(seqA).toEqual(seqB);
    for (const v of seqA) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('shuffleDeck', () => {
  it('returns every index exactly once', () => {
    const order = shuffleDeck(78);
    expect(order).toHaveLength(78);
    expect([...order].sort((x, y) => x - y)).toEqual(
      Array.from({ length: 78 }, (_, i) => i),
    );
  });

  it('honours an injected rng', () => {
    const rng = mulberry32(7);
    const order = shuffleDeck(10, rng);
    expect(order).toHaveLength(10);
    expect([...order].sort((x, y) => x - y)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

describe('drawSpread', () => {
  it('draws the requested number of unique cards with reversal flags', () => {
    const rng = mulberry32(1234);
    const drawn = drawSpread(78, 10, rng);
    expect(drawn).toHaveLength(10);
    const ids = drawn.map((d) => d.cardIndex);
    expect(new Set(ids).size).toBe(10);
    for (const d of drawn) {
      expect(d.cardIndex).toBeGreaterThanOrEqual(0);
      expect(d.cardIndex).toBeLessThan(78);
      expect(typeof d.reversed).toBe('boolean');
    }
  });

  it('throws when asking for more cards than the deck holds', () => {
    expect(() => drawSpread(78, 79, mulberry32(1))).toThrow();
  });
});

describe('drawDailyCard', () => {
  it('is stable for the same date and target', () => {
    const a = drawDailyCard('2026-09-06', 'user', 78);
    const b = drawDailyCard('2026-09-06', 'user', 78);
    expect(a).toEqual(b);
  });

  it('can differ by date or by target', () => {
    const base = drawDailyCard('2026-09-06', 'user', 78);
    const otherDay = drawDailyCard('2026-09-07', 'user', 78);
    const otherTarget = drawDailyCard('2026-09-06', 'char-1', 78);
    // 三个结果不可能全部相同（概率上可忽略，种子不同必然分叉洗牌）
    const same =
      JSON.stringify(base) === JSON.stringify(otherDay) &&
      JSON.stringify(base) === JSON.stringify(otherTarget);
    expect(same).toBe(false);
  });

  it('draws a valid card index with a reversal flag', () => {
    const d = drawDailyCard('2026-09-06', 'user', 78);
    expect(d.cardIndex).toBeGreaterThanOrEqual(0);
    expect(d.cardIndex).toBeLessThan(78);
    expect(typeof d.reversed).toBe('boolean');
  });
});
