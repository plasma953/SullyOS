// ============================================================
// 聊天内购物订单卡 —— 由消息正文中的 [[SHOPPING_ORDER|...]] 标签渲染
// 点击卡片跳回 Shopping App（?openApp= 深链同款路径），携带 orderId。
// ============================================================
import React from 'react';
import { useOS } from '../../context/OSContext';
import { AppID } from '../../types';
import { ORDER_STATUS_LABEL, type OrderStatus } from '../../utils/shoppingTypes';

export interface ShoppingOrderTagViewData {
  id: string;
  shop: string;
  recipient: string;
  items: string; // "冰鲜柠檬水×1;珍珠奶茶×2"
  total: number;
  addr: string;
  status: OrderStatus;
}

const STATUS_COLOR: Record<OrderStatus, string> = {
  pending_pay: 'bg-amber-100 text-amber-700',
  paid: 'bg-emerald-100 text-emerald-700',
  accepted: 'bg-sky-100 text-sky-700',
  delivering: 'bg-indigo-100 text-indigo-700',
  delivered: 'bg-slate-200 text-slate-600',
  cancelled: 'bg-slate-100 text-slate-400',
};

export default function ShoppingOrderCard({ data }: { data: ShoppingOrderTagViewData }) {
  const { openApp } = useOS();

  const openInApp = (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      window.dispatchEvent(new CustomEvent('sullyos:open-shopping-order', { detail: { orderId: data.id } }));
    } catch { /* ignore */ }
    openApp(AppID.Shopping);
  };

  const itemLines = (data.items || '')
    .split(';')
    .map(s => s.trim())
    .filter(Boolean)
    .slice(0, 4);

  return (
    <div
      className="w-64 rounded-2xl overflow-hidden border border-yellow-200/70 shadow-sm bg-gradient-to-br from-amber-50 to-orange-50 select-none cursor-pointer active:scale-[0.98] transition-transform"
      onClick={openInApp}
    >
      <div className="flex items-center gap-2 px-3 py-2 bg-gradient-to-r from-amber-300 to-orange-300">
        <span className="text-lg">🛍️</span>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] text-amber-900/70 leading-none">购物订单 · 点单成功</div>
          <div className="text-[12px] font-bold text-amber-900 leading-tight truncate">{data.shop}</div>
        </div>
        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-white/70 text-amber-800 shrink-0">
          给{data.recipient || 'TA'}点的
        </span>
      </div>

      <div className="px-3 py-2 space-y-0.5">
        {itemLines.length > 0 ? itemLines.map((line, i) => (
          <div key={i} className="text-[11px] text-slate-600 truncate">{line}</div>
        )) : (
          <div className="text-[11px] text-slate-400">查看订单详情</div>
        )}
        {data.items && data.items.split(';').filter(Boolean).length > 4 && (
          <div className="text-[10px] text-slate-400">…等更多商品</div>
        )}
      </div>

      <div className="px-3 pb-1.5 flex items-center justify-between">
        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${STATUS_COLOR[data.status] || STATUS_COLOR.paid}`}>
          {ORDER_STATUS_LABEL[data.status] || data.status}
        </span>
        <span className="text-[13px] font-bold text-orange-600">¥{data.total}</span>
      </div>

      {data.addr && (
        <div className="px-3 pb-2 text-[9px] text-slate-400 truncate">📍 {data.addr}</div>
      )}
    </div>
  );
}
