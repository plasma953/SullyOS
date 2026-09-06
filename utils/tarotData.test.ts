import { describe, it, expect } from 'vitest';
import { CARDS, SPREADS, cardById, spreadById } from './tarotData';

describe('tarot deck integrity', () => {
  it('holds the full 78-card Rider-Waite deck', () => {
    expect(CARDS).toHaveLength(78);
  });

  it('has 22 majors and 56 minors (4 suits x 14)', () => {
    expect(CARDS.filter((c) => c.arcana === 'major')).toHaveLength(22);
    for (const suit of ['wands', 'cups', 'swords', 'pentacles'] as const) {
      expect(CARDS.filter((c) => c.arcana === suit)).toHaveLength(14);
    }
  });

  it('uses unique ids and engine-aligned indices 0..77', () => {
    const ids = CARDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(78);
    CARDS.forEach((c, i) => expect(c.index).toBe(i));
  });

  it('gives every card real upright and reversed content', () => {
    for (const c of CARDS) {
      expect(c.nameCn.trim().length, `${c.id} nameCn`).toBeGreaterThan(0);
      expect(c.nameEn.trim().length, `${c.id} nameEn`).toBeGreaterThan(0);
      expect(c.upright.keywords.length, `${c.id} upright keywords`).toBeGreaterThanOrEqual(3);
      expect(c.reversed.keywords.length, `${c.id} reversed keywords`).toBeGreaterThanOrEqual(3);
      expect(c.upright.meaning.length, `${c.id} upright meaning`).toBeGreaterThan(20);
      expect(c.reversed.meaning.length, `${c.id} reversed meaning`).toBeGreaterThan(20);
      expect(c.image, `${c.id} image`).toMatch(/^tarot\/rws\/.+\.jpg$/);
    }
  });

  it('resolves cards by id', () => {
    expect(cardById('major-00-fool')?.nameCn).toBe('愚者');
    expect(cardById('cups-01-ace')?.nameCn).toBe('圣杯一');
    expect(cardById('no-such-card')).toBeUndefined();
  });
});

describe('tarot spread integrity', () => {
  it('ships the six agreed real-world spreads', () => {
    expect(SPREADS.map((s) => s.id)).toEqual([
      'daily',
      'three',
      'five-cross',
      'relationship',
      'horseshoe',
      'celtic-cross',
    ]);
  });

  it('matches position count to card count for every spread', () => {
    for (const s of SPREADS) {
      expect(s.positions, s.id).toHaveLength(s.cardCount);
    }
  });

  it('gives every position a name, a meaning and on-table coordinates', () => {
    for (const s of SPREADS) {
      for (const p of s.positions) {
        expect(p.name.trim().length, `${s.id} position name`).toBeGreaterThan(0);
        expect(p.meaning.trim().length, `${s.id} position meaning`).toBeGreaterThan(0);
        expect(p.x, `${s.id}/${p.name} x`).toBeGreaterThanOrEqual(0);
        expect(p.x, `${s.id}/${p.name} x`).toBeLessThanOrEqual(1);
        expect(p.y, `${s.id}/${p.name} y`).toBeGreaterThanOrEqual(0);
        expect(p.y, `${s.id}/${p.name} y`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('covers the Celtic Cross with the ten authentic Biddy positions', () => {
    const celtic = spreadById('celtic-cross')!;
    expect(celtic.positions.map((p) => p.name)).toEqual([
      '现状', '挑战', '过去', '未来', '上方', '下方', '建议', '外部影响', '希望与恐惧', '结果',
    ]);
  });

  it('cites a real source for every spread', () => {
    for (const s of SPREADS) {
      expect(s.source.trim().length, s.id).toBeGreaterThan(0);
    }
  });
});
