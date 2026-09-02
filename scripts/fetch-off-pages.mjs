// Fetch a page range from OFF China search API, merge into existing off-products.json.
// Usage: node scripts/fetch-off-pages.mjs --from=3 --to=10 --gap=75000 --retries=60
// ASCII-only logs for safe SSH transport.
import fs from 'node:fs';

const arg = (k, d) => {
  const a = process.argv.slice(2).find(x => x.startsWith('--' + k + '='));
  return a ? a.split('=')[1] : d;
};
const FROM = parseInt(arg('from', '3'), 10);
const TO = parseInt(arg('to', '10'), 10);
const GAP = parseInt(arg('gap', '75000'), 10);
const RETRIES = parseInt(arg('retries', '60'), 10);
const OUT = 'public/shopping/off-products.json';

const prev = JSON.parse(fs.readFileSync(OUT, 'utf8'));
const byCode = new Map(prev.products.map(p => [p.code, p]));
console.log('lane start: from=' + FROM + ' to=' + TO + ' gap=' + GAP + ' existing=' + byCode.size);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let added = 0;

for (let page = FROM; page <= TO; page++) {
  let done = false;
  let fails = 0;
  while (!done) {
    const url = 'https://world.openfoodfacts.org/api/v2/search?countries_tags=china&page_size=100&page=' + page
      + '&auth=sullyos-dataset&password=Sully0s!OFF2026x&fields=code,product_name,brands,quantity,categories_tags,image_front_small_url';
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'SullyOS-Shopping-Dataset/1.0 (educational simulation)' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const d = await res.json();
      const ps = d.products || [];
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
      done = true;
      await sleep(GAP);
    } catch (e) {
      fails++;
      console.log('page ' + page + ' fail#' + fails + ': ' + e.message + ', wait 90s');
      await sleep(90000);
      if (fails >= RETRIES) { console.log('page ' + page + ': giving up'); break; }
    }
  }
}

function mapCategory(cats) {
  const c = cats.join(',');
  if (/beverages|waters|carbon|sodas|juice|teas|coffees/.test(c)) return '\\u996e\\u6599\\u51b2\\u8c03';
  if (/snacks|chocolate|candies|biscuits|cakes|ice-creams/.test(c)) return '\\u4f11\\u95f2\\u96f6\\u98df';
  if (/dairy|milks|yogurts|cheeses/.test(c)) return '\\u4e73\\u54c1';
  if (/pastas|instant-noodles|noodles|canned|rice|dried/.test(c)) return '\\u7cae\\u6cb9\\u901f\\u98df';
  if (/condiments|sauces|spices|oils/.test(c)) return '\\u8c03\\u5473\\u7cae\\u6cb9';
  if (/fresh-foods|vegetables|fruits/.test(c)) return '\\u751f\\u9c9c\\u679c\\u852c';
  return '\\u65e5\\u7528\\u767e\\u8d27';
}

const products = [...byCode.values()];
for (const p of products) p.cat = mapCategory(p.cats);
fs.writeFileSync(OUT, JSON.stringify({ fetchedAt: new Date().toISOString(), count: products.length, products }));
console.log('DONE.', products.length, 'products (+' + added + ') ->', OUT);
