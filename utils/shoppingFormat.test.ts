import { describe, it, expect } from 'vitest';
import {
  sanitizeOrderField,
  parseShoppingAmount,
  buildItemsText,
  buildShoppingOrderTag,
  parseShoppingOrderTag,
  shoppingOrderPromptPlaceholder,
} from './shoppingFormat';
import type { ShoppingOrder } from './shoppingTypes';

const mkOrder = (over: Partial<ShoppingOrder> = {}): ShoppingOrder => ({
  id: 'ORD20260902ABC123',
  placedBy: 'user',
  recipientType: 'char',
  recipientName: '小雪',
  addressText: '北京市朝阳区望京SOHO T1',
  shopId: 'shop_node1',
  shopName: '蜜雪冰城（望京店）',
  shopCat: '奶茶饮品',
  items: [
    { dishId: 'd1', name: '冰鲜柠檬水', unitPrice: 4, qty: 1, lineTotal: 4 },
    { dishId: 'd2', name: '珍珠奶茶', unitPrice: 6, qty: 2, lineTotal: 12 },
  ],
  itemCount: 3,
  subtotal: 16,
  deliveryFee: 2,
  total: 18,
  payMethod: 'bank_card',
  cardLabel: '零花钱卡·8888',
  status: 'paid',
  statusHistory: [{ status: 'paid', at: 0 }],
  createdAt: 0,
  ...over,
});

describe('shoppingFormat', () => {
  it('sanitizeOrderField 剥掉分隔符与括号', () => {
    expect(sanitizeOrderField('奶茶|超大;杯')).toBe('奶茶 超大 杯');
    expect(sanitizeOrderField('  多  空格 ')).toBe('多 空格');
  });

  it('parseShoppingAmount 容错解析金额', () => {
    expect(parseShoppingAmount('¥12.9')).toBe(12.9);
    expect(parseShoppingAmount('1,280元')).toBe(1280);
    expect(parseShoppingAmount('18')).toBe(18);
    expect(parseShoppingAmount('')).toBeNull();
    expect(parseShoppingAmount(null)).toBeNull();
    expect(parseShoppingAmount('abc')).toBeNull();
  });

  it('buildItemsText 输出 名称×数量 列表', () => {
    expect(buildItemsText([{ name: '柠檬水', qty: 1 }, { name: '奶茶', qty: 2 }])).toBe('柠檬水×1;奶茶×2');
  });

  it('build → parse 往返一致（含中文与特殊字符清洗）', () => {
    const o = mkOrder({ addressText: '北京|朝阳区;某地' });
    const tag = buildShoppingOrderTag(o);
    expect(tag.startsWith('[[SHOPPING_ORDER|')).toBe(true);
    expect(tag.endsWith(']]')).toBe(true);
    const parsed = parseShoppingOrderTag('我点了外卖\n' + tag);
    expect(parsed).not.toBeNull();
    expect(parsed!.id).toBe(o.id);
    expect(parsed!.shop).toBe(o.shopName);
    expect(parsed!.recipient).toBe('小雪');
    expect(parsed!.total).toBe(18);
    expect(parsed!.status).toBe('paid');
    expect(parsed!.addr).not.toContain('|');
    expect(parsed!.items).toContain('冰鲜柠檬水×1');
  });

  it('parse 无标签/坏标签返回 null', () => {
    expect(parseShoppingOrderTag('普通消息')).toBeNull();
    expect(parseShoppingOrderTag('[[SHOPPING_ORDER|shop=只有店名]]')).toBeNull();
  });

  it('非法 status 回落到 paid', () => {
    const tag = buildShoppingOrderTag(mkOrder()).replace('status=paid', 'status=whatever');
    expect(parseShoppingOrderTag(tag)!.status).toBe('paid');
  });

  it('占位符包含店名/金额/状态', () => {
    const parsed = parseShoppingOrderTag(buildShoppingOrderTag(mkOrder()))!;
    const ph = shoppingOrderPromptPlaceholder(parsed);
    expect(ph).toContain('蜜雪冰城');
    expect(ph).toContain('18');
    expect(ph).toContain('已付款');
  });
});
