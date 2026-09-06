/**
 * 塔罗抽牌引擎（纯函数，无外部依赖）。
 *
 * - 自由占卜：crypto 真随机洗牌（Fisher-Yates），正逆位 50/50。
 * - 每日运势：`dateKey|targetId` 做种子，同日同目标结果恒定。
 *
 * 引擎只认牌堆大小（78），不认具体牌义：牌义只活在 `tarotData.ts` 里，
 * prompt 注入时也只取本次抽到的几张，避免 token 膨胀。
 */

export type Rng = () => number;

export interface DrawnCard {
  /** 牌在牌堆里的序号（0..deckSize-1，与 tarotData 的 CARDS 数组下标对齐） */
  cardIndex: number;
  reversed: boolean;
}

/** FNV-1a 32 位字符串哈希：把日期+目标拼成确定性种子。 */
export function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** 确定性 PRNG（mulberry32），给每日运势用。 */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cryptoRng = (): Rng => {
  const g = globalThis as { crypto?: { getRandomValues?: (a: Uint32Array) => void } };
  if (g.crypto?.getRandomValues) {
    const buf = new Uint32Array(1);
    return () => {
      g.crypto!.getRandomValues!(buf);
      return buf[0] / 4294967296;
    };
  }
  return Math.random;
};

/** Fisher-Yates 洗牌，返回 0..deckSize-1 的一个排列。 */
export function shuffleDeck(deckSize: number, rng?: Rng): number[] {
  const order = Array.from({ length: deckSize }, (_, i) => i);
  const rand = rng ?? cryptoRng();
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

/** 从一副新洗过的牌里抽 count 张（不放回），并判定正逆位。 */
export function drawSpread(deckSize: number, count: number, rng?: Rng): DrawnCard[] {
  if (count > deckSize) throw new Error(`drawSpread: count(${count}) > deckSize(${deckSize})`);
  const rand = rng ?? cryptoRng();
  return shuffleDeck(deckSize, rand)
    .slice(0, count)
    .map((cardIndex) => ({ cardIndex, reversed: rand() < 0.5 }));
}

/** 每日运势：同日期同目标永远抽到同一张（种子洗牌取首张）。 */
export function drawDailyCard(dateKey: string, targetId: string, deckSize: number): DrawnCard {
  const rng = mulberry32(hashSeed(`${dateKey}|${targetId}`));
  const [first] = drawSpread(deckSize, 1, rng);
  return first;
}
