// 生成购物App数据：OSM购物店铺 × 品牌真实商品名录 → mall-shops.json + mall-goods.json
import fs from 'node:fs';
import { BRAND_SKUS } from './catalog/mall-brands.mjs';
import { BRAND_ALIAS, CAT_BRAND_POOL } from './catalog/mall-brands-alias.mjs';

const RAW = 'public/shopping/mall-shops-raw.json';
const OUT_SHOPS = 'public/shopping/mall-shops.json';
const OUT_GOODS = 'public/shopping/mall-goods.json';

const raw = JSON.parse(fs.readFileSync(RAW, 'utf8'));

function hash32(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0);
}
const jitter = (seed, pct) => 1 + (((hash32(seed) % 200) / 1000) * pct * 2 - pct);

const CAT_ICON = {
  '服饰鞋包': 'fashion', '运动户外': 'sport', '数码家电': 'digital', '美妆个护': 'beauty',
  '珠宝腕表': 'jewel', '家居家具': 'home', '图书文具': 'book', '商超百货': 'mall',
};

const CAT_GOODS_POOL = {
  '服饰鞋包': [['圆领T恤', 59], ['牛仔裤', 159], ['卫衣', 129], ['连衣裙', 199], ['休闲夹克', 229], ['板鞋', 239], ['帆布鞋', 89], ['双肩包', 99], ['皮带', 59], ['棒球帽', 39]],
  '运动户外': [['速干T恤', 79], ['运动短裤', 69], ['跑步鞋', 329], ['瑜伽垫', 79], ['运动水壶', 49], ['跳绳', 29], ['护腕', 25], ['运动背包', 129]],
  '数码家电': [['蓝牙耳机', 199], ['充电宝20000mAh', 129], ['数据线', 29], ['手机壳', 39], ['电动牙刷', 169], ['电吹风', 99], ['小夜灯', 39], ['排插', 45]],
  '美妆个护': [['洁面乳', 49], ['爽肤水', 69], ['面膜(5片)', 39], ['护手霜', 29], ['洗面奶', 45], ['眉笔', 25], ['口红', 79], ['香水小样', 59]],
  '珠宝腕表': [['银手链', 199], ['珍珠项链', 299], ['锆石耳钉', 129], ['足金吊坠', 1299], ['石英手表', 399], ['编织手绳', 69]],
  '家居家具': [['四件套', 299], ['记忆枕', 129], ['收纳箱', 59], ['地毯', 199], ['香薰蜡烛', 49], ['抱枕', 39], ['落地灯', 299]],
  '图书文具': [['畅销小说', 39], ['儿童绘本', 25], ['笔记本(3本)', 15], ['中性笔(5支)', 9.9], ['便签纸', 8.9], ['胶棒', 5.9]],
  '商超百货': [['抽纸(6包)', 25.9], ['洗衣液3kg', 39.9], ['垃圾袋(100只)', 12.9], ['保温杯', 49.9], ['拖鞋', 19.9], ['收纳盒', 29.9]],
};

function brandOf(shop) {
  const hay = ((shop.name || '') + '|' + (shop.brand || '')).toLowerCase();
  for (const [brand, aliases] of Object.entries(BRAND_ALIAS)) {
    if (aliases.some(a => hay.includes(a.toLowerCase()))) return brand;
  }
  for (const brand of Object.keys(BRAND_SKUS)) {
    if (hay.includes(brand.toLowerCase())) return brand;
  }
  return null;
}

const CAT_CONFIG = {
  '服饰鞋包': { returnDays: 7 }, '运动户外': { returnDays: 15 }, '数码家电': { returnDays: 15 },
  '美妆个护': { returnDays: 7 }, '珠宝腕表': { returnDays: 7 }, '家居家具': { returnDays: 30 },
  '图书文具': { returnDays: 7 }, '商超百货': { returnDays: 7 },
};

const shopsOut = [];
const goodsOut = [];
const shopCatMap = new Map();
let gSeq = 0;

for (const s of raw) {
  const h = hash32(s.id);
  const cfg = CAT_CONFIG[s.cat] || { returnDays: 7 };
  shopsOut.push({
    id: s.id, name: s.name, cat: s.cat,
    rating: (4.3 + (h % 7) / 10).toFixed(1),
    monthlySales: 200 + (h % 9800),
    returnDays: cfg.returnDays,
    fanCount: 500 + (h % 45000),
  });
  shopCatMap.set(s.id, s.cat);

  const brand = brandOf(s);
  if (brand && BRAND_SKUS[brand]) {
    for (const [name, base] of BRAND_SKUS[brand]) {
      goodsOut.push({ id: 'g' + (++gSeq), shopId: s.id, name, price: Math.round(base * jitter(s.id + name, 0.08) * 10) / 10, cat: '旗舰店同款', brand, imgKey: CAT_ICON[s.cat] || 'mall' });
    }
  } else {
    const pool = CAT_BRAND_POOL[s.cat] || [];
    const brandCount = Math.min(pool.length, 2 + (h % 2));
    const start = pool.length > brandCount ? (h % (pool.length - brandCount + 1)) : 0;
    const picked = pool.slice(start, start + brandCount);
    for (const b of picked) {
      for (const [name, base] of BRAND_SKUS[b] || []) {
        goodsOut.push({ id: 'g' + (++gSeq), shopId: s.id, name, price: Math.round(base * jitter(s.id + name, 0.08) * 10) / 10, cat: '热销', brand: b, imgKey: CAT_ICON[s.cat] || 'mall' });
      }
    }
    const gpool = CAT_GOODS_POOL[s.cat] || [];
    const per = Math.min(gpool.length, 5 + (h % 4));
    for (let i = 0; i < per; i++) {
      const [name, base] = gpool[(h + i * 3) % gpool.length];
      goodsOut.push({ id: 'g' + (++gSeq), shopId: s.id, name, price: Math.round(base * jitter(s.id + name, 0.12) * 10) / 10, cat: i === 0 ? '招牌推荐' : '热销', brand: '', imgKey: CAT_ICON[s.cat] || 'mall' });
    }
  }
}

fs.writeFileSync(OUT_SHOPS, JSON.stringify(shopsOut));
fs.writeFileSync(OUT_GOODS, JSON.stringify(goodsOut));
const mb = n => (n / 1024 / 1024).toFixed(2) + 'MB';
console.log('mall-shops:', shopsOut.length, '->', OUT_SHOPS, mb(fs.statSync(OUT_SHOPS).size));
console.log('mall-goods:', goodsOut.length, '->', OUT_GOODS, mb(fs.statSync(OUT_GOODS).size));
console.log('goods with real brand SKUs:', goodsOut.filter(g => g.brand).length);
