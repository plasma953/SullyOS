import React from 'react';
import type { TarotCard } from '../../utils/tarotData';

export const tarotImageUrl = (id: string): string =>
  `${(import.meta as any).env?.BASE_URL ?? '/'}tarot/rws/${id}.jpg`;

const CARD_RATIO = '800 / 1372';

/** 牌背：暗金对称纹样（新月 + 星 + 卷草边框），纯 SVG，无图片。 */
export const CardBack: React.FC<{ className?: string; style?: React.CSSProperties }> = ({ className, style }) => (
  <div
    className={className}
    style={{
      aspectRatio: CARD_RATIO,
      background: 'radial-gradient(120% 90% at 50% 20%, #2d4a3e 0%, #1d2f28 55%, #141d18 100%)',
      ...style,
    }}
  >
    <svg viewBox="0 0 200 343" className="h-full w-full" aria-hidden>
      <rect x="8" y="8" width="184" height="327" fill="none" stroke="#c9a227" strokeWidth="2.5" />
      <rect x="14" y="14" width="172" height="315" fill="none" stroke="#c9a227" strokeWidth="0.8" opacity="0.7" />
      {[[22, 22], [178, 22], [22, 321], [178, 321]].map(([cx, cy], i) => (
        <g key={i} stroke="#c9a227" strokeWidth="1.2" fill="none" opacity="0.9">
          <circle cx={cx} cy={cy} r="5" />
          <path d={`M ${cx - 9} ${cy} H ${cx - 6} M ${cx + 6} ${cy} H ${cx + 9} M ${cx} ${cy - 9} V ${cy - 6} M ${cx} ${cy + 6} V ${cy + 9}`} />
        </g>
      ))}
      <g transform="translate(100 150)">
        <path d="M 18 -34 A 40 40 0 1 0 18 34 A 31 31 0 1 1 18 -34 Z" fill="#c9a227" opacity="0.92" />
        <g fill="#c9a227">
          <circle cx="26" cy="-12" r="3.2" />
          <circle cx="38" cy="8" r="2.2" opacity="0.8" />
          <circle cx="24" cy="26" r="1.7" opacity="0.7" />
          <path d="M -34 -44 l 2.2 5.4 5.4 2.2 -5.4 2.2 -2.2 5.4 -2.2 -5.4 -5.4 -2.2 5.4 -2.2 Z" opacity="0.9" />
          <path d="M -44 30 l 1.6 4 4 1.6 -4 1.6 -1.6 4 -1.6 -4 -4 -1.6 4 -1.6 Z" opacity="0.7" />
        </g>
      </g>
      <text x="100" y="238" textAnchor="middle" fill="#c9a227" fontSize="17" letterSpacing="6" fontFamily="Georgia, 'Times New Roman', serif" opacity="0.95">ARCANA</text>
      <text x="100" y="258" textAnchor="middle" fill="#c9a227" fontSize="9" letterSpacing="3" fontFamily="Georgia, serif" opacity="0.7">· 塔 罗 ·</text>
      <g stroke="#c9a227" strokeWidth="1" opacity="0.55" fill="none">
        <path d="M 40 290 Q 100 272 160 290" />
        <circle cx="100" cy="283" r="2.4" fill="#c9a227" stroke="none" opacity="0.8" />
      </g>
    </svg>
  </div>
);

/** 牌面缩略图；reversed 时整张倒置呈现。 */
export const TarotThumb: React.FC<{
  card: TarotCard;
  reversed?: boolean;
  className?: string;
  style?: React.CSSProperties;
  eager?: boolean;
}> = ({ card, reversed, className, style, eager }) => (
  <div className={className} style={{ aspectRatio: CARD_RATIO, overflow: 'hidden', ...style }}>
    <img
      src={tarotImageUrl(card.id)}
      alt={`${card.nameCn} ${card.nameEn}`}
      draggable={false}
      loading={eager ? 'eager' : 'lazy'}
      className="h-full w-full object-cover"
      style={reversed ? { transform: 'rotate(180deg)' } : undefined}
    />
  </div>
);

/**
 * 翻牌容器（3D）。正面 = 牌背，反面 = 牌面。
 * 翻转动画与景深样式由 TarotApp 根部的 <style> 提供（.tarot-flip-*）。
 */
export const FlipCard: React.FC<{
  card: TarotCard;
  reversed?: boolean;
  flipped: boolean;
  onFlip?: () => void;
  width?: number | string;
  eager?: boolean;
}> = ({ card, reversed, flipped, onFlip, width, eager }) => (
  <div style={{ perspective: '900px', width }} className="shrink-0">
    <div
      role={onFlip ? 'button' : undefined}
      aria-label={onFlip ? `翻开${card.nameCn}` : `${card.nameCn}${reversed ? '（逆位）' : ''}`}
      onClick={onFlip}
      className={`tarot-flip-inner relative w-full ${onFlip && !flipped ? 'cursor-pointer' : ''}`}
      style={{ aspectRatio: CARD_RATIO, transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)' }}
    >
      <div className="tarot-flip-face absolute inset-0">
        <CardBack className="h-full w-full rounded-[6px] shadow-[0_10px_24px_rgba(0,0,0,0.5)] ring-1 ring-[#c9a227]/40" />
      </div>
      <div className="tarot-flip-face absolute inset-0" style={{ transform: 'rotateY(180deg)' }}>
        <TarotThumb
          card={card}
          reversed={reversed}
          eager={eager}
          className="h-full w-full rounded-[6px] shadow-[0_10px_24px_rgba(0,0,0,0.5)] ring-1 ring-[#c9a227]/50"
        />
      </div>
    </div>
  </div>
);
