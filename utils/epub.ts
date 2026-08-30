/**
 * EPUB 解析与图片持久化工具（自习室专用）。
 * 设计目标（见实施计划）：
 * - 内存友好：图片逐张 put 不驻堆、章节串行解析、单章 HTML 超限时降级纯文本；
 * - 图片走系统既有 blobref 令牌体系（IndexedDB blob_assets，自动进备份/GC）；
 * - rawText = 各章纯文本按 spine 顺序拼接，使 handleTeach 的「均分取段」零改动复用。
 */
import JSZip from 'jszip';
import { putImageBlob } from './blobRef';

const EPUB_MIME = 'application/epub+zip';

/** 单章解析结果。 */
export interface EpubChapterData {
    /** 章节标题。 */
    title: string;
    /** blobref 改写后的章节 HTML（清洗后的 fragment，不含外层 html/body）。 */
    rawHtml: string;
    /** 本章纯文本，用于 rawText 拼接与 AI 总结。 */
    plainText: string;
    /** true 表示该章因体积超限，只保留纯文本（阅读器会提示）。 */
    textOnly: boolean;
}

export interface EpubParseResult {
    /** 书名（OPF metadata title，缺省用文件名去扩展名）。 */
    title: string;
    chapters: EpubChapterData[];
    /** 封面 blobref 令牌（若识别到）。 */
    coverImageRef?: string;
    /** 各章纯文本按 spine 顺序拼接（以空行分隔），供 AI 讲课/刷题均分取段。 */
    rawText: string;
}

export interface EpubParseProgress {
    phase: 'read' | 'metadata' | 'chapter' | 'image' | 'done';
    message: string;
}

export type EpubProgressCallback = (p: EpubParseProgress) => void;

/** 单章 HTML 体积上限：超过则降级为「仅纯文本」（防内存与渲染压力）。 */
const CHAPTER_HTML_LIMIT = 2000000;

/** EPUB 判定：MIME application/epub+zip 或扩展名 .epub。 */
export function isEpubFile(file: File): boolean {
    const name = (file.name || '').toLowerCase();
    if (file.type === EPUB_MIME) return true;
    // Android 的 DocumentsProvider 可能给 .epub 任意/空 MIME（含 application/zip），扩展名优先放行
    return name.endsWith('.epub');
}

/** 把 OPF/NCX/nav 文档里的相对 href 解析成 zip 内路径。 */
function zipPathFromHref(href: string | null | undefined, baseDir: string): string | null {
    if (!href) return null;
    if (/^(data:|blob:|https?:)/i.test(href)) return null;
    const clean = href.split('#')[0].trim();
    if (!clean) return null;
    try {
        const merged = new URL(clean, `http://placeholder.local/${baseDir}`).pathname;
        return decodeURIComponent(merged).replace(/^\/+/, '');
    } catch {
        return null;
    }
}

/** 归一化 zip 内路径（处理 ../ 与 ./）。 */
function normalizeZipPath(path: string): string {
    const parts: string[] = [];
    for (const seg of path.split('/')) {
        if (!seg || seg === '.') continue; // eslint-disable-line no-continue
        if (seg === '..') { parts.pop(); continue; } // eslint-disable-line no-continue
        parts.push(seg);
    }
    return parts.join('/');
}

/** 判定 zip 内路径是否指向图片资源。 */
function looksLikeImage(path: string, type?: string): boolean {
    if (type && /^image\//i.test(type)) return true;
    return /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(path);
}

function mimeFromPath(path: string): string {
    if (/\.png$/i.test(path)) return 'image/png';
    if (/\.jpe?g$/i.test(path)) return 'image/jpeg';
    if (/\.gif$/i.test(path)) return 'image/gif';
    if (/\.webp$/i.test(path)) return 'image/webp';
    if (/\.svg$/i.test(path)) return 'image/svg+xml';
    if (/\.bmp$/i.test(path)) return 'image/bmp';
    if (/\.avif$/i.test(path)) return 'image/avif';
    return 'application/octet-stream';
}

function looksLikeHtml(path: string): boolean {
    return /\.(x?html?|xml)$/i.test(path) || !/\.[a-z0-9]+$/i.test(path);
}

/** zip 内资源索引：normalized 路径 → File（小写索引用于容错命中）。 */
interface BookResources {
    files: Map<string, File>;
    lower: Map<string, File>;
}

async function loadResourceMap(zip: JSZip): Promise<BookResources> {
    const files = new Map<string, File>();
    const lower = new Map<string, File>();
    const entries = Object.values(zip.files);
    for (const entry of entries) {
        if (entry.dir) continue; // eslint-disable-line no-continue
        const name = normalizeZipPath(entry.name);
        // 串行解压：资源被 File 收编即弃原始 Blob，避免整本书同时驻留堆上（内存友好）
        // eslint-disable-next-line no-await-in-loop
        const blob = await entry.async('blob');
        const file = new File([blob], name);
        files.set(name, file);
        if (!lower.has(name.toLowerCase())) lower.set(name.toLowerCase(), file);
    }
    return { files, lower };
}

/** 按 zip 内路径取资源：精确 → 小写 → 后缀容错（OPF 相对路径的大小写/编码差异）。 */
function resolveResource(res: BookResources, path: string): File | undefined {
    return res.files.get(path)
        || res.lower.get(path.toLowerCase())
        || [...res.lower.entries()].find(([k]) => k.endsWith(`/${path.toLowerCase()}`))?.[1];
}

/** 清洗章节 DOM：剔除交互/媒体节点、超链接置空动作。原地修改。 */
function sanitizeNode(node: Element): void {
    node.querySelectorAll('script, style, iframe, object, embed, form, input, button, video, audio').forEach(el => el.remove());
    node.querySelectorAll('a[href]').forEach(a => {
        a.removeAttribute('href');
        a.setAttribute('data-epub-link', '1');
    });
}

/** 把章节 DOM 内所有图片改写为 blobref 令牌（逐张 put，用完即弃）。 */
async function persistImages(
    root: ParentNode,
    resources: BookResources,
    baseDir: string,
    onProgress: EpubProgressCallback,
): Promise<void> {
    const imgs = Array.from(root.querySelectorAll('img[src], image[href], image[xlink\\:href]'));
    for (let i = 0; i < imgs.length; i++) {
        const el = imgs[i] as Element;
        const isSvgImage = el.tagName.toLowerCase() === 'image';
        const attr = isSvgImage ? (el.getAttribute('href') ? 'href' : 'xlink:href') : 'src';
        const path = zipPathFromHref(el.getAttribute(attr), baseDir);
        const file = path ? resolveResource(resources, path) : undefined;
        if (!path || !file || (isSvgImage && !looksLikeImage(path))) {
            if (!isSvgImage) el.removeAttribute(attr);
            continue; // eslint-disable-line no-continue
        }
        const blob = file.slice(0, file.size, mimeFromPath(path));
        // 逐张 put：图片 Blob 用完即弃，不驻留堆上（内存友好）
        // eslint-disable-next-line no-await-in-loop
        const token = await putImageBlob(blob);
        el.setAttribute(attr, token);
        onProgress({ phase: 'image', message: `存储图片 ${i + 1}/${imgs.length}` });
    }
}

/** DOM → 纯文本（块级元素追加换行，保留阅读语感）。 */
function domToPlainText(root: Element): string {
    const blockTags = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
        'LI', 'TR', 'BLOCKQUOTE', 'PRE', 'HR', 'FIGURE', 'FIGCAPTION', 'TABLE', 'UL', 'OL']);
    const out: string[] = [];
    const walk = (node: Node) => {
        if (node.nodeType === Node.TEXT_NODE) {
            out.push(node.nodeValue || '');
            return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        const el = node as Element;
        const tag = el.tagName.toUpperCase();
        if (tag === 'BR') { out.push('\n'); return; }
        el.childNodes.forEach(walk);
        if (blockTags.has(tag)) out.push('\n');
    };
    walk(root);
    return out.join('').replace(/[ \t\u00a0]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

interface ManifestItem {
    href: string;
    mediaType?: string;
    props?: string;
}

function buildManifest(opfDoc: Document): Map<string, ManifestItem> {
    const manifest = new Map<string, ManifestItem>();
    Array.from(opfDoc.getElementsByTagName('*')).forEach(el => {
        if (el.localName !== 'item') return;
        const id = el.getAttribute('id');
        const href = el.getAttribute('href');
        if (!id || !href) return;
        manifest.set(id, {
            href,
            mediaType: el.getAttribute('media-type') || undefined,
            props: el.getAttribute('properties') || undefined,
        });
    });
    return manifest;
}

/**
 * 解析目录标题表（EPUB3 nav.xhtml + EPUB2 toc.ncx），键为 zip 内章节路径。
 * 章节文档自身没有 h1-h6 标题时用它补齐。
 */
async function buildTocTitles(
    resources: BookResources,
    opfDoc: Document,
    manifest: Map<string, ManifestItem>,
    opfDir: string,
): Promise<Map<string, string>> {
    const titles = new Map<string, string>();
    const addTitle = (href: string | null, text: string, baseDir: string) => {
        const p = zipPathFromHref(href, baseDir);
        const t = text.replace(/\s+/g, ' ').trim();
        if (p && t && looksLikeHtml(p) && !titles.has(p)) titles.set(p, t);
    };

    // EPUB3：manifest item[properties~=nav]
    const navItem = [...manifest.values()].find(it => it.props && /\bnav\b/.test(it.props));
    if (navItem) {
        const navPath = zipPathFromHref(navItem.href, opfDir);
        const file = navPath ? resolveResource(resources, navPath) : undefined;
        if (file) {
            const doc = new DOMParser().parseFromString(await file.text(), 'text/html');
            const navs = Array.from(doc.getElementsByTagName('nav'));
            const tocNav = navs.find(n => /toc/i.test(n.getAttribute('epub:type') || '')) || navs[0];
            const navDir = navPath && navPath.includes('/') ? navPath.slice(0, navPath.lastIndexOf('/') + 1) : '';
            tocNav?.querySelectorAll('a[href]').forEach(a => addTitle(a.getAttribute('href'), a.textContent || '', navDir));
        }
    }

    // EPUB2：spine[toc] → NCX navMap
    const spineEl = Array.from(opfDoc.getElementsByTagName('*')).find(el => el.localName === 'spine');
    const tocId = spineEl?.getAttribute('toc') || '';
    const ncxItem = manifest.get(tocId)
        || [...manifest.values()].find(it => it.mediaType === 'application/x-dtbncx+xml');
    if (ncxItem) {
        const ncxPath = zipPathFromHref(ncxItem.href, opfDir);
        const file = ncxPath ? resolveResource(resources, ncxPath) : undefined;
        if (file) {
            const doc = new DOMParser().parseFromString(await file.text(), 'text/xml');
            const ncxDir = ncxPath && ncxPath.includes('/') ? ncxPath.slice(0, ncxPath.lastIndexOf('/') + 1) : '';
            Array.from(doc.getElementsByTagName('*')).forEach(el => {
                if (el.localName !== 'navPoint') return;
                const label = Array.from(el.getElementsByTagName('*')).find(x => x.localName === 'text');
                const content = Array.from(el.children || []).find(x => x.localName === 'content');
                if (label && content) addTitle(content.getAttribute('src'), label.textContent || '', ncxDir);
            });
        }
    }
    return titles;
}

/** 串行解析 spine 章节列表。 */
async function parseChapters(
    resources: BookResources,
    opfDoc: Document,
    opfDir: string,
    tocTitles: Map<string, string>,
    onProgress: EpubProgressCallback,
): Promise<{ chapters: EpubChapterData[]; coverPath?: string }> {
    const manifest = buildManifest(opfDoc);

    // 封面识别：manifest properties 含 cover-image，或 id 恰为 cover 的图片项
    let coverPath: string | undefined;
    for (const [id, item] of manifest) {
        if (item.props && /cover-image/i.test(item.props)) {
            coverPath = zipPathFromHref(item.href, opfDir) || undefined;
            break;
        }
        if (!coverPath && /^cover$/i.test(id) && looksLikeImage(item.href, item.mediaType)) {
            coverPath = zipPathFromHref(item.href, opfDir) || undefined;
        }
    }

    const spineEl = Array.from(opfDoc.getElementsByTagName('*')).find(el => el.localName === 'spine');
    const spineIds = spineEl
        ? Array.from(spineEl.getElementsByTagName('*'))
            .filter(el => el.localName === 'itemref')
            .map(el => el.getAttribute('idref'))
            .filter((v): v is string => !!v)
        : [];

    const chapters: EpubChapterData[] = [];
    for (let i = 0; i < spineIds.length; i++) {
        const item = manifest.get(spineIds[i]);
        if (!item) continue; // eslint-disable-line no-continue
        const path = zipPathFromHref(item.href, opfDir);
        if (!path || !looksLikeHtml(path)) continue; // eslint-disable-line no-continue
        const entry = resolveResource(resources, path);
        if (!entry) continue; // eslint-disable-line no-continue
        onProgress({ phase: 'chapter', message: `解析章节 ${i + 1}/${spineIds.length}` });

        // eslint-disable-next-line no-await-in-loop
        const html = await entry.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const body = doc.body;
        if (!body) continue; // eslint-disable-line no-continue
        sanitizeNode(body);

        const headEl = Array.from(body.getElementsByTagName('*')).find(el => /^h[1-6]$/i.test(el.tagName));
        const title = headEl?.textContent?.replace(/\s+/g, ' ').trim()
            || tocTitles.get(path)
            || `第 ${chapters.length + 1} 节`;

        if (html.length > CHAPTER_HTML_LIMIT) {
            // 降级：仅保留纯文本，阅读器提示不支持原文渲染
            const plainText = body.textContent?.replace(/[ \t\u00a0]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim() || '';
            chapters.push({ title, rawHtml: '', plainText, textOnly: true });
            continue; // eslint-disable-line no-continue
        }

        const baseDir = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
        // eslint-disable-next-line no-await-in-loop
        await persistImages(body, resources, baseDir, onProgress);
        chapters.push({
            title,
            rawHtml: body.innerHTML,
            plainText: domToPlainText(body),
            textOnly: false,
        });
    }
    return { chapters, coverPath };
}

/**
 * 主入口：解析 EPUB 文件。
 * 抛错时为中文提示，调用方应保证失败时不落库。
 */
export async function parseEpubFile(file: File, onProgress?: EpubProgressCallback): Promise<EpubParseResult> {
    const progress = onProgress || (() => undefined);
    const fallbackName = file.name.replace(/\.epub$/i, '');

    progress({ phase: 'read', message: '正在读取 EPUB 文件...' });
    const buffer = await file.arrayBuffer();
    let zip: JSZip;
    try {
        zip = await JSZip.loadAsync(buffer);
    } catch {
        throw new Error('EPUB 文件解压失败，文件可能已损坏');
    }

    // container.xml → OPF 路径（缺失时兜底找第一个 .opf）
    let opfPath: string | null = null;
    const containerEntry = zip.file('META-INF/container.xml');
    if (containerEntry) {
        const doc = new DOMParser().parseFromString(await containerEntry.async('text'), 'text/xml');
        const rootfile = Array.from(doc.getElementsByTagName('*')).find(el => el.localName === 'rootfile');
        opfPath = rootfile?.getAttribute('full-path') || null;
    }
    if (!opfPath) {
        opfPath = Object.keys(zip.files).find(k => /\.opf$/i.test(k)) || null;
    }
    if (!opfPath) throw new Error('EPUB 缺少 OPF 元数据，无法解析目录');

    progress({ phase: 'metadata', message: '正在解析书籍元数据...' });
    const opfEntry = zip.file(opfPath);
    if (!opfEntry) throw new Error('EPUB 元数据文件缺失');
    const opfDoc = new DOMParser().parseFromString(await opfEntry.async('text'), 'text/xml');
    const titleEl = Array.from(opfDoc.getElementsByTagName('*')).find(el => el.localName === 'title');
    const title = titleEl?.textContent?.trim() || fallbackName;

    const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';

    progress({ phase: 'metadata', message: '正在建立资源索引...' });
    const resources = await loadResourceMap(zip);
    const tocTitles = await buildTocTitles(resources, opfDoc, buildManifest(opfDoc), opfDir);

    const { chapters, coverPath } = await parseChapters(resources, opfDoc, opfDir, tocTitles, progress);
    if (!chapters.length) throw new Error('EPUB 中未找到可读章节');

    // 封面：优先 OPF 声明的封面图，其次首章第一张已持久化的图片
    let coverImageRef: string | undefined;
    if (coverPath) {
        const fileRes = resolveResource(resources, coverPath);
        if (fileRes) {
            coverImageRef = await putImageBlob(fileRes.slice(0, fileRes.size, mimeFromPath(coverPath)));
        }
    }
    if (!coverImageRef) {
        for (const ch of chapters) {
            if (!ch.rawHtml) continue; // eslint-disable-line no-continue
            const tmp = document.createElement('div');
            tmp.innerHTML = ch.rawHtml;
            const firstImg = tmp.querySelector('img[src^="blobref:"]');
            if (firstImg) coverImageRef = firstImg.getAttribute('src') || undefined;
            tmp.remove();
            if (coverImageRef) break;
        }
    }

    progress({ phase: 'done', message: '导入完成' });
    const rawText = chapters.map(c => c.plainText).filter(Boolean).join('\n\n');

    return { title, chapters, coverImageRef, rawText };
}
