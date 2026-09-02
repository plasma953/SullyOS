// ============================================================
// 购物 App 类型定义 —— 真实店面（OSM）× 真实商品（OFF/品牌名录）
// 数据来源：Overpass API (ODbL) / Open Food Facts (ODbL + CC-BY-SA 图)
// ============================================================

export type ShopCategory =
  | '美食外卖'
  | '奶茶饮品'
  | '甜品蛋糕'
  | '超市便利'
  | '生鲜果蔬'
  | '医药健康'
  | '鲜花绿植';

export const SHOP_CATEGORIES: ShopCategory[] = [
  '美食外卖', '奶茶饮品', '甜品蛋糕', '超市便利', '生鲜果蔬', '医药健康', '鲜花绿植',
];

export const CATEGORY_EMOJI: Record<ShopCategory, string> = {
  '美食外卖': '🍜',
  '奶茶饮品': '🧋',
  '甜品蛋糕': '🍰',
  '超市便利': '🏪',
  '生鲜果蔬': '🥬',
  '医药健康': '💊',
  '鲜花绿植': '💐',
};

/** OSM POI 清洗后的店铺 */
export interface ShoppingShop {
  id: string;              // shop_node123456
  name: string;            // 真实店名（name:zh 优先）
  cat: ShopCategory;
  city?: string;           // 软性城市标签（仅排序用）
  brand?: string;
  cuisine?: string;
  rating?: number;         // 生成器补齐 4.2–4.9
  monthlySales?: number;
  minOrder?: number;       // 起送价
  deliveryFee?: number;
  deliveryTime?: string;
  imageEmoji?: string;
  hours?: string;
}

export interface DishSpecOption { label: string; priceDelta: number; }
export interface DishSpecGroup { name: string; required?: boolean; options: DishSpecOption[]; }

/** 菜品/商品（品牌名录生成 或 OFF 真实商品） */
export interface ShoppingDish {
  id: string;              // dish_{shopId}_{n} 或 off_{code}
  shopId: string;
  name: string;
  price: number;
  cat: string;             // 店内分类（招牌推荐/热销/…）
  desc?: string;
  qty?: string;            // 规格 e.g. 550ml
  brand?: string;
  img?: string;            // (已弃用 v2)历史字段，保留兼容
  imgKey?: string;         // 品类 SVG 键（GoodsSvg 渲染）
  monthlySales?: number;
  specGroups?: DishSpecGroup[];
}

export interface CartItem {
  dishId: string;
  name: string;
  unitPrice: number;       // 含规格加价
  qty: number;
  specs?: string[];        // 已选规格 label
  img?: string;
  imgKey?: string;         // 品类 SVG 键
  lineTotal: number;
}

/** 购物车：按「被点单人」隔离（key = recipientType:charId|user） */
export interface ShoppingCart {
  key: string;
  recipientType: 'user' | 'char';
  charId?: string;
  recipientName: string;
  addressText: string;     // 收货地址快照
  cityTag?: string;
  shopId?: string;         // 单店车（外卖惯例）
  shopName?: string;
  items: CartItem[];
  updatedAt: number;
}

export type OrderStatus =
  | 'pending_pay' | 'paid' | 'accepted' | 'delivering' | 'delivered' | 'cancelled';

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  pending_pay: '待付款',
  paid: '已付款',
  accepted: '商家接单',
  delivering: '配送中',
  delivered: '已送达',
  cancelled: '已取消',
};

export interface ShoppingOrder {
  id: string;              // ORD + YYYYMMDD + 6位随机
  charId?: string;         // 给 char 点单时关联
  placedBy: 'user' | 'char';
  recipientType: 'user' | 'char';
  recipientName: string;
  addressText: string;
  shopId: string;
  shopName: string;
  shopCat: string;
  items: CartItem[];
  itemCount: number;
  subtotal: number;
  deliveryFee: number;
  total: number;
  payMethod: 'bank_card';
  cardLabel?: string;      // 支付卡「名称·尾号」
  status: OrderStatus;
  statusHistory: { status: OrderStatus; at: number }[];
  createdAt: number;
  deliveredAt?: number;
}

// ============================================================
// 购物 App（淘宝式）类型 —— 与外卖类型完全分离
// ============================================================
export type MallCategory = '服饰鞋包' | '运动户外' | '数码家电' | '美妆个护' | '珠宝腕表' | '家居家具' | '图书文具' | '商超百货';

export const MALL_CATEGORIES: MallCategory[] = ['服饰鞋包', '运动户外', '数码家电', '美妆个护', '珠宝腕表', '家居家具', '图书文具', '商超百货'];

export const MALL_CATEGORY_EMOJI: Record<MallCategory, string> = {
  '服饰鞋包': '👗', '运动户外': '⚽', '数码家电': '📱', '美妆个护': '💄',
  '珠宝腕表': '💎', '家居家具': '🛋️', '图书文具': '📚', '商超百货': '🛒',
};

/** 购物店铺（OSM 真实商家） */
export interface MallShop {
  id: string;
  name: string;
  cat: MallCategory | string;
  city: string;
  rating: string;
  monthlySales: number;
  returnDays: number;
  fanCount: number;
}

/** 购物商品（品牌真实 SKU 或品类池） */
export interface MallGood {
  id: string;
  shopId: string;
  name: string;
  price: number;
  cat: string;
  brand: string;
  imgKey: string; // 品类 SVG 键
}

/** 购物订单 = 外卖订单结构（复用标签/支付/转发全链路），仅物流周期不同 */
export type MallOrder = ShoppingOrder;