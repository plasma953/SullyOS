// Resume OFF China fetch: merge with existing off-products.json (dedupe by code),
// continue from page 11 (page_size=100, server caps at 100 anyway).
// ASCII-only logs to keep SSH transport safe.
import fs from 'node:fs';

const OUT = 'public/shopping/off-products.json';
const prev = JSON.parse(fs.readFileSync(OUT, 'utf8'));
const byCode = new Map(prev.products.map(p => [p.code, p]));
console.log('resume: existing products =', byCode.size);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let page = 11;
let fails = 0;
let added = 0;

while (page <= 40) {
  const url = 'https://world.openfoodfacts.org/api/v2/search?countries_tags=china&page_size=100&page=' + page
    + '&fields=code,product_name,brands,quantity,categories_tags,image_front_small_url';
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'SullyOS-Shopping-Dataset/1.0 (educational simulation)' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const d = await res.json();
    const ps = d.products || [];
    if (ps.length === 0) { console.log('page ' + page + ': empty, end of data'); break; }
    let kept = 0;
    for (const p of ps) {
      const name = (p.product_name || '').trim();
      if (!name || !/[\u4e00-\u9fa5]/.test(name)) continue;
      if (byCode.has(p.code)) continue;
      byCode.set(p.code, {
        code: p.code,
        name,
        brand: (p.brands || '').split(',')[0].trim(),
        qty: p.quantity || '',
        cats: p.categories_tags || [],
        img: p.image_front_small_url || '',
      });
      kept++; added++;
    }
    console.log('page ' + page + ': got ' + ps.length + ', kept ' + kept + ', total ' + byCode.size);
    page++;
    fails = 0;
    await sleep(12000);
  } catch (e) {
    console.log('page ' + page + ' error: ' + e.message + ', retry in 90s');
    await sleep(90000);
    if (++fails >= 40) { console.log('too many fails, stop'); break; }
  }
}

function mapCategory(cats) {
  const c = cats.join(',');
  if (/beverages|waters|carbon|sodas|juice|teas|coffees/.test(c)) return '\u996e\u6599\u51b2\u8c03';
  if (/snacks|chocolate|candies|biscuits|cakes|ice-creams/.test(c)) return '\u4f11\u95f2\u96f6\u98df';
  if (/dairy|milks|yogurts|cheeses/.test(c)) return '\u4e73\u54c1';
  if (/pastas|instant-noodles|noodles|canned|rice|dried/.test(c)) return '\u7cae\u6cb9\u901f\u98df';
  if (/condiments|sauces|spices|oils/.test(c)) return '\u8c03\u5473\u7cae\u6cb9';
  if (/fresh-foods|vegetables|fruits/.test(c)) return '\u751f\u9c9c\u679c\u852c';
  return '\u65e5\u7528\u767e\u8d27';
}

const products = [...byCode.values()];
for (const p of products) p.cat = mapCategory(p.cats);
fs.writeFileSync(OUT, JSON.stringify({ fetchedAt: new Date().toISOString(), count: products.length, products }));
console.log('DONE.', products.length, 'products (+' + added + ') ->', OUT);
