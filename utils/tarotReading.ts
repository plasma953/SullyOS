/**
 * 塔罗解读记录的类型与本地速览组装。
 *
 * 本地速览 = 牌义原文的机械拼装（逐位置 + 正逆计数 rollup），不是"AI 合成"，
 * 所以诚实、可离线；有味道的叙述走 tarotLlm.ts（角色口吻，可选）。
 */

import type { TarotCard, TarotSpread } from './tarotData';
import type { TarotReadingKind, TarotReadingRecord, TarotSavedCard } from '../types';

export type { TarotReadingKind, TarotReadingRecord, TarotSavedCard };

export interface ResolvedDrawn {
  card: TarotCard;
  reversed: boolean;
  positionName: string;
  positionMeaning: string;
}

/** 机械速览：逐张牌义原文 + 正逆位计数。绝不假装是整体推演。 */
export function buildLocalSummary(spread: TarotSpread, drawn: ResolvedDrawn[]): string {
  const lines = drawn.map((d) => {
    const face = d.reversed ? d.card.reversed : d.card.upright;
    const orientation = d.reversed ? '逆位' : '正位';
    return `【${d.positionName}】${d.card.nameCn}（${orientation}）：${face.keywords.join('、')}——${face.meaning}`;
  });
  const upright = drawn.filter((d) => !d.reversed).length;
  const reversed = drawn.length - upright;
  const majors = drawn.filter((d) => d.card.arcana === 'major').length;
  const rollup =
    `—— 本次「${spread.nameCn}」共 ${drawn.length} 张：${upright} 张正位、${reversed} 张逆位` +
    (majors > 0 ? `，其中大阿尔卡纳 ${majors} 张，点出本次的核心主题` : `，全是小牌，落在日常的具体事务上`) +
    `。以上为牌义速览，点「让 TA 解读」可听角色细说。`;
  return [...lines, rollup].join('\n');
}

export const newReadingId = (): string =>
  `tarot-${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffffff).toString(36)}`;
