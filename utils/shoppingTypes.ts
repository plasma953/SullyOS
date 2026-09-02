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
  img?: string;            // OFF 实拍图直链或本地 webp
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
