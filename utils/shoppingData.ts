// ============================================================
// 购物数据加载 —— 静态 JSON（OSM 店铺 + OFF 商品 + 生成的菜单）
// 首页全量展示店铺，不做城市硬过滤；仅当前地址城市标签匹配者排序置顶。
// ============================================================
import type { ShoppingShop, ShoppingDish, ShopCategory } from './shoppingTypes';

export interface ShoppingDataset {
  shops: ShoppingShop[];
  dishes: ShoppingDish[]; // 按 shopId 分组的菜单
}

let cache: ShoppingDataset | null = null;
let loading: Promise<ShoppingDataset> | null = null;


/** 商品归一化（去空白/全角/小写/剥价格后缀/剥品牌前缀） */
export function normalizeGoodName(name: string): string {
  let s = (name || '').replace(/[　\s]+/g, '');
  s = s.replace(/[！-～]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
  s = s.toLowerCase();
  s = s.replace(/[\(\[\{（【｛][^\)\]\}）】｝]*[\)\]\}）】｝]/g, '');
  return s;
}

export function dishDedupKey(shopId: string, name: string, brand?: string, spec?: string): string {
  return [shopId, normalizeGoodName(name), normalizeGoodName(brand || ''), normalizeGoodName(spec || '')].join('|');
}

/** 同店去重：同键保留首条，价格取均值，月销累加 */
export function dedupDishesByShop<T extends { shopId: string; name: string; price: number; monthlySales?: number; brand?: string; qty?: string; cat: string }>(list: T[]): T[] {
  const seen = new Map<string, { item: T; total: number; count: number; sales: number }>();
  for (const d of list) {
    const k = dishDedupKey(d.shopId, d.name, (d as any).brand, (d as any).qty);
    const e = seen.get(k);
    if (!e) seen.set(k, { item: { ...d }, total: d.price, count: 1, sales: d.monthlySales || 0 });
    else { e.total += d.price; e.count += 1; e.sales += d.monthlySales || 0; }
  }
  const out: T[] = [];
  for (const { item, total, count, sales } of seen.values()) {
    (item as any).price = Math.round((total / count) * 10) / 10;
    if (sales) (item as any).monthlySales = sales;
    out.push(item);
  }
  return out;
}

export function invalidateShoppingDataCache() {
  cache = null;
  loading = null;
}

/**
 * 拉取并合并数据集。文件由 scripts/gen-shopping-data.mjs 离线生成：
 *   public/shopping/shops.json     店铺（含补齐的拟真字段）
 *   public/shopping/dishes.json    菜品（按店铺分组）
 */
export async function loadShoppingData(): Promise<ShoppingDataset> {
  if (cache) return cache;
  if (loading) return loading;
  loading = (async () => {
    const [shopsRes, dishesRes] = await Promise.all([
      fetch(`${import.meta.env.BASE_URL}shopping/shops.json`),
      fetch(`${import.meta.env.BASE_URL}shopping/dishes.json`),
    ]);
    const shops: ShoppingShop[] = shopsRes.ok ? await shopsRes.json() : [];
    const raw = dishesRes.ok ? await dishesRes.json() : {};
    const dishes: ShoppingDish[] = [];
    const byShop = new Map<string, ShoppingDish[]>();
    if (Array.isArray(raw)) {
      for (const d of raw as ShoppingDish[]) {
        dishes.push(d);
        const list = byShop.get(d.shopId) || [];
        list.push(d);
        byShop.set(d.shopId, list);
      }
    } else if (raw && typeof raw === 'object') {
      for (const [shopId, list] of Object.entries(raw as Record<string, ShoppingDish[]>)) {
        for (const d of list || []) {
          dishes.push(d);
          byShop.set(shopId, [...(byShop.get(shopId) || []), d]);
        }
      }

    }
    const ds: ShoppingDataset = { shops, dishes: dedupDishesByShop(dishes) };
    cache = ds;
    return ds;
  })();
  try {
    return await loading;
  } catch (e) {
    loading = null;
    throw e;
  }
}

/** 取某店的菜单 */
export function getShopMenu(ds: ShoppingDataset, shopId: string): ShoppingDish[] {
  return ds.dishes.filter(d => d.shopId === shopId);
}

/** 店铺列表排序：城市标签匹配优先，其余按月销/评分 */
export function sortShopsForAddress(
  shops: ShoppingShop[],
  _cityTag?: string,
): ShoppingShop[] {
  // 去地域：不再按城市置顶，仅按月销/评分排序（参数保留兼容）
  return [...shops].sort((a, b) => {
    const sa = (a.monthlySales || 0) + (a.rating || 0) * 1000;
    const sb = (b.monthlySales || 0) + (b.rating || 0) * 1000;
    return sb - sa;
  });
}

export function dishImgUrl(img?: string): string {
  if (!img) return '';
  if (img.startsWith('http')) return img;
  // OFF 短路径（形如 692/225/545/1427/front_zh.12.200.jpg）→ 重建 CDN 地址
  if (/^\d{3}\//.test(img)) return 'https://images.openfoodfacts.org/images/products/' + img;
  return `${import.meta.env.BASE_URL}shopping/${img}`;
}

export type { ShoppingShop, ShoppingDish, ShopCategory };

// ============================================================
// 购物 App（淘宝式）数据 —— mall-shops.json / mall-goods.json
// 与外卖数据集完全分离；商品图统一 imgKey SVG。
// ============================================================
import type { MallShop, MallGood } from './shoppingTypes';

export interface MallDataset {
  shops: MallShop[];
  goods: MallGood[];
}

let mallCache: MallDataset | null = null;
let mallLoading: Promise<MallDataset> | null = null;

export function invalidateMallDataCache() {
  mallCache = null;
  mallLoading = null;
}

/** 拉取购物数据集（scripts/gen-mall-data.mjs 离线生成） */
export async function loadMallData(): Promise<MallDataset> {
  if (mallCache) return mallCache;
  if (mallLoading) return mallLoading;
  mallLoading = (async () => {
    const [shopsRes, goodsRes] = await Promise.all([
      fetch(`${import.meta.env.BASE_URL}shopping/mall-shops.json`),
      fetch(`${import.meta.env.BASE_URL}shopping/mall-goods.json`),
    ]);
    const shops: MallShop[] = shopsRes.ok ? await shopsRes.json() : [];
    const goods: MallGood[] = goodsRes.ok ? await goodsRes.json() : [];
    const ds: MallDataset = { shops, goods: dedupDishesByShop(goods as any) as any };
    mallCache = ds;
    return ds;
  })();
  try {
    return await mallLoading;
  } catch (e) {
    mallLoading = null;
    throw e;
  }
}

/** 全城搜商品（确定性前 80 条） */
export function searchMallGoods(ds: MallDataset, q: string, cat?: string): MallGood[] {
  const key = q.trim().toLowerCase();
  if (!key && !cat) return [];
  const out: MallGood[] = [];
  for (const g of ds.goods) {
    const nameHit = !key || g.name.toLowerCase().includes(key) || (g.brand || '').toLowerCase().includes(key);
    const catHit = !cat || true; // 店铺品类过滤由调用方在店铺层做
    if (nameHit && catHit) {
      out.push(g);
      if (out.length >= 80) break;
    }
  }
  return out;
}
