export interface EpubImageConfig {
  hideIconImages: boolean;
  maxContentWidth: number;
  noteImageHeight: number;
  smallImageThreshold: number;
  dupDetectEnabled: boolean;
  dupThreshold: number;
}
export const EPUB_IMAGE_CONFIG_KEY = "study_epub_image_config";
export const EPUB_DUP_THRESHOLD_MIN = 2;
export const EPUB_DUP_THRESHOLD_MAX = 10;
export function clampDupThreshold(v: unknown, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(EPUB_DUP_THRESHOLD_MAX, Math.max(EPUB_DUP_THRESHOLD_MIN, Math.round(n)));
}
export function defaultEpubImageConfig(): EpubImageConfig {
  return { hideIconImages: false, maxContentWidth: 520, noteImageHeight: 32, smallImageThreshold: 64, dupDetectEnabled: true, dupThreshold: 3 };
}
export function loadEpubImageConfig(): EpubImageConfig {
  const def = defaultEpubImageConfig();
  try {
    const raw = localStorage.getItem(EPUB_IMAGE_CONFIG_KEY);
    if (!raw) return def;
    const p = JSON.parse(raw) as Partial<EpubImageConfig>;
    return {
      hideIconImages: typeof p.hideIconImages === "boolean" ? p.hideIconImages : def.hideIconImages,
      maxContentWidth: Number.isFinite(p.maxContentWidth) ? Math.min(1200, Math.max(160, Number(p.maxContentWidth))) : def.maxContentWidth,
      noteImageHeight: Number.isFinite(p.noteImageHeight) ? Math.min(96, Math.max(12, Number(p.noteImageHeight))) : def.noteImageHeight,
      smallImageThreshold: Number.isFinite(p.smallImageThreshold) ? Math.min(256, Math.max(16, Number(p.smallImageThreshold))) : def.smallImageThreshold,
      dupDetectEnabled: typeof p.dupDetectEnabled === "boolean" ? p.dupDetectEnabled : def.dupDetectEnabled,
      dupThreshold: clampDupThreshold(p.dupThreshold, def.dupThreshold),
    };
  } catch { return def; }
}
export function saveEpubImageConfig(cfg: EpubImageConfig): void {
  try { localStorage.setItem(EPUB_IMAGE_CONFIG_KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}
export type EpubImgRole = "note" | "icon" | "content";
export function classifyEpubImgRole(opts: { inNoteContext: boolean; width?: number; height?: number; threshold?: number }): EpubImgRole {
  if (opts.inNoteContext) return "note";
  const th = opts.threshold ?? 64;
  const w = opts.width ?? 0;
  const h = opts.height ?? 0;
  if (w > 0 && h > 0 && w <= th && h <= th) return "icon";
  return "content";
}

export interface DuplicateImageInfo {
  ref: string;
  count: number;
  role: EpubImgRole;
}

const TAG_RE = /<(img|image)\b[^>]*>/gi;
const REF_RE = /blobref:[A-Za-z0-9_]+/;
const ROLE_RE = /data-epub-img-role="([^"]*)"/;

function roleOfTag(tag: string): EpubImgRole {
  const m = ROLE_RE.exec(tag);
  const r = m ? m[1] : "";
  if (r === "note" || r === "icon" || r === "content") return r;
  return "content";
}

/** Count blobref image refs inside one chapter html (img + svg image tags). */
export function extractImageRefsFromHtml(html: string): Map<string, { count: number; role: EpubImgRole }> {
  const out = new Map<string, { count: number; role: EpubImgRole }>();
  if (!html) return out;
  TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_RE.exec(html)) !== null) {
    const tag = m[0];
    const rm = REF_RE.exec(tag);
    if (!rm) continue;
    const ref = rm[0];
    const role = roleOfTag(tag);
    const prev = out.get(ref);
    if (prev) prev.count += 1;
    else out.set(ref, { count: 1, role });
  }
  return out;
}

/** Aggregate chapters and return refs with count >= threshold, sorted desc. */
export function findDuplicateImages(
  chapters: Array<{ rawHtml?: string }>,
  threshold: number,
): DuplicateImageInfo[] {
  const th = clampDupThreshold(threshold, 3);
  const agg = new Map<string, { count: number; role: EpubImgRole }>();
  for (const ch of chapters || []) {
    const per = extractImageRefsFromHtml(ch.rawHtml || "");
    per.forEach((v, k) => {
      const prev = agg.get(k);
      if (prev) prev.count += v.count;
      else agg.set(k, { count: v.count, role: v.role });
    });
  }
  const list: DuplicateImageInfo[] = [];
  agg.forEach((v, k) => {
    if (v.count >= th) list.push({ ref: k, count: v.count, role: v.role });
  });
  list.sort((a, b) => b.count - a.count || (a.ref < b.ref ? -1 : 1));
  return list;
}
