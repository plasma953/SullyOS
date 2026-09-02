// 拉取 Open Food Facts 中国区真实商品 → public/shopping/off-products.json
// 数据源: world.openfoodfacts.org (ODbL 开放许可；商品图 CC-BY-SA)
// 用法: node scripts/fetch-off-china.mjs [--limit=2000]
import fs from 'node:fs';

const args = process.argv.slice(2);
const limitArg = args.find(a => a.startsWith('--limit='));
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1], 10) : 2000;
const OUT = 'public/shopping/off-products.json';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

console.log('Fetching OFF China products...');
const products = [];
let page = 1;
let fails = 0;

while (products.length < LIMIT) {
  const url = 'https://world.openfoodfacts.org/api/v2/search?countries_tags=china&page_size=500&page=' + page
    + '&fields=code,product_name,brands,quantity,categories_tags,image_front_small_url';
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'SullyOS-Shopping-Dataset/1.0 (educational simulation)' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const d = await res.json();
    const ps = d.products || [];
    if (ps.length === 0) break;
    let kept = 0;
    for (const p of ps) {
      const name = (p.product_name || '').trim();
      if (!name || !/[\u4e00-\u9fa5]/.test(name)) continue;
      products.push({
        code: p.code,
        name,
        brand: (p.brands || '').split(',')[0].trim(),
        qty: p.quantity || '',
        cats: p.categories_tags || [],
        img: p.image_front_small_url || '',
      });
      kept++;
      if (products.length >= LIMIT) break;
    }
    console.log('page ' + page + ': got ' + ps.length + ', kept ' + kept + ', total ' + products.length);
    page++;
    await sleep(3000);
  } catch (e) {
    console.log('page ' + page + ' error: ' + e.message + ', retry in 10s');
    await sleep(10000);
    if (++fails >= 5) { console.log('too many fails, stop'); break; }
  }
}

// OFF categories_tags → 商品分类
function mapCategory(cats) {
  const c = cats.join(',');
  if (/beverages|waters|carbon|sodas|juice|teas|coffees/.test(c)) return '饮料冲调';
  if (/snacks|chocolate|candies|biscuits|cakes|ice-creams/.test(c)) return '休闲零食';
  if (/dairy|milks|yogurts|cheeses/.test(c)) return '乳品';
  if (/pastas|instant-noodles|noodles|canned|rice|dried/.test(c)) return '粮油速食';
  if (/condiments|sauces|spices|oils/.test(c)) return '调味粮油';
  if (/fresh-foods|vegetables|fruits/.test(c)) return '生鲜果蔬';
  return '日用百货';
}

for (const p of products) p.cat = mapCategory(p.cats);

fs.mkdirSync('public/shopping', { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ fetchedAt: new Date().toISOString(), count: products.length, products }));
console.log('DONE.', products.length, 'products ->', OUT);
