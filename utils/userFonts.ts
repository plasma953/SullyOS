import type { UserFont } from "../types";

export const MAX_FONT_BYTES = 20 * 1024 * 1024;
export type FontFormat = UserFont["format"];
export const FONT_FAMILY_FALLBACK = "'Quicksand', 'Noto Sans SC', 'PingFang SC', system-ui, sans-serif";

export const fontAssetId = (id: string): string => `font_${id}`;
export const userFontFamily = (id: string): string => `UserFont_${id}`;

export function fontFormatFromFileName(name: string): FontFormat | null {
  const m = name.toLowerCase().match(/\.(ttf|otf|woff|woff2)(?:[?#].*)?$/);
  if (!m) return null;
  return m[1] as FontFormat;
};

export function formatFontSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
};

function magicOf(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf);
  return Array.from(b.slice(0, 4)).map((x) => x.toString(16).padStart(2, "0")).join("");
};

export function magicMatchesFormat(magic: string, format: FontFormat): boolean {
  const m = magic.toLowerCase();
  if (format === "ttf") return m === "00010000";
  if (format === "otf") return m === "4f54544f";
  if (format === "woff") return m === "774f4646";
  if (format === "woff2") return m === "774f4632";
  return false;
};

export function buildUserFontCss(fonts: UserFont[] | undefined, activeId: string | undefined): string {
  const faces = (fonts || []).filter((f) => f.dataUrl).map((f) => {
    const fam = userFontFamily(f.id);
    const src = f.dataUrl.startsWith("http") ? `url("${f.dataUrl}")` : `url("${f.dataUrl}")`;
    return `@font-face { font-family: '${fam}'; src: ${src}; font-display: swap; }`;
  }).join("\n");
  const active = (fonts || []).find((f) => f.id === activeId && f.dataUrl);
  const appFont = active ? `'${userFontFamily(active.id)}', ${FONT_FAMILY_FALLBACK}` : FONT_FAMILY_FALLBACK;
  return `${faces}\n:root { --app-font: ${appFont}; --app-font-family: ${appFont}; }`;
};

/** Register all fonts + point --app-font at active. Reuses legacy style id to override single-font css. */
export function applyUserFonts(fonts: UserFont[] | undefined, activeId: string | undefined): void {
  if (typeof document === "undefined") return;
  let style = document.getElementById("custom-font-style");
  if (!style) {
    style = document.createElement("style");
    style.id = "custom-font-style";
    document.head.appendChild(style);
  }
  style.textContent = buildUserFontCss(fonts, activeId);
};

export function stripUserFontsForLS(fonts: UserFont[] | undefined): UserFont[] | undefined {
  if (!fonts) return undefined;
  return fonts.map((f) => ({ ...f, dataUrl: f.dataUrl.startsWith("data:") ? "" : f.dataUrl }));
};

export function migrateLegacyCustomFont(customFont: string | undefined): UserFont | null {
  if (!customFont) return null;
  let format: FontFormat = "ttf";
  if (customFont.startsWith("data:")) {
    const head = customFont.slice(0, 64).toLowerCase();
    if (head.includes("woff2")) format = "woff2";
    else if (head.includes("woff")) format = "woff";
    else if (head.includes("opentype") || head.includes("otf")) format = "otf";
    else format = "ttf";
  } else {
    format = fontFormatFromFileName(customFont) || "ttf";
  }
  return { id: `legacy-${Date.now()}`, name: customFont.startsWith("data:") ? "旧字体" : customFont.split("/").pop() || "网络字体", format, dataUrl: customFont, sizeBytes: 0, createdAt: Date.now() };
};

export interface ValidatedFontFile { format: FontFormat; dataUrl: string; sizeBytes: number; name: string; }

/** Three-layer check: ext/MIME -> magic bytes -> size + FontFace trial parse. Throws Error on failure. */
export async function validateFontFile(file: File): Promise<ValidatedFontFile> {
  const format = fontFormatFromFileName(file.name);
  if (!format) throw new Error("仅支持 ttf/otf/woff/woff2 格式");
  if (file.size > MAX_FONT_BYTES) throw new Error("字体超过20MB上限");
  if (file.size <= 0) throw new Error("空文件");
  const head = await file.slice(0, 4).arrayBuffer();
  if (!magicMatchesFormat(magicOf(head), format)) throw new Error("文件头与扩展名不符，可能后缀错误");
  try {
    const buf = await file.arrayBuffer();
    const probe = new FontFace("__sully_probe__", buf);
    await probe.load();
  } catch {
    throw new Error("字体解析失败，文件可能损坏");
  }
  const dataUrl: string = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error("读取失败"));
    r.readAsDataURL(file);
  });
  return { format, dataUrl, sizeBytes: file.size, name: file.name.replace(/\.[^.]+$/, "").slice(0, 32) || file.name };
};

export function createUserFont(v: ValidatedFontFile): UserFont {
  const id = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  return { id, name: v.name, format: v.format, dataUrl: v.dataUrl, sizeBytes: v.sizeBytes, createdAt: Date.now() };
};

