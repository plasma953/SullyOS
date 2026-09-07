import React, { useMemo, useState } from 'react';
import { CARDS, type TarotArcana, type TarotCard } from '../../utils/tarotData';
import { TarotThumb } from './TarotCards';

const SUITS: { id: TarotArcana; name: string }[] = [
  { id: 'major', name: '大阿尔卡纳' },
  { id: 'wands', name: '权杖 · 火' },
  { id: 'cups', name: '圣杯 · 水' },
  { id: 'swords', name: '宝剑 · 风' },
  { id: 'pentacles', name: '星币 · 土' },
];

const SectionHead: React.FC<{ title: string; count: string }> = ({ title, count }) => (
  <div className="group flex items-center gap-2">
    <span className="font-serif text-xs tracking-[0.3em] text-[#c9a227]">{title}</span>
    <span className="h-px w-4 bg-[#c9a227]/50 transition-all duration-300 group-hover:w-12" />
    <span className="font-serif text-[10px] text-[#f5f0e1]/40">{count}</span>
  </div>
);

const CardCell: React.FC<{ card: TarotCard; onOpen: (c: TarotCard) => void }> = ({ card, onOpen }) => (
  <button
    onClick={() => onOpen(card)}
    className="group flex w-full items-center gap-3 rounded border border-[#8b7355]/30 bg-[#f5f0e1]/[0.04] p-2.5 text-left transition-all active:scale-[0.99]"
  >
    <TarotThumb card={card} className="w-12 shrink-0 rounded-[4px] grayscale-[25%] transition-all duration-300 group-hover:grayscale-0" />
    <div className="min-w-0 flex-1 py-0.5">
      <p className="truncate font-serif text-sm text-[#f5f0e1] transition-colors group-hover:text-[#e8c96a]">
        {card.nameCn}
        <span className="ml-2 font-serif text-[10px] tracking-widest text-[#c9a227]/60">{String(card.num).padStart(2, '0')}</span>
      </p>
      <p className="truncate font-serif text-[11px] italic text-[#f5f0e1]/45">{card.nameEn}</p>
      <p className="mt-0.5 truncate font-serif text-[11px] text-[#f5f0e1]/55">{card.upright.keywords.join(' · ')}</p>
    </div>
    <span className="shrink-0 font-serif text-base text-[#f5f0e1]/25 transition-colors group-hover:text-[#e8c96a]">›</span>
  </button>
);

const CardDetail: React.FC<{ card: TarotCard; onBack: () => void }> = ({ card, onBack }) => {
  const [face, setFace] = useState<'upright' | 'reversed'>('upright');
  const f = card[face];
  return (
    <div className="tarot-reveal space-y-4">
      <button onClick={onBack} className="font-serif text-xs tracking-widest text-[#f5f0e1]/60 active:scale-95">← 回牌库</button>
      <div className="mx-auto w-52">
        <TarotThumb card={card} reversed={face === 'reversed'} eager className="w-full rounded-md ring-1 ring-[#c9a227]/50 shadow-[0_14px_30px_rgba(0,0,0,0.5)]" />
      </div>
      <div className="text-center font-serif">
        <p className="text-xl tracking-widest text-[#f5f0e1]">{card.nameCn}</p>
        <p className="mt-0.5 text-xs italic text-[#f5f0e1]/50">{card.nameEn}</p>
        {(card.element || card.astrology) && (
          <p className="mt-1 text-[11px] text-[#c9a227]/80">{[card.element, card.astrology].filter(Boolean).join(' · ')}</p>
        )}
      </div>
      <div className="mx-auto grid w-52 grid-cols-2 gap-2">
        {(['upright', 'reversed'] as const).map((k) => (
          <button
            key={k}
            onClick={() => setFace(k)}
            className={`rounded border py-1.5 font-serif text-xs tracking-widest active:scale-95 ${face === k ? 'border-[#c9a227] bg-[#c9a227]/15 text-[#e8c96a]' : 'border-[#8b7355]/40 text-[#f5f0e1]/60'}`}
          >
            {k === 'upright' ? '正位' : '逆位'}
          </button>
        ))}
      </div>
      <div className="rounded border border-[#8b7355]/30 bg-[#f5f0e1]/[0.05] p-4 font-serif">
        <p className="text-xs tracking-widest text-[#c9a227]">{f.keywords.join(' · ')}</p>
        <p className="mt-2 text-sm leading-loose text-[#f5f0e1]/85">{f.meaning}</p>
      </div>
    </div>
  );
};

export const LibraryView: React.FC = () => {
  const [query, setQuery] = useState('');
  const [suit, setSuit] = useState<TarotArcana | 'all'>('all');
  const [openId, setOpenId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return CARDS.filter((c) => {
      if (suit !== 'all' && c.arcana !== suit) return false;
      if (!q) return true;
      return (
        c.nameCn.includes(query.trim()) ||
        c.nameEn.toLowerCase().includes(q) ||
        c.upright.keywords.some((k) => k.includes(query.trim()))
      );
    });
  }, [query, suit]);

  const openCard = openId ? CARDS.find((c) => c.id === openId) : undefined;
  if (openCard) return <CardDetail card={openCard} onBack={() => setOpenId(null)} />;

  const open = (c: TarotCard) => setOpenId(c.id);
  const groups = suit === 'all' ? SUITS : SUITS.filter((s) => s.id === suit);

  return (
    <div className="space-y-5">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="搜牌名或关键词，如 月亮 / 选择"
        maxLength={20}
        className="w-full rounded border border-[#8b7355]/40 bg-[#f5f0e1]/[0.07] px-3 py-2 font-serif text-sm text-[#f5f0e1] placeholder:text-[#8b7355]/60 focus:outline-none focus:border-[#c9a227]/70"
      />
      <div className="flex gap-2 overflow-x-auto no-scrollbar">
        {[{ id: 'all' as const, name: '全部' }, ...SUITS].map((s) => (
          <button
            key={s.id}
            onClick={() => setSuit(s.id)}
            className={`shrink-0 rounded-full border px-3.5 py-1 font-serif text-xs active:scale-95 ${suit === s.id ? 'border-[#c9a227] bg-[#c9a227]/15 text-[#e8c96a]' : 'border-[#8b7355]/40 text-[#f5f0e1]/60'}`}
          >
            {s.name}
          </button>
        ))}
      </div>
      {filtered.length === 0 && (
        <p className="py-10 text-center font-serif text-sm text-[#f5f0e1]/50">牌堆里没有这张，换个词试试</p>
      )}
      {groups.map((g) => {
        const list = filtered.filter((c) => c.arcana === g.id);
        if (list.length === 0) return null;
        return (
          <section key={g.id} className="space-y-2">
            <SectionHead title={g.name} count={`${list.length} 张`} />
            <div className="space-y-1.5">
              {list.map((c) => (
                <CardCell key={c.id} card={c} onOpen={open} />
              ))}
            </div>
          </section>
        );
      })}
      <p className="pt-2 text-center font-serif text-[10px] leading-relaxed text-[#f5f0e1]/30">牌义以 Waite《Pictorial Key to the Tarot》为准转写 · 牌图为 Smith 韦特公有领域版本</p>
    </div>
  );
};
