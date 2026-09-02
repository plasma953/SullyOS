// 拉取 OSM 真实购物店铺 POI（与外卖类目无交集）→ public/shopping/mall-shops-raw.json
// 数据源: Overpass API (ODbL)。仅使用名称级事实信息。用法: node scripts/fetch-osm-mall-shops.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const OUT = 'public/shopping/mall-shops-raw.json';

const CITY_BOXES = [
  { city: '北京', boxes: [[39.90, 116.38, 39.98, 116.50], [39.97, 116.30, 40.01, 116.46], [39.86, 116.30, 39.94, 116.44]] },
  { city: '上海', boxes: [[31.21, 121.42, 31.26, 121.52], [31.03, 121.40, 31.07, 121.52], [31.28, 121.50, 31.32, 121.60]] },
  { city: '广州', boxes: [[23.11, 113.26, 23.15, 113.36]] },
  { city: '深圳', boxes: [[22.53, 113.92, 22.57, 114.03]] },
  { city: '成都', boxes: [[30.63, 104.03, 30.68, 104.11]] },
  { city: '杭州', boxes: [[30.24, 120.12, 30.28, 120.21]] },
];

// 购物类目 → 8 大购物品类（与外卖 7 品类完全分离）
function catOf(tags) {
  const shop = tags.shop || '';
  if (['clothes', 'shoes', 'bags', 'leather', 'boutique', 'tailor'].includes(shop)) return '服饰鞋包';
  if (['sports', 'outdoor', 'bicycle'].includes(shop)) return '运动户外';
  if (['electronics', 'mobile_phone', 'computer', 'appliance', 'camera', 'hifi', 'video_games'].includes(shop)) return '数码家电';
  if (['cosmetics', 'perfume', 'beauty', 'hairdresser'].includes(shop)) return '美妆个护';
  if (['jewelry', 'watches'].includes(shop)) return '珠宝腕表';
  if (['furniture', 'houseware', 'interior_decoration', 'curtain', 'bed', 'kitchen', 'lighting', 'antiques'].includes(shop)) return '家居家具';
  if (['books', 'stationery', 'newsagent', 'music', 'photo'].includes(shop)) return '图书文具';
  if (['mall', 'variety_store', 'gift', 'general', 'toys', 'second_hand', 'charity'].includes(shop)) return '商超百货';
  return null;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// 分两组正则拉，避免单次查询过重
const GROUPS = [
  '^(clothes|shoes|bags|leather|boutique|tailor|sports|outdoor|bicycle|toys)$',
  '^(electronics|mobile_phone|computer|appliance|camera|hifi|video_games|cosmetics|perfume|beauty|hairdresser|jewelry|watches|furniture|houseware|interior_decoration|curtain|bed|kitchen|lighting|antiques|books|stationery|newsagent|music|photo|mall|variety_store|gift|general|second_hand|charity)$',
];

async function overpass(bbox, regex) {
  const q = `[out:json][timeout:60];nwr["shop"~"${regex}"]["name"](${bbox.join(',')});out center tags;`;
  const endpoints = [
    { name: 'mail.ru', url: 'https://maps.mail.ru/osm/tools/overpass/api/interpreter', method: 'POST' },
    { name: 'overpass-api.de', url: 'https://overpass-api.de/api/interpreter', method: 'GET' },
  ];
  for (let attempt = 1; attempt <= 3; attempt++) {
    for (const ep of endpoints) {
      try {
        let out;
        if (ep.method === 'POST') {
          out = execFileSync('curl', ['-s', '-m', '120', '--data-urlencode', 'data=' + q, ep.url], { maxBuffer: 64 * 1024 * 1024 });
        } else {
          out = execFileSync('curl', ['-s', '-m', '120', '-A', 'SullyOS-Dataset/1.0', ep.url + '?data=' + encodeURIComponent(q)], { maxBuffer: 64 * 1024 * 1024 });
        }
        const text = out.toString('utf-8');
        if (!text.trim() || text.includes('Internal Server Error') || text.startsWith('<!DOCTYPE') || text.includes('406 Not Acceptable')) {
          throw new Error(ep.name + ' bad response');
        }
        return JSON.parse(text).elements || [];
      } catch (e) {
        console.log('  [' + ep.name + ' attempt ' + attempt + '] ' + e.message.slice(0, 80));
        await sleep(6000);
      }
    }
  }
  console.log('  all endpoints failed for ' + bbox.join(',') + ' group');
  return [];
}

const seen = new Set();
const shops = [];
const perCity = {};
const perCat = {};

for (const { city, boxes } of CITY_BOXES) {
  perCity[city] = 0;
  for (const bbox of boxes) {
    for (const regex of GROUPS) {
      console.log('Fetching ' + city + ' [' + bbox.join(',') + '] grp' + (regex.includes('clothes') ? '1' : '2') + ' ...');
      const els = await overpass(bbox, regex);
      let kept = 0;
      for (const el of els) {
        const tags = el.tags || {};
        const cat = catOf(tags);
        if (!cat) continue;
        const id = 'mshop_' + el.type + el.id;
        if (seen.has(id)) continue;
        seen.add(id);
        const lat = el.lat ?? el.center?.lat;
        const lng = el.lon ?? el.center?.lon;
        if (!lat || !lng) continue;
        const name = (tags['name:zh'] || tags['brand:zh'] || tags.name || '').trim();
        if (!name) continue;
        shops.push({ id, name, cat, city, brand: (tags['brand:zh'] || tags.brand || '').trim(), lat, lng });
        kept++;
        perCat[cat] = (perCat[cat] || 0) + 1;
      }
      perCity[city] += kept;
      console.log('  kept ' + kept + ' (total ' + shops.length + ')');
      await sleep(8000);
    }
  }
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(shops));
console.log('DONE. per-city:', JSON.stringify(perCity));
console.log('per-cat:', JSON.stringify(perCat));
console.log('total:', shops.length);
