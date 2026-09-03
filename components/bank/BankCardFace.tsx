import React from "react";
import type { BankCard } from "../../types";
import BankBrandIcon from "../BankBrandIcon";
import { BANK_ICON_MAP, bankCardGradient } from "../../utils/bankIcons";

export type CardNetwork = "visa" | "master" | "unionpay";

/** Stable decorative network mark derived from card id (display only). */
export const networkOfCard = (id: string): CardNetwork => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = ((h * 31 + id.charCodeAt(i)) >>> 0);
  const kinds: CardNetwork[] = ["visa", "master", "unionpay"];
  return kinds[h % kinds.length];
};

const NetworkMark: React.FC<{ kind: CardNetwork }> = ({ kind }) => {
  if (kind === "visa") {
    return <span className="italic font-black tracking-widest text-[13px] text-white/95">VISA</span>;
  }
  if (kind === "master") {
    return (
      <span className="flex items-center" aria-hidden="true">
        <span className="w-5 h-5 rounded-full bg-red-500/90 inline-block" />
        <span className="w-5 h-5 rounded-full bg-amber-400/90 inline-block -ml-2.5 mix-blend-screen" />
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1" aria-hidden="true">
      <span className="flex items-stretch h-4">
        <span className="w-1.5 rounded-l-sm bg-red-500/90 inline-block" />
        <span className="w-1.5 bg-blue-800/90 inline-block" />
        <span className="w-1.5 rounded-r-sm bg-cyan-400/80 inline-block" />
      </span>
      <span className="text-[11px] font-bold text-white/95">银联</span>
    </span>
  );
};

const ContactlessMark: React.FC = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M6 9a8 8 0 0 1 0 6" />
    <path d="M9.5 6.5a12 12 0 0 1 0 11" />
    <path d="M13 4a16 16 0 0 1 0 16" />
  </svg>
);

const ChipMark: React.FC = () => (
  <span className="relative inline-block w-11 h-8 rounded-md overflow-hidden shrink-0" style={{ background: "linear-gradient(135deg, #f7dc8f 0%, #d9ab4f 55%, #a97e2f 100%)" }} aria-hidden="true">
    <span className="absolute inset-0">
      <span className="absolute left-0 right-0 top-1/2 h-px bg-[#8a6a25]/70" />
      <span className="absolute top-0 bottom-0 left-1/2 w-px bg-[#8a6a25]/70" />
      <span className="absolute left-1 top-1 bottom-1 w-px bg-[#8a6a25]/50" />
      <span className="absolute right-1 top-1 bottom-1 w-px bg-[#8a6a25]/50" />
    </span>
    <span className="absolute inset-0 rounded-md border border-[#7c5f22]/60" />
  </span>
);

export interface BankCardFaceProps {
  card: BankCard;
  holderName?: string;
  flipped: boolean;
  onFlip: () => void;
};

const BankCardFace: React.FC<BankCardFaceProps> = ({ card, holderName, flipped, onFlip }) => {
  const brandLabel = BANK_ICON_MAP[card.brand || ""]?.label || "";
  const network = networkOfCard(card.id);
  const holder = (holderName || card.name || "").toUpperCase();
  const tail = (card.tailNo || "0000").slice(-4).padStart(4, "0");
  let seed = 7;
  for (let i = 0; i < card.id.length; i++) seed = ((seed * 33 + card.id.charCodeAt(i)) >>> 0);
  const pad4 = (n: number) => String(1000 + (n % 9000));
  const g1 = pad4(seed);
  const g2 = pad4(seed >> 3);
  const g3 = pad4(seed >> 6);
  const fullNo = `${g1}  ${g2}  ${g3}  ${tail}`;
  const expM = String(1 + ((seed >> 4) % 12)).padStart(2, "0");
  const expY = String(27 + ((seed >> 8) % 5));
  const cvv = String(100 + ((seed >> 11) % 900));
  const grad = bankCardGradient(card.brand);
  return (
    <div className="select-none" style={{ perspective: "900px" }}>
      <div onClick={onFlip} role="button" tabIndex={0} title="点击翻面查看CVV"
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onFlip(); } }}
        className="relative w-full h-44 cursor-pointer outline-none"
        style={{ transformStyle: "preserve-3d", transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)", transition: "transform 0.55s cubic-bezier(0.2, 0.7, 0.3, 1.2)" }}>
        {/* FRONT */}
        <div className="absolute inset-0 rounded-2xl p-4 text-white shadow-lg overflow-hidden"
          style={{ background: grad, backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden" }}>
          <div className="absolute inset-0 pointer-events-none" style={{ background: "repeating-linear-gradient(115deg, rgba(255,255,255,0.08) 0px, rgba(255,255,255,0.08) 1px, transparent 1px, transparent 5px)" }} />
          <div className="absolute inset-0 rounded-2xl pointer-events-none" style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.35), inset 0 -1px 0 rgba(0,0,0,0.28)" }} />
          <div className="absolute -top-10 -right-10 w-44 h-44 rounded-full bg-white/15 blur-2xl pointer-events-none" />
          <div className="absolute -bottom-12 -left-8 w-40 h-40 rounded-full bg-black/15 blur-2xl pointer-events-none" />
          <div className="relative h-full flex flex-col justify-between">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-1.5 min-w-0">
                <BankBrandIcon brand={card.brand} size={20} className="brightness-0 invert shrink-0" />
                <span className="text-[12px] font-bold truncate">{brandLabel ? `${brandLabel} · ` : ""}{card.name}</span>
                {card.isDefault && (<span className="text-[9px] px-1.5 py-0.5 rounded-full bg-white/25 text-white font-bold shrink-0">默认</span>)}
              </div>
              <NetworkMark kind={network} />
            </div>
            <div className="flex items-center gap-2.5">
              <ChipMark />
              <span className="text-white/80 rotate-90 inline-flex"><ContactlessMark /></span>
              <span className="ml-auto text-[15px] font-black tracking-wide">¥{card.balance.toFixed(2)}</span>
            </div>
            <div className="font-mono text-[15px] tracking-[0.12em] text-white/95">{fullNo}</div>
            <div className="flex items-end justify-between text-[10px] leading-tight">
              <div className="min-w-0">
                <div className="opacity-70">持卡人 CARD HOLDER</div>
                <div className="text-[11px] font-bold truncate max-w-[150px]">{holder || "-"}</div>
              </div>
              <div>
                <div className="opacity-70">有效期 VALID THRU</div>
                <div className="text-[11px] font-bold font-mono">{expM}/{expY}</div>
              </div>
              <div className="text-white/60">点击翻面 · CVV</div>
            </div>
          </div>
        </div>
        {/* BACK */}
        <div className="absolute inset-0 rounded-2xl p-0 text-white shadow-lg overflow-hidden"
          style={{ background: grad, backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden", transform: "rotateY(180deg)" }}>
          <div className="absolute inset-0 pointer-events-none" style={{ background: "repeating-linear-gradient(115deg, rgba(255,255,255,0.06) 0px, rgba(255,255,255,0.06) 1px, transparent 1px, transparent 5px)" }} />
          <div className="absolute inset-0 rounded-2xl pointer-events-none" style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.3), inset 0 -1px 0 rgba(0,0,0,0.28)" }} />
          <div className="relative h-full flex flex-col">
            <div className="h-10 mt-4 bg-black/80" />
            <div className="px-4 mt-3">
              <div className="text-[9px] opacity-70">签名条 SIGNATURE</div>
              <div className="mt-1 flex items-center gap-2">
                <div className="flex-1 h-8 rounded bg-white/90 px-2 flex items-center justify-end">
                  <span className="font-mono italic text-[13px] text-[#5D4037]">CVV {cvv}</span>
                </div>
              </div>
              <div className="mt-2 text-[10px] text-white/75">虚拟卡 · 仅限 SullyOS 内购物扣款 · 尾号 {tail}</div>
              <div className="mt-1 flex items-center justify-between">
                <span className="flex items-center gap-1 text-[10px] text-white/80"><BankBrandIcon brand={card.brand} size={14} className="brightness-0 invert" />{brandLabel}</span>
                <NetworkMark kind={network} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BankCardFace;

