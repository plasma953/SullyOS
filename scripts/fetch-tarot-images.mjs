// 下载 RWS 公有领域牌图（Geldard 扫描版，Commons 分类共 78 张）→ public/tarot/rws/{id}.jpg
// 图源：Category:Rider-Waite-Smith tarot deck (Geldard)，1909 原版，已过版权期（PD）。
// 用法: node scripts/fetch-tarot-images.mjs
// 行为：枚举分类 → 900px 缩略图 → sharp 转 800px JPEG q82；78 张缺一不可，否则 exit 1。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const CATEGORY = 'Category:Rider-Waite-Smith tarot deck (Geldard)';
const OUT_DIR = 'public/tarot/rws';
const API = 'https://commons.wikimedia.org/w/api.php';
const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || '';
const CURL_BASE = ['-sSfL', '--tlsv1.2'];
const CONCURRENCY = 4;

const MAJOR_NUM = {
  fool: 0, magician: 1, 'high priestess': 2, empress: 3, emperor: 4, hierophant: 5,
  lovers: 6, chariot: 7, strength: 8, hermit: 9, 'wheel of fortune': 10, justice: 11,
  'hanged man': 12, death: 13, temperance: 14, devil: 15, tower: 16, star: 17,
  moon: 18, sun: 19, judgement: 20, world: 21,
};
const MAJOR_SHORT = ['fool', 'magician', 'priestess', 'empress', 'emperor', 'hierophant', 'lovers',
  'chariot', 'strength', 'hermit', 'wheel', 'justice', 'hanged', 'death', 'temperance',
  'devil', 'tower', 'star', 'moon', 'sun', 'judgement', 'world'];
const RANK = {
  one: ['01', 'ace'], ace: ['01', 'ace'], two: ['02', 'two'], three: ['03', 'three'], four: ['04', 'four'],
  five: ['05', 'five'], six: ['06', 'six'], seven: ['07', 'seven'], eight: ['08', 'eight'],
  nine: ['09', 'nine'], ten: ['10', 'ten'], page: ['11', 'page'], knight: ['12', 'knight'],
  queen: ['13', 'queen'], king: ['14', 'king'],
};
const SUIT = { wands: 'wands', cups: 'cups', swords: 'swords', pentacles: 'pentacles' };
const SUFFIX = ' (Rider-Waite Smith tarot deck).png';

/** Commons 文件名 → 我们的牌 id（与 utils/tarotData.ts 对齐），映射不上抛错。 */
function titleToId(title) {
  let name = title.replace(/^File:/, '');
  if (!name.endsWith(SUFFIX)) throw new Error(`unexpected filename: ${title}`);
  name = name.slice(0, -SUFFIX.length);
  const lower = name.toLowerCase();
  const majorKey = lower.startsWith('the ') ? lower.slice(4) : lower;
  if (majorKey in MAJOR_NUM) {
    const num = MAJOR_NUM[majorKey];
    return `major-${String(num).padStart(2, '0')}-${MAJOR_SHORT[num]}`;
  }
  const m = lower.match(/^(\w+) of (\w+)$/);
  if (m && m[1] in RANK && m[2] in SUIT) {
    const [nn, word] = RANK[m[1]];
    return `${SUIT[m[2]]}-${nn}-${word}`;
  }
  throw new Error(`cannot map filename to card id: ${title}`);
}

function loadSharp() {
  try {
    return createRequire(process.cwd() + '/package.json')('sharp');
  } catch { /* fall through to .pnpm scan */ }
  const pnpmDir = path.join(process.cwd(), 'node_modules', '.pnpm');
  for (const entry of fs.readdirSync(pnpmDir)) {
    if (!entry.startsWith('sharp@')) continue;
    try {
      return createRequire(path.join(pnpmDir, entry, 'node_modules', 'package.json'))('sharp');
    } catch { /* keep scanning */ }
  }
  throw new Error('sharp not found (tried top-level and node_modules/.pnpm/sharp@*)');
}

async function apiJson(params) {
  const url = `${API}?${new URLSearchParams({ ...params, format: 'json' })}`;
  if (PROXY) {
    const buf = execFileSync('curl.exe', [...CURL_BASE, '-x', PROXY, '--max-time', '60', '-A', 'SullyOS-tarot-fetch/1.0', url], { encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 });
    return JSON.parse(buf.toString('utf8'));
  }
  const res = await fetch(url, { headers: { 'User-Agent': 'SullyOS-tarot-fetch/1.0' } });
  if (!res.ok) throw new Error(`api ${res.status}: ${url}`);
  return res.json();
}

async function downloadBuffer(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'SullyOS-tarot-fetch/1.0' } });
  if (!res.ok) throw new Error(`http ${res.status}: ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

function downloadViaCurl(url) {
  return execFileSync('curl.exe', [...CURL_BASE, '-x', PROXY, '--max-time', '120', url], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });
}

async function main() {
  const sharp = loadSharp();
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // 1. 枚举分类全部 78 个文件
  const titles = [];
  let cmcontinue;
  do {
    const j = await apiJson({
      action: 'query', list: 'categorymembers', cmtitle: CATEGORY,
      cmtype: 'file', cmlimit: '100', ...(cmcontinue ? { cmcontinue } : {}),
    });
    for (const m of j.query.categorymembers) titles.push(m.title);
    cmcontinue = j.continue?.cmcontinue;
  } while (cmcontinue);
  if (titles.length !== 78) throw new Error(`expected 78 files in ${CATEGORY}, got ${titles.length}`);

  // 2. 先映射校验：78 个文件名必须恰好对应 78 个牌 id
  const jobs = titles.map((title) => ({ title, id: titleToId(title) }));
  const ids = new Set(jobs.map((j) => j.id));
  if (ids.size !== 78) throw new Error(`id collision: ${jobs.length} files -> ${ids.size} ids`);

  // 3. 下载缩略图 + 转码（并发 CONCURRENCY，重试 3 次）
  let done = 0;
  const queue = [...jobs];
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      const job = queue.shift();
      const out = path.join(OUT_DIR, `${job.id}.jpg`);
      if (fs.existsSync(out)) { done++; continue; }
      const fileName = job.title.replace(/^File:/, '');
      const thumb = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(fileName)}?width=800`;
      let lastErr;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          let buf;
          if (PROXY) {
            buf = downloadViaCurl(thumb);
          } else {
            buf = await downloadBuffer(thumb);
          }
          const jpg = await sharp(buf).resize({ width: 800, withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
          fs.writeFileSync(out, jpg);
          break;
        } catch (e) {
          lastErr = e;
          await new Promise((r) => setTimeout(r, 1500 * attempt));
        }
      }
      if (!fs.existsSync(out)) throw new Error(`failed ${job.title}: ${lastErr?.message}`);
      done++;
      if (done % 10 === 0) console.log(`progress ${done}/78`);
    }
  });
  await Promise.all(workers);

  // 4. 收尾校验
  const files = fs.readdirSync(OUT_DIR).filter((f) => f.endsWith('.jpg'));
  const missing = jobs.filter((j) => !files.includes(`${j.id}.jpg`));
  if (missing.length) throw new Error(`missing images: ${missing.map((m) => m.id).join(', ')}`);
  const totalMB = files.reduce((s, f) => s + fs.statSync(path.join(OUT_DIR, f)).size, 0) / 1048576;
  console.log(`done: ${files.length} images, ${totalMB.toFixed(1)} MB in ${OUT_DIR}`);
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
