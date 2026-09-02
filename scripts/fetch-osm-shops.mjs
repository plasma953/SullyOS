// 拉取 OpenStreetMap 真实店铺 POI → public/shopping/shops-raw.json
// 数据源: Overpass API (ODbL 开放许可)。仅使用名称级事实信息。
// 用法: node scripts/fetch-osm-shops.mjs
import fs from 'node:fs';
import path from 'node:path';

const OUT = 'public/shopping/shops-raw.json';

// 软性城市标签: 仅用于排序优先级，不做硬过滤。bbox 覆盖核心商圈即可。
const CITY_BOXES = [
  { city: '北京', boxes: [[39.90, 116.38, 39.98, 116.50], [39.97, 116.30, 40.01, 116.46], [39.86, 116.30, 39.94, 116.44]] },
  { city: '上海', boxes: [[31.21, 121.42, 31.26, 121.52], [31.03, 121.40, 31.07, 121.52], [31.28, 121.50, 31.32, 121.60]] },
  { city: '广州', boxes: [[23.11, 113.26, 23.15, 113.36]] },
  { city: '深圳', boxes: [[22.53, 113.92, 22.57, 114.03]] },
  { city: '成都', boxes: [[30.63, 104.03, 30.68, 104.11]] },
  { city: '杭州', boxes: [[30.24, 120.12, 30.28, 120.21]] },
];

// OSM 标签 → 我们的品类
function catOf(tags) {
  const amenity = tags.amenity || '';
  const shop = tags.shop || '';
  const healthcare = tags.healthcare || '';
  if (amenity === 'pharmacy' || healthcare === 'pharmacy' || shop === 'pharmacy' || shop === 'chemist') return '医药健康';
  if (amenity === 'restaurant' || amenity === 'fast_food') return '美食外卖';
  if (amenity === 'cafe' || shop === 'beverages' || shop === 'tea' || shop === 'coffee') return '奶茶饮品';
  if (shop === 'bakery' || shop === 'pastry' || shop === 'confectionery' || shop === 'chocolate') return '甜品蛋糕';
  if (shop === 'convenience' || shop === 'supermarket' || shop === 'department_store' || shop === 'grocery') return '超市便利';
  if (shop === 'greengrocer' || shop === 'seafood' || shop === 'butcher' || shop === 'farm') return '生鲜果蔬';
  if (shop === 'florist' || shop === 'garden_centre') return '鲜花绿植';
  return null;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

import { execFileSync } from 'node:child_process';


