import React, { useState } from 'react';
import type { CharacterProfile, UserProfile } from '../../types';
import { cardById, spreadById } from '../../utils/tarotData';
import { requestTarotReading, type TarotLlmApi } from '../../utils/tarotLlm';
import type { TarotReadingRecord } from '../../utils/tarotReading';
import { TarotThumb } from './TarotCards';

interface Props {
  record: TarotReadingRecord;
  /** 解读者：char 目标即 TA 自己；自己目标则为当前活跃角色；拿不到则不显示解读按钮 */
  reader?: CharacterProfile;
  api: TarotLlmApi;
  user: UserProfile;
  addToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
  onRecordChange: (next: TarotReadingRecord) => void;
}

/** 一次占卜的完整解读页：本地速览永远可用，「让 TA 解读」按需调 LLM。 */
export const ReadingView: React.FC<Props> = ({ record, reader, api, user, addToast, onRecordChange }) => {
  const [asking, setAsking] = useState(false);
  const spread = spreadById(record.spreadId);
  const summaryLines = record.localSummary.split('\n');
  const rollup = summaryLines.length > 1 ? summaryLines[summaryLines.length - 1] : '';

  const askReader = async () => {
    if (!reader) { addToast('还没有可解读的角色', 'error'); return; }
    if (!api.apiKey) { addToast('请先在设置里配置 API Key', 'error'); return; }
    if (!spread) return;
    setAsking(true);
    try {
      const text = await requestTarotReading(api, reader, user, {
        querentName: record.targetName,
        question: record.question,
        spread,
        drawn: record.cards.map((c) => {
          const card = cardById(c.cardId)!;
          const pos = spread.positions.find((p) => p.name === c.positionName);
          return {
            card,
            reversed: c.reversed,
            positionName: c.positionName,
            positionMeaning: pos?.meaning ?? '',
          };
        }),
      });
      onRecordChange({ ...record, charReading: text, readerId: reader.id, readerName: reader.name });
    } catch {
      addToast('TA 暂时没回应，稍后再试（本地速览不受影响）', 'error');
    } finally {
      setAsking(false);
    }
  };

  return (
    <div className="space-y-4">
      {record.question && (
        <p className="font-serif text-[#f5f0e1]/90 text-sm leading-relaxed border-l-2 border-[#c9a227]/60 pl-3">
          问：{record.question}
        </p>
      )}
      <div className="space-y-3">
        {record.cards.map((c, i) => {
          const card = cardById(c.cardId);
          if (!card) return null;
          const face = c.reversed ? card.reversed : card.upright;
          return (
            <div
              key={`${c.cardId}-${i}`}
              className="tarot-reveal flex gap-3 rounded border border-[#8b7355]/30 bg-[#f5f0e1]/[0.06] p-3"
              style={{ animationDelay: `${Math.min(i * 90, 600)}ms` }}
            >
              <TarotThumb card={card} reversed={c.reversed} className="w-12 shrink-0 rounded-[4px] ring-1 ring-[#c9a227]/40" />
              <div className="min-w-0">
                <div className="flex items-center gap-2 font-serif">
                  <span className="text-[11px] text-[#c9a227]">{c.positionName}</span>
                  <span className="text-sm text-[#f5f0e1]">{card.nameCn}</span>
                  <span className={`text-[10px] px-1.5 py-px rounded border ${c.reversed ? 'text-[#e0a080] border-[#e0a080]/40' : 'text-[#a8c69f] border-[#a8c69f]/40'}`}>
                    {c.reversed ? '逆位' : '正位'}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-[#c9a227]/80 font-serif">{face.keywords.join(' · ')}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-[#f5f0e1]/80 font-serif">{face.meaning}</p>
              </div>
            </div>
          );
        })}
      </div>
      {rollup && (
        <p className="font-serif text-xs leading-relaxed text-[#f5f0e1]/60 px-1">{rollup}</p>
      )}
      {record.charReading ? (
        <div className="rounded border border-[#8b7355]/40 bg-[#f5f0e1] p-4 shadow-md">
          <div className="flex items-center gap-2 font-serif">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#8b1a1a] text-[#f5f0e1] text-xs font-bold">印</span>
            <span className="text-sm text-[#3d2b1f]">{record.readerName ?? 'TA'} 的解读</span>
          </div>
          <p className="mt-2 whitespace-pre-wrap font-serif text-sm leading-loose text-[#3d2b1f]">{record.charReading}</p>
        </div>
      ) : (
        reader && (
          <button
            onClick={askReader}
            disabled={asking}
            className="w-full rounded border border-[#c9a227]/60 bg-[#c9a227]/10 py-2.5 font-serif text-sm tracking-widest text-[#e8c96a] transition-all active:scale-[0.98] disabled:opacity-50"
          >
            {asking ? 'TA 正在凝视星象…' : `让${reader.name}解读`}
          </button>
        )
      )}
    </div>
  );
};
