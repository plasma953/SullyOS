import { describe, it, expect } from 'vitest';
import { buildLocalSummary, type ResolvedDrawn } from './tarotReading';
import { cardById, spreadById } from './tarotData';

const three = spreadById('three')!;
const drawn: ResolvedDrawn[] = [
  { card: cardById('major-00-fool')!, reversed: false, positionName: '过去', positionMeaning: '来路' },
  { card: cardById('major-19-sun')!, reversed: true, positionName: '现在', positionMeaning: '当下' },
  { card: cardById('major-16-tower')!, reversed: false, positionName: '未来', positionMeaning: '下一步' },
];

describe('buildLocalSummary', () => {
  it('lists every position with its card, orientation and keywords', () => {
    const s = buildLocalSummary(three, drawn);
    expect(s).toContain('过去');
    expect(s).toContain('愚者');
    expect(s).toContain('正位');
    expect(s).toContain('现在');
    expect(s).toContain('太阳');
    expect(s).toContain('逆位');
    expect(s).toContain('未来');
    expect(s).toContain('高塔');
  });

  it('uses the correct face meaning per orientation', () => {
    const s = buildLocalSummary(three, drawn);
    expect(s).toContain('放下包袱轻装上阵');
    expect(s).toContain('云遮了一会儿太阳');
    expect(s).not.toContain('大晴天');
  });

  it('ends with an honest mechanical rollup, not a fake synthesis', () => {
    const s = buildLocalSummary(three, drawn);
    expect(s).toContain('3 张');
    expect(s).toContain('2 张正位');
    expect(s).toContain('1 张逆位');
  });
});
