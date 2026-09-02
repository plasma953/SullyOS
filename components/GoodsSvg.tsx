/** 商品图：统一本地 SVG（外卖/购物双 App 共用）。无任何外链图片。 */
import React from 'react';

const SKINS: Record<string, { from: string; to: string; icon: React.ReactNode }> = {
  food:    { from: '#f97316', to: '#fb923c', icon: <><path d="M8 11h8v7a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1v-7Z"/><path d="M6.5 8.5h11" strokeLinecap="round"/><path d="M9 5.5c0-1 1-1.5 1.5-2M13 4.5c.4-.8 1.2-.8 1.5-1.5" strokeLinecap="round"/></> },
  drink:   { from: '#06b6d4', to: '#22d3ee', icon: <><path d="M7 8h10l-1 10a2 2 0 0 1-2 1.8h-4A2 2 0 0 1 8 18L7 8Z"/><path d="M7 8h10"/><path d="M9 4.5c2-1.5 4 1 6-.5" strokeLinecap="round"/></> },
  dessert: { from: '#ec4899', to: '#f472b6', icon: <><circle cx="9.5" cy="12.5" r="2.5"/><circle cx="14.5" cy="12.5" r="2.5"/><path d="M9.5 15h5"/><path d="M6 19.5h12" strokeLinecap="round"/></> },
  snack:   { from: '#eab308', to: '#facc15', icon: <><path d="M8 7h8v3l-1 9H9L8 10V7Z"/><path d="M9.5 7 12 4l2.5 3"/></> },
  fresh:   { from: '#22c55e', to: '#4ade80', icon: <><path d="M7 9c0 5 2 10 5 11 3-1 5-6 5-11-3 0-5 1-5 1s-2-1-5-1Z"/><path d="M12 20v-5" strokeLinecap="round"/></> },
  health:  { from: '#14b8a6', to: '#2dd4bf', icon: <><path d="M12 6l6 10H6l6-10Z"/><path d="M12 6V3" strokeLinecap="round"/><path d="M9 16h6" strokeLinecap="round"/></> },
  flower:  { from: '#f43f5e', to: '#fb7185', icon: <><circle cx="12" cy="10" r="3"/><path d="M12 13v7" strokeLinecap="round"/><path d="M12 16c2 0 3-1 3.5-2M12 16c-2 0-3-1-3.5-2" strokeLinecap="round"/></> },
  fashion: { from: '#8b5cf6', to: '#a78bfa', icon: <><path d="M8 4l4 5 4-5"/><path d="M9 9h6l3 11H6L9 9Z"/></> },
  sport:   { from: '#ef4444', to: '#f87171', icon: <><circle cx="12" cy="12" r="8"/><path d="M12 6c2 3 2 9 0 12M6.5 9.5h11M6.5 14.5h11" strokeLinecap="round"/></> },
  digital: { from: '#3b82f6', to: '#60a5fa', icon: <><rect x="7" y="3" width="10" height="18" rx="2"/><path d="M10.5 18h3" strokeLinecap="round"/></> },
  beauty:  { from: '#d946ef', to: '#e879f9', icon: <><rect x="8" y="8" width="8" height="12" rx="1"/><path d="M10 8V5a2 2 0 0 1 4 0v3"/></> },
  jewel:   { from: '#f59e0b', to: '#fbbf24', icon: <><path d="M12 4l3 4-3 12-3-12 3-4Z"/><path d="M9 8h6"/></> },
  home:    { from: '#84cc16', to: '#a3e635', icon: <><path d="M5 11l7-6 7 6"/><path d="M7 11v9h10v-9"/></> },
  book:    { from: '#6366f1', to: '#818cf8', icon: <><path d="M5 5h6a2 2 0 0 1 2 2v13a2 2 0 0 0-2-2H5V5Z"/><path d="M19 5h-6a2 2 0 0 0-2 2v13a2 2 0 0 1 2-2h6V5Z"/></> },
  mall:    { from: '#0ea5e9', to: '#38bdf8', icon: <><path d="M4 9h16l-1.5 11h-13L4 9Z"/><path d="M8 9V6a4 4 0 0 1 8 0v3"/></> },
};

const hash32 = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
};

interface GoodsSvgProps {
  imgKey?: string;
  name?: string;
  className?: string;
}

export default function GoodsSvg({ imgKey, name, className }: GoodsSvgProps) {
  const skin = SKINS[imgKey || ''] || SKINS.food;
  const uid = hash32(imgKey + '|' + (name || ''));
  const rot = (uid % 24) - 12;
  return (
    <div className={className} style={{
      background: `linear-gradient(135deg, ${skin.from}33 0%, ${skin.to}22 100%), linear-gradient(135deg, ${skin.to}55 0%, ${skin.from}22 100%)`,
      position: 'relative', overflow: 'hidden', flexShrink: 0,
    }}>
      <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.4" strokeLinejoin="round"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.9 }}>
        <g transform={`translate(12 12) scale(0.62) rotate(${rot}) translate(-12 -12)`}>{skin.icon}</g>
      </svg>
      <span style={{
        position: 'absolute', right: '2px', bottom: '1px', fontSize: '7px', fontWeight: 700,
        color: 'rgba(255,255,255,0.75)', letterSpacing: '0.5px',
      }}>{(name || '?').slice(0, 1)}</span>
    </div>
  );
}
