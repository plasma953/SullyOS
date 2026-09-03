export interface EpubImageConfig {
  hideIconImages: boolean;
  maxContentWidth: number;
  noteImageHeight: number;
  smallImageThreshold: number;
}
export const EPUB_IMAGE_CONFIG_KEY = "study_epub_image_config";
export function defaultEpubImageConfig(): EpubImageConfig {
  return { hideIconImages: false, maxContentWidth: 520, noteImageHeight: 32, smallImageThreshold: 64 };
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
