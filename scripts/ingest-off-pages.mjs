// Ingest browser-fetched OFF page JSON files (/tmp/off_page_NN.json) into off-products.json.
// Each file is a JSON array of rows: [code, name, brand, qty, cats, imgPath]
// imgPath is relative to https://images.openfoodfacts.org/images/products/
// ASCII-only logs.
import fs from 'node:fs';

const OUT = 'public/shopping/off-products.json';
const prev = JSON.parse(fs.readFileSync(OUT, 'utf8'));
const byCode = new Map(prev.products.map(p => [p.code, p]));
console.log('existing =', byCode.size);

const files = process.argv.slice(2);
let added = 0;
for (const f of files) {
  if (!fs.existsSync(f)) { console.log('skip missing', f); continue; }
  const rows = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const r of rows) {
    const [code, name, brand, qty, cats, imgPath] = r;
    if (!code || byCode.has(code)) continue;
    if (!name || !/[\u4e00-\u9fa5]/.test(name)) continue;
    byCode.set(code, {
      code,
      name,
      brand: brand || '',
      qty: qty || '',
      cats: cats ? cats.split('|') : [],
      img: imgPath ? 'https://images.openfoodfacts.org/images/products/' + imgPath : '',
    });
    added++;
  }
  console.log('ingested', f, 'rows=' + rows.length, 'total=' + byCode.size);
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
