import React, { useCallback, useEffect, useState } from 'react';
import { Books, CaretLeft, Scroll, Sparkle, Sun } from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import { useLocalDateKey } from '../hooks/useLocalDateKey';
import { CARDS, cardById, spreadById } from '../utils/tarotData';
import { drawDailyCard } from '../utils/tarotEngine';
import { buildLocalSummary, newReadingId, type TarotReadingRecord } from '../utils/tarotReading';
import { DB } from '../utils/db';
import ConfirmDialog from '../components/os/ConfirmDialog';
import { TarotThumb } from './tarot/TarotCards';
import { RitualView } from './tarot/RitualView';
import { LibraryView } from './tarot/LibraryView';
import { ReadingView } from './tarot/ReadingView';

const TAROT_CSS = `
.tarot-flip-inner { transform-style: preserve-3d; transition: transform .65s cubic-bezier(.25,.8,.3,1.1); }
.tarot-flip-face { backface-visibility: hidden; -webkit-backface-visibility: hidden; }
@keyframes tarotShuffle { 0%,100% { transform: translate(0,0) rotate(0deg); } 25% { transform: translate(-10px,-6px) rotate(-6deg); } 50% { transform: translate(8px,4px) rotate(5deg); } 75% { transform: translate(-6px,6px) rotate(-3deg); } }
.tarot-shuffle { animation: tarotShuffle .65s ease-in-out infinite; }
@keyframes tarotDealIn { from { opacity: 0; transform: translate(-50%,-50%) scale(.35); } to { opacity: 1; transform: translate(-50%,-50%) scale(1); } }
.tarot-deal { opacity: 0; animation: tarotDealIn .55s cubic-bezier(.2,.8,.3,1.1) forwards; }
@keyframes tarotRevealUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
.tarot-reveal { opacity: 0; animation: tarotRevealUp .5s ease-out forwards; }
@keyframes tarotGlow { 0%,100% { opacity: .45; } 50% { opacity: .85; } }
.tarot-glow { animation: tarotGlow 4s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .tarot-shuffle, .tarot-deal, .tarot-reveal, .tarot-glow { animation: none !important; opacity: 1 !important; }
  .tarot-flip-inner { transition: none; }
}
`;

type Tab = 'daily' | 'ritual' | 'library' | 'history';

const TABS: { id: Tab; name: string; Icon: typeof Sun }[] = [
  { id: 'daily', name: '今日', Icon: Sun },
  { id: 'ritual', name: '占卜', Icon: Sparkle },
  { id: 'library', name: '牌库', Icon: Books },
  { id: 'history', name: '记录', Icon: Scroll },
];

const DailyView: React.FC<{
  records: TarotReadingRecord[];
  refresh: () => void;
}> = ({ records, refresh }) => {
  const { characters, activeCharacterId, userProfile, apiConfig, addToast } = useOS();
  const dateKey = useLocalDateKey();
  const [targetId, setTargetId] = useState('user');
  const [record, setRecord] = useState<TarotReadingRecord | null>(null);

  const userName = userProfile?.name?.trim() || '你';
  const targetName = targetId === 'user' ? userName : characters.find((c) => c.id === targetId)?.name ?? 'TA';
  const reader =
    targetId === 'user'
      ? characters.find((c) => c.id === activeCharacterId) ?? characters[0]
      : characters.find((c) => c.id === targetId);

  useEffect(() => {
    let cancelled = false;
    const ensure = async () => {
      const existing = records.find((r) => r.kind === 'daily' && r.dateKey === dateKey && r.targetId === targetId);
      if (existing) { if (!cancelled) setRecord(existing); return; }
      const pick = drawDailyCard(dateKey, targetId, CARDS.length);
      const card = CARDS[pick.cardIndex];
      const spread = spreadById('daily')!;
      const rec: TarotReadingRecord = {
        id: newReadingId(),
        kind: 'daily',
        dateKey,
        targetId,
        targetName,
        spreadId: 'daily',
        cards: [{ cardId: card.id, reversed: pick.reversed, positionName: '今日运势' }],
        localSummary: buildLocalSummary(spread, [{
          card, reversed: pick.reversed, positionName: '今日运势', positionMeaning: spread.positions[0].meaning,
        }]),
        createdAt: Date.now(),
      };
      try {
        await DB.saveTarotReading(rec);
        refresh();
      } catch { /* 展示优先 */ }
      if (!cancelled) setRecord(rec);
    };
    setRecord(null);
    ensure();
    return () => { cancelled = true; };
    // records 变化时重跑：解读/删除后 Daily 页与「记录」页保持一致。
    // 收敛性：记录已存在即 early return，只有缺失时才 save+refresh，不会循环。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateKey, targetId, records]);

  if (!record) {
    return <p className="py-16 text-center font-serif text-sm text-[#f5f0e1]/50">正在为{targetName}抽今日之牌…</p>;
  }
  const saved = record.cards[0];
  const card = cardById(saved.cardId);
  if (!card) return null;
  const [mm, dd] = dateKey.split('-').slice(1);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setTargetId('user')}
          className={`rounded-full border px-4 py-1.5 font-serif text-sm active:scale-95 ${targetId === 'user' ? 'border-[#c9a227] bg-[#c9a227]/15 text-[#e8c96a]' : 'border-[#8b7355]/40 text-[#f5f0e1]/70'}`}
        >
          {userName}
        </button>
        {characters.map((c) => (
          <button
            key={c.id}
            onClick={() => setTargetId(c.id)}
            className={`rounded-full border px-4 py-1.5 font-serif text-sm active:scale-95 ${targetId === c.id ? 'border-[#c9a227] bg-[#c9a227]/15 text-[#e8c96a]' : 'border-[#8b7355]/40 text-[#f5f0e1]/70'}`}
          >
            {c.name}
          </button>
        ))}
      </div>
      <div className="tarot-reveal rounded border border-[#8b7355]/30 bg-[#2d4a3e]/30 p-5 text-center">
        <p className="font-serif text-[11px] tracking-[0.35em] text-[#c9a227]/80">{mm} 月 {dd} 日 · {targetName}的运势</p>
        <div className="mx-auto mt-3 w-40">
          <TarotThumb card={card} reversed={saved.reversed} eager className="w-full rounded-md ring-1 ring-[#c9a227]/60 shadow-[0_16px_36px_rgba(0,0,0,0.55)]" />
        </div>
        <p className="mt-3 font-serif text-lg tracking-widest text-[#f5f0e1]">
          {card.nameCn}
          <span className={`ml-2 align-middle text-[10px] tracking-normal px-1.5 py-px rounded border ${saved.reversed ? 'text-[#e0a080] border-[#e0a080]/40' : 'text-[#a8c69f] border-[#a8c69f]/40'}`}>
            {saved.reversed ? '逆位' : '正位'}
          </span>
        </p>
        <p className="mt-1 font-serif text-xs text-[#c9a227]/85">{(saved.reversed ? card.reversed : card.upright).keywords.join(' · ')}</p>
        <p className="mx-auto mt-2 max-w-[26rem] font-serif text-sm leading-loose text-[#f5f0e1]/85">{(saved.reversed ? card.reversed : card.upright).meaning}</p>
      </div>
      <ReadingView
        record={record}
        reader={reader}
        api={{ baseUrl: apiConfig.baseUrl, apiKey: apiConfig.apiKey, model: apiConfig.model }}
        user={userProfile}
        addToast={addToast}
        onRecordChange={async (next) => {
          setRecord(next);
          try { await DB.saveTarotReading(next); } catch { /* 展示优先 */ }
          refresh();
        }}
      />
    </div>
  );
};

const HistoryView: React.FC<{
  records: TarotReadingRecord[];
  refresh: () => void;
}> = ({ records, refresh }) => {
  const { characters, activeCharacterId, userProfile, apiConfig, addToast } = useOS();
  const [openId, setOpenId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const remove = async (id: string) => {
    try {
      await DB.deleteTarotReading(id);
      if (openId === id) setOpenId(null);
      refresh();
    } catch {
      addToast('删除失败', 'error');
    }
  };

  if (records.length === 0) {
    return (
      <div className="py-16 text-center">
        <p className="font-serif text-sm text-[#f5f0e1]/55">还没有占卜记录</p>
        <p className="mt-1 font-serif text-xs text-[#f5f0e1]/35">去「占卜」抽第一组牌，或看看「今日」运势</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <ConfirmDialog
        isOpen={pendingDeleteId != null}
        title="删除记录"
        message="删掉这次占卜记录？"
        variant="danger"
        confirmText="删除"
        onConfirm={() => { if (pendingDeleteId != null) remove(pendingDeleteId); setPendingDeleteId(null); }}
        onCancel={() => setPendingDeleteId(null)}
      />
      {records.map((r) => {
        const spread = spreadById(r.spreadId);
        const open = openId === r.id;
        const reader =
          r.targetId === 'user'
            ? characters.find((c) => c.id === activeCharacterId) ?? characters[0]
            : characters.find((c) => c.id === r.targetId);
        return (
          <div key={r.id} className="overflow-hidden rounded border border-[#8b7355]/30 bg-[#f5f0e1]/[0.045]">
            <button onClick={() => setOpenId(open ? null : r.id)} className="w-full p-3 text-left active:bg-[#f5f0e1]/[0.03]">
              <div className="flex items-center gap-2 font-serif">
                <span className={`shrink-0 rounded border px-1.5 py-px text-[10px] ${r.kind === 'daily' ? 'border-[#c9a227]/50 text-[#e8c96a]' : 'border-[#8b7355]/50 text-[#f5f0e1]/60'}`}>
                  {r.kind === 'daily' ? '每日' : '牌阵'}
                </span>
                <span className="truncate text-sm text-[#f5f0e1]">{r.question || spread?.nameCn || '占卜'}</span>
                <span className="ml-auto shrink-0 text-[10px] text-[#f5f0e1]/40">{r.dateKey.slice(5)} · {r.targetName}</span>
              </div>
              <div className="mt-2 flex gap-1.5">
                {r.cards.slice(0, 7).map((c, i) => {
                  const card = cardById(c.cardId);
                  return card ? (
                    <TarotThumb key={i} card={card} reversed={c.reversed} className="w-8 rounded-[3px] ring-1 ring-[#c9a227]/30" />
                  ) : null;
                })}
                {r.cards.length > 7 && <span className="self-center font-serif text-[10px] text-[#f5f0e1]/40">+{r.cards.length - 7}</span>}
              </div>
            </button>
            {open && (
              <div className="border-t border-[#8b7355]/25 p-3">
                <ReadingView
                  record={r}
                  reader={reader}
                  api={{ baseUrl: apiConfig.baseUrl, apiKey: apiConfig.apiKey, model: apiConfig.model }}
                  user={userProfile}
                  addToast={addToast}
                  onRecordChange={async (next) => {
                    try { await DB.saveTarotReading(next); } catch { /* 展示优先 */ }
                    refresh();
                  }}
                />
                <button
                  onClick={() => setPendingDeleteId(r.id)}
                  className="mt-3 w-full rounded border border-[#8b1a1a]/50 py-1.5 font-serif text-xs text-[#e08080]/80 active:scale-[0.98]"
                >
                  删除这条记录
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export const TarotApp: React.FC = () => {
  const { closeApp, characters, activeCharacterId, userProfile, apiConfig, addToast } = useOS();
  const [tab, setTab] = useState<Tab>('daily');
  const [records, setRecords] = useState<TarotReadingRecord[]>([]);
  const todayKey = useLocalDateKey();

  const refresh = useCallback(async () => {
    try {
      const list = await DB.getTarotReadings();
      setRecords(list.sort((a, b) => b.createdAt - a.createdAt).slice(0, 200));
    } catch {
      setRecords([]);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <div
      className="relative flex h-full w-full flex-col overflow-hidden font-serif"
      style={{ background: 'linear-gradient(180deg, #1c130c 0%, #3d2b1f 60%, #2a1d13 100%)' }}
    >
      <style>{TAROT_CSS}</style>
      <div className="tarot-glow pointer-events-none absolute -top-24 left-1/2 h-64 w-64 -translate-x-1/2 rounded-full" style={{ background: 'radial-gradient(circle, rgba(201,162,39,0.22) 0%, transparent 70%)' }} />

      <div className="shrink-0 px-4" style={{ paddingTop: 'calc(var(--chrome-top) + 0.25rem)' }}>
        <div className="flex items-center gap-3">
          <button
            onClick={closeApp}
            aria-label="返回桌面"
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#8b7355]/40 text-[#f5f0e1]/80 active:scale-95"
          >
            <CaretLeft size={16} weight="bold" />
          </button>
          <div>
            <h1 className="text-lg tracking-[0.35em] text-[#f5f0e1]">塔 罗</h1>
            <p className="text-[10px] tracking-[0.25em] text-[#c9a227]/70">A R C A N A</p>
          </div>
        </div>
      </div>

      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {tab === 'daily' && <DailyView records={records} refresh={refresh} />}
        {tab === 'ritual' && (
          <RitualView
            characters={characters}
            activeCharacterId={activeCharacterId}
            userProfile={userProfile}
            apiConfig={apiConfig}
            addToast={addToast}
            dateKey={todayKey}
            onSaved={refresh}
          />
        )}
        {tab === 'library' && <LibraryView />}
        {tab === 'history' && <HistoryView records={records} refresh={refresh} />}
      </div>

      <nav
        className="grid shrink-0 grid-cols-4 border-t border-[#c9a227]/25 bg-[#1c130c]/95"
        style={{ paddingBottom: 'calc(var(--safe-bottom) + 0.5rem)', paddingTop: '0.5rem' }}
      >
        {TABS.map(({ id, name, Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex flex-col items-center gap-0.5 py-1 active:scale-95 ${tab === id ? 'text-[#e8c96a]' : 'text-[#f5f0e1]/45'}`}
          >
            <Icon size={20} weight={tab === id ? 'fill' : 'regular'} />
            <span className="text-[10px] tracking-widest">{name}</span>
          </button>
        ))}
      </nav>
    </div>
  );
};

export default TarotApp;
