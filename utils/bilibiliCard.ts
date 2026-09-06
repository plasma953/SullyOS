// B站视频链接内容提取 — 聊天里发 B站链接 / b23.tv 短链 / 裸 BV 号，
// 经 sfworker /bilibili/* 端点（worker/index.js）拿稿件元数据、字幕、预览帧，
// 拼成 ExtractedWebpage 复用现有 webpage_card 管线（卡片渲染 + messageFormat 喂 LLM）。
//
// 设计约束（2026-09-06 立项确认，2026-09-06 真接口验证）：
//  1) 无 cookie：只用无需登录的公开接口（view / player CC 字幕 / videoshot 预览帧），
//     AI 小结接口要登录（无 cookie 必 -403），不接；拿不到就抛错，调用方
//    （apps/Chat.tsx）降级 apizero video-parse → 通用网页抓取；
//  2) 前端几乎不展示：帧只为喂角色而切，多模态主模型随主请求 image_url 白看，
//     纯文本模型走 visionApi 拼图识图（utils/visionApi.ts，单次调用永久缓存）；
//  3)  canvas 只在浏览器里有，测试 / SSR 环境无 canvas 时切帧优雅降级为空数组。

import type { ExtractedWebpage, VideoShareInfo } from './webpageExtractor';
import { expandShortUrl } from './webpageExtractor';
import { getProxyWorkerUrl } from './proxyWorker';
import { migrateDataUrlToRef } from './blobRef';

const sfworkerUrl = (): string => getProxyWorkerUrl();
const API_TIMEOUT_MS = 20000;
/** 喂角色的帧数上限：随主聊天请求 image_url 发送，不新增计费调用。 */
export const BILIBILI_FRAME_COUNT = 6;

export interface BilibiliShare {
  kind: 'bvid' | 'url';
  bvid?: string;
  url?: string;
}

const BV_RE = /\bBV[0-9A-Za-z]{10}\b/;
const BV_IN_PATH_RE = /\/video\/(BV[0-9A-Za-z]{10})(?:[/?#]|$)/;

const isBilibiliHost = (host: string): boolean =>
  host === 'bilibili.com' || host.endsWith('.bilibili.com');
const isB23Host = (host: string): boolean =>
  host === 'b23.tv' || host.endsWith('.b23.tv');

/** 从 B站视频 URL 提取 BV 号。av 号 / 空间页等返回空串（交给 apizero 兜底）。 */
export function extractBvidFromUrl(url: string): string {
  try {
    return new URL(url).pathname.match(BV_IN_PATH_RE)?.[1] || '';
  } catch {
    return '';
  }
}

/**
 * 从一段文本里识别 B站分享。优先级：B站视频链接（直接得 bvid）>
 * b23.tv 短链（需展开）> 裸 BV 号。命中 bilibili 非视频页时不算分享，
 * 继续看其他候选，避免空间/直播链接误触发。
 */
export function detectBilibiliShare(text: string): BilibiliShare | null {
  if (!text) return null;
  const candidates = [...(text.match(/https?:\/\/[^\s，。！？；、"'《》()（）【】]+/ig) || [])];
  for (const raw of candidates) {
    const cleaned = raw.replace(/[.,;:!?'")\]]+$/, '');
    try {
      const host = new URL(cleaned).hostname.toLowerCase().replace(/\.$/, '');
      if (isB23Host(host)) return { kind: 'url', url: cleaned };
      if (isBilibiliHost(host)) {
        const bvid = extractBvidFromUrl(cleaned);
        if (bvid) return { kind: 'bvid', bvid };
      }
    } catch {
      // 坏链接继续看下一个候选。
    }
  }
  const naked = text.match(BV_RE)?.[0];
  return naked ? { kind: 'bvid', bvid: naked } : null;
}

/** 把一次分享解析成 bvid。短链经 sfworker /expand-url 展开。失败抛错。 */
export async function resolveBvid(share: BilibiliShare): Promise<string> {
  if (share.kind === 'bvid' && share.bvid) return share.bvid;
  if (share.kind === 'url' && share.url) {
    const direct = extractBvidFromUrl(share.url);
    if (direct) return direct;
    const finalUrl = await expandShortUrl(share.url);
    const bvid = extractBvidFromUrl(finalUrl);
    if (bvid) return bvid;
  }
  throw new Error('不是有效的B站视频分享');
}

/** 秒数 → 字幕时间戳：mm:ss（一小时内）/ h:mm:ss。 */
export function formatSubtitleTime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

/** 字幕 JSON body → 时间轴纯文本（全量，调用方不再截断）。空行丢弃，按时间排序。 */
export function subtitleBodyToText(body: any): string {
  if (!Array.isArray(body)) return '';
  return body
    .filter((l: any) => l && typeof l.content === 'string' && l.content.trim())
    .map((l: any) => ({
      from: Number(l.from) || 0,
      text: String(l.content).trim().replace(/\s+/g, ' '),
    }))
    .sort((a, b) => a.from - b.from)
    .map((l) => `[${formatSubtitleTime(l.from)}] ${l.text}`)
    .join('\n');
}

export interface SpriteFrameRect {
  sx: number; sy: number; sw: number; sh: number; atSec: number;
}

/**
 * 雪碧图均匀采样 N 帧的切片坐标（纯函数，可测）。
 * 首帧取第 0 格、末帧取最后一格，中间按 (total-1)/(take-1) 均匀分布。
 */
export function computeSpriteFrameRects(
  meta: { imgXLen: number; imgYLen: number; imgX: number; imgY: number; frameCount: number; intervalSec: number },
  count: number,
): SpriteFrameRect[] {
  const total = Math.max(0, Math.floor(meta.frameCount) || 0);
  const n = Math.max(0, Math.floor(count) || 0);
  if (!total || !n || !meta.imgXLen || !meta.imgYLen) return [];
  const take = Math.min(n, total);
  const rects: SpriteFrameRect[] = [];
  for (let i = 0; i < take; i++) {
    const idx = take === 1 ? 0 : Math.round((i * (total - 1)) / (take - 1));
    const col = idx % meta.imgXLen;
    const row = Math.floor(idx / meta.imgXLen);
    rects.push({
      sx: col * meta.imgX,
      sy: row * meta.imgY,
      sw: meta.imgX,
      sh: meta.imgY,
      atSec: Math.round(idx * (meta.intervalSec || 0)),
    });
  }
  return rects;
}

const toCount = (v: any): number | undefined => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

const formatPubdate = (pubdate: any): string | undefined => {
  const t = Number(pubdate);
  if (!Number.isFinite(t) || t <= 0) return undefined;
  const d = new Date(t * 1000);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** view 接口稿件元数据 → ExtractedWebpage（video 附加字段，复用 webpage_card）。 */
export function mapViewToWebpage(view: any, pageUrl: string): ExtractedWebpage {
  const v = view || {};
  const stat = v.stat || {};
  const owner = v.owner || {};
  const bvid = String(v.bvid || '');
  const authorName = String(owner.name || owner?.mid || '').trim() || undefined;
  const video: VideoShareInfo = {
    platform: 'bilibili',
    platformLabel: '哔哩哔哩',
    contentType: 'video',
    authorName,
    playCount: toCount(stat.view),
    likeCount: toCount(stat.like),
    commentCount: toCount(stat.reply),
    shareCount: toCount(stat.share),
    collectCount: toCount(stat.favorite),
    publishTime: formatPubdate(v.pubdate),
    bvid: bvid || undefined,
    aid: toCount(v.aid),
    cid: toCount(v.cid),
    durationSec: toCount(v.duration),
    desc: String(v.desc || '').trim() || undefined,
    frames: [],
  };
  return {
    url: pageUrl,
    finalUrl: pageUrl,
    title: String(v.title || '').trim() || 'B站视频',
    siteName: '哔哩哔哩',
    content: '', // 视频没有可读正文；字幕/简介走 video 附加字段，messageFormat 有专门分支
    excerpt: authorName ? `@${authorName}` : '',
    image: String(v.pic || '').trim().replace(/^http:\/\//, 'https://') || undefined,
    truncated: false,
    fetchedAt: Date.now(),
    video,
    provider: 'bilibili-api',
  };
}

/** 调 sfworker /bilibili/* 端点。worker 信封 {success,data}，失败抛错。 */
async function biliGet(path: string, params: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams(params).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const res = await fetch(`${sfworkerUrl()}/bilibili/${path}?${qs}`, { signal: controller.signal });
    const text = await res.text().catch(() => '');
    let parsed: any = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { /* non-json */ }
    if (!res.ok || !parsed?.success) {
      throw new Error(String(parsed?.error || `B站抓取失败 (HTTP ${res.status})`));
    }
    return parsed.data;
  } finally {
    clearTimeout(timer);
  }
}

interface StoryboardPick {
  spriteUrl: string;
  imgXLen: number;
  imgYLen: number;
  imgX: number;
  imgY: number;
  frameCount: number;
  intervalSec: number;
}

/** 雪碧图 URL 归一化：B站常返回协议相对地址（//bimp.hdslb.com/…），补成 https。 */
function normalizeCdnUrl(url: string): string {
  const u = (url || '').trim();
  if (u.startsWith('//')) return `https:${u}`;
  return u;
}

/**
 * videoshot 返回 → 归一化雪碧图信息。失败/缺字段返回 null（无帧不报错）。
 * 实测：img_x_size/img_y_size 就是单帧宽高（如 480x270），不是整图尺寸，
 * 不要再除以列数；部分视频没有 image（无预览帧），直接返回 null。
 */
function pickStoryboard(data: any, durationSec: number): StoryboardPick | null {
  try {
    const d = data || {};
    const images: string[] = Array.isArray(d.image)
      ? d.image.map(normalizeCdnUrl).filter((u: any) => typeof u === 'string' && u)
      : [];
    if (!images.length) return null;
    const imgXLen = Number(d.img_x_len) || 10;
    const imgYLen = Number(d.img_y_len) || 10;
    const imgX = Number(d.img_x_size) || 160;
    const imgY = Number(d.img_y_size) || 90;
    const perSprite = imgXLen * imgYLen;
    const frameCount = perSprite * Math.max(1, images.length);
    return {
      spriteUrl: images[0],
      imgXLen, imgYLen, imgX, imgY, frameCount,
      intervalSec: durationSec > 0 && frameCount > 0 ? durationSec / frameCount : 0,
    };
  } catch {
    return null;
  }
}

/** 浏览器里加载图片字节（经 /bilibili/asset 代理，已带 CORS 头）。 */
async function loadBitmap(url: string): Promise<ImageBitmap | null> {
  try {
    if (typeof fetch === 'undefined' || typeof createImageBitmap === 'undefined') return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok || typeof res.arrayBuffer !== 'function') return null;
      const buf = await res.arrayBuffer();
      if (!buf || !buf.byteLength) return null;
      return await createImageBitmap(new Blob([buf]));
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

/**
 * 雪碧图切帧 → 压缩 jpeg → 存 blobRef。无 canvas / 无 createImageBitmap /
 * 加载失败一律返回空数组（帧是喂角色的加分项，不是建卡的必要条件）。
 */
async function sliceStoryboardFrames(
  spriteUrl: string,
  meta: StoryboardPick,
  count: number,
): Promise<string[]> {
  try {
    if (typeof document === 'undefined') return [];
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return [];
    const proxied = `${sfworkerUrl()}/bilibili/asset?u=${encodeURIComponent(spriteUrl)}`;
    const bitmap = await loadBitmap(proxied);
    if (!bitmap) return [];
    const rects = computeSpriteFrameRects(meta, count);
    const out: string[] = [];
    for (const r of rects) {
      canvas.width = r.sw;
      canvas.height = r.sh;
      ctx.drawImage(bitmap, r.sx, r.sy, r.sw, r.sh, 0, 0, r.sw, r.sh);
      out.push(await migrateDataUrlToRef(canvas.toDataURL('image/jpeg', 0.7)));
    }
    try { bitmap.close(); } catch { /* ignore */ }
    return out;
  } catch {
    return [];
  }
}

/**
 * 拉取一个 B站分享的完整内容，返回可直接存 webpage_card metadata 的 ExtractedWebpage。
 * view 失败抛错（调用方降级 apizero）；字幕/小结/预览帧拿不到只缺字段，不抛错。
 */
export async function fetchBilibiliWebpage(share: BilibiliShare): Promise<ExtractedWebpage> {
  const bvid = await resolveBvid(share);
  const view = await biliGet('view', { bvid });
  const cid = Number(view?.cid) || 0;
  const durationSec = Number(view?.duration) || 0;
  const wp = mapViewToWebpage(view, `https://www.bilibili.com/video/${bvid}`);
  const video = wp.video as VideoShareInfo;

  // 字幕（尽力）：player 字幕列表 → 优先中文 → asset 拉 JSON → 时间轴纯文本。
  try {
    if (cid) {
      const player = await biliGet('player', { bvid, cid: String(cid) });
      const subs = player?.subtitle?.subtitles;
      if (Array.isArray(subs) && subs.length > 0) {
        const picked = subs.find((s: any) => /^zh/i.test(String(s?.lan || ''))) || subs[0];
        const subUrl = String(picked?.subtitle_url || '');
        if (subUrl) {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
          try {
            const res = await fetch(
              `${sfworkerUrl()}/bilibili/asset?u=${encodeURIComponent(subUrl)}`,
              { signal: controller.signal },
            );
            const text = await res.text().catch(() => '');
            const subJson = text ? JSON.parse(text) : null;
            const lines = subtitleBodyToText(subJson?.body);
            if (lines) {
              video.subtitles = lines;
              video.subtitleCount = lines.split('\n').length;
            }
          } finally {
            clearTimeout(timer);
          }
        }
      }
    }
  } catch {
    // 无字幕不报错：卡片照建，角色读简介/标题/热度。
  }

  // 预览帧（尽力）：storyboard 几何信息存 metadata，切帧只在浏览器里做。
  try {
    if (cid) {
      const shoot = await biliGet('storyboard', { bvid, cid: String(cid) });
      const pick = pickStoryboard(shoot, durationSec);
      if (pick) {
        video.storyboard = pick;
        video.frames = await sliceStoryboardFrames(pick.spriteUrl, pick, BILIBILI_FRAME_COUNT);
      }
    }
  } catch {
    /* ignore */
  }

  return wp;
}
