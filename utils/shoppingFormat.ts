// ============================================================
// 订单 → 聊天消息标签（[[SHOPPING_ORDER|...]]）build / parse
// 范式对齐 transferFormat.ts：金额解析容错、分隔符清洗、失败整块剥离保正文。
// ============================================================
import type { ShoppingOrder, OrderStatus } from './shoppingTypes';
import { ORDER_STATUS_LABEL } from './shoppingTypes';

export const SHOPPING_ORDER_TAG = 'SHOPPING_ORDER';

/** 商品名/地址里不该出现的分隔符，生成期清洗 */
export function sanitizeOrderField(s: string): string {
  return (s || '')
    .replace(/[|;\[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 解析金额：¥12.9 / 12.9元 / 1,280 → number；失败 null */
export function parseShoppingAmount(raw?: string | null): number | null {
  if (!raw) return null;
  const m = String(raw).replace(/,/g, '').match(/(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  const v = parseFloat(m[1]);
  return Number.isFinite(v) ? v : null;
}

/** 从 items 构建紧凑列表文本： 冰鲜柠檬水×1;珍珠奶茶×2 */
export function buildItemsText(items: { name: string; qty: number }[]): string {
  return items
    .map(i => `${sanitizeOrderField(i.name)}×${i.qty}`)
    .join(';');
}

export interface ShoppingOrderTagData {
  id: string;
  shop: string;
  recipient: string;
  items: string;   // 冰鲜柠檬水×1;珍珠奶茶×2
  total: number;
  addr: string;
  status: OrderStatus;
  charId?: string;
}

/** 订单 → 标签文本（写入消息 content） */
export function buildShoppingOrderTag(o: ShoppingOrder): string {
  const parts: string[] = [];
  const push = (k: string, v: string | number) => parts.push(`${k}=${v}`);
  push('id', o.id);
  push('shop', sanitizeOrderField(o.shopName));
  push('recipient', sanitizeOrderField(o.recipientName));
  push('items', buildItemsText(o.items));
  push('total', o.total);
  push('addr', sanitizeOrderField(o.addressText));
  push('status', o.status);
  if (o.charId) push('charId', o.charId);
  return `[[${SHOPPING_ORDER_TAG}|${parts.join('|')}]]`;
}

/** 消息文本 → 订单卡数据（未匹配返回 null） */
export function parseShoppingOrderTag(text: string): ShoppingOrderTagData | null {
  if (!text || !text.includes(SHOPPING_ORDER_TAG)) return null;
  // 整条消息只处理一个订单标签；若有多个，取第一个，其余原样保留
  const re = /\[\[SHOPPING_ORDER\|([^\]]+)\]\]/;
  const m = text.match(re);
  if (!m) return null;
  const body = m[1];
  const fields: Record<string, string> = {};
  for (const seg of body.split('|')) {
    const idx = seg.indexOf('=');
    if (idx <= 0) continue;
    fields[seg.slice(0, idx).trim()] = seg.slice(idx + 1).trim();
  }
  const id = fields.id || '';
  const shop = fields.shop || '';
  if (!id || !shop) return null; // 关键字段缺失 → 整块剥离
  const total = parseShoppingAmount(fields.total) ?? 0;
  const status = (['pending_pay', 'paid', 'accepted', 'delivering', 'delivered', 'cancelled'] as OrderStatus[])
    .includes(fields.status as OrderStatus) ? fields.status as OrderStatus : 'paid';
  return {
    id,
    shop,
    recipient: fields.recipient || '',
    items: fields.items || '',
    total,
    addr: fields.addr || '',
    status,
    charId: fields.charId,
  };
}

/** 订单标签占位（喂给 LLM 的短占位） */
export function shoppingOrderPromptPlaceholder(d: ShoppingOrderTagData): string {
  const st = ORDER_STATUS_LABEL[d.status] || d.status;
  return `[购物订单 ${d.shop} ¥${d.total} ${st}]`;
}
