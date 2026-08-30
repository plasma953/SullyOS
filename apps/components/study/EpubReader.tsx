/**
 * EPUB 原文阅读器组件（自习室专用）。
 * - EpubReaderContent：把章节 rawHtml（图片已改写为 blobref 令牌）白名单渲染成 React 树；
 * - SummaryPanel：AI 章节总结右侧滑出面板（loading / error / done 三态 + 遮罩关闭）；
 * - EpubThemeMenu / useReaderTheme：阅读配色（白天/护眼/夜间）切换与持久化。
 * 视觉对齐自习室课堂（玻璃拟态 + Tailwind）；主题色经 --er-* CSS 变量注入（EpubReader.css）。
 */
import React from 'react';
import { useBlobRefUrl } from '../../../utils/blobRef';
import { X, ArrowsClockwise, WarningCircle, Palette } from '@phosphor-icons/react';
import './EpubReader.css';

/* ============================== 配色主题 ============================== */

export type ReadingThemeId = 'dark' | 'sepia' | 'day';

/** 主题预设（swatch 用于菜单色块预览，与 EpubReader.css 变量保持一致）。 */
export const READING_THEMES: { id: ReadingThemeId; label: string; swatchBg: string; swatchFg: string }[] = [
    { id: 'dark', label: '夜间', swatchBg: '#1a1f24', swatchFg: '#e2e8f0' },
    { id: 'sepia', label: '护眼', swatchBg: '#f4ecd8', swatchFg: '#3f3428' },
    { id: 'day', label: '白天', swatchBg: '#ffffff', swatchFg: '#1f2937' },
];

const EPUB_THEME_KEY = 'study_epub_reader_theme';

/** 阅读器配色状态：localStorage 持久化；缺省夜间（保持既有视觉不变）。 */
export function useReaderTheme(): { theme: ReadingThemeId; setTheme: (t: ReadingThemeId) => void } {
    const [theme, setThemeState] = React.useState<ReadingThemeId>(() => {
        try {
            const v = localStorage.getItem(EPUB_THEME_KEY);
            return v && READING_THEMES.some(t => t.id === v) ? (v as ReadingThemeId) : 'dark';
        } catch {
            return 'dark';
        }
    });
    const setTheme = React.useCallback((t: ReadingThemeId) => {
        setThemeState(t);
        try { localStorage.setItem(EPUB_THEME_KEY, t); } catch { /* 私密模式等异常场景忽略 */ }
    }, []);
    return { theme, setTheme };
}

/* ============================== 正文渲染 ============================== */

/** 解析 blobref 令牌后渲染；首帧未解析完成时占位，避免闪破图。
 *  small=true：引用上下文内的标注图，压缩为行内小尺寸，避免大图霸屏打断阅读。 */
const BlobImg: React.FC<{ src: string; small?: boolean }> = ({ src, small }) => {
    const resolved = useBlobRefUrl(src);
    if (!resolved) {
        return <span className={`epub-r-img-ph ${small ? 'h-10' : 'h-32'} block my-3 rounded-xl animate-pulse`} aria-label="图片加载中" />;
    }
    return <img src={resolved} loading="lazy" alt="" className={small ? 'epub-r-img-s' : 'epub-r-img-l'} />;
};

/** 允许渲染的标签白名单。 */
const ALLOWED_TAGS = new Set([
    'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'div', 'span', 'em', 'strong', 'u', 's',
    'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'table', 'thead', 'tbody', 'tr', 'td', 'th',
    'img', 'br', 'hr', 'a', 'sup', 'sub', 'figure', 'figcaption', 'small', 'b', 'i',
]);

/** 直接丢弃的标签（清洗漏网的交互/媒体元素）。 */
const IGNORED_TAGS = new Set(['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'video', 'audio', 'link', 'meta']);

/** 仅透传文字对齐（EPUB 排版最常见且安全的内联样式）。 */
function alignOf(el: Element): 'left' | 'center' | 'right' | 'justify' | undefined {
    const htmlEl = el as HTMLElement;
    const raw = ((el.getAttribute('align') || htmlEl.style?.textAlign || '') as string).toLowerCase();
    return ['center', 'right', 'justify'].includes(raw) ? (raw as 'center' | 'right' | 'justify') : undefined;
}

function renderChildren(el: Element, keyPrefix: string): React.ReactNode[] {
    return Array.from(el.childNodes)
        .map((child, i) => renderNode(child, `${keyPrefix}.${i}`))
        .filter(v => v !== null && v !== undefined);
}

function renderNode(node: Node, keyPrefix: string): React.ReactNode {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue;
    if (node.nodeType !== Node.ELEMENT_NODE) return null;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    if (IGNORED_TAGS.has(tag)) return null;
    const children = renderChildren(el, keyPrefix);
    if (!ALLOWED_TAGS.has(tag)) {
        // 未知容器（svg、section 变体等）：不渲染自身，展开子节点保留内容
        return <React.Fragment key={keyPrefix}>{children}</React.Fragment>;
    }
    const style = alignOf(el) ? { textAlign: alignOf(el) } : undefined;
    switch (tag) {
        case 'img': {
            const src = el.getAttribute('src');
            if (!src) return null;
            // 引用（blockquote）内的图片视为「引用标注图」：统一压缩为行内小图，杜绝大图霸屏
            const inQuote = !!(el.closest && el.closest('blockquote'));
            return <BlobImg key={keyPrefix} src={src} small={inQuote} />;
        }
        case 'br': return <br key={keyPrefix} />;
        case 'hr': return <hr key={keyPrefix} className="er-line my-5" />;
        case 'a': return <span key={keyPrefix} className="er-link underline decoration-dotted">{children}</span>;
        case 'p': return <p key={keyPrefix} style={style} className="er-tx my-3 leading-7">{children}</p>;
        case 'h1': return <h1 key={keyPrefix} style={style} className="er-tx-strong text-xl font-bold mt-6 mb-3">{children}</h1>;
        case 'h2': return <h2 key={keyPrefix} style={style} className="er-tx-strong text-lg font-bold mt-5 mb-3">{children}</h2>;
        case 'h3': return <h3 key={keyPrefix} style={style} className="er-tx-strong text-base font-bold mt-4 mb-2">{children}</h3>;
        case 'h4': case 'h5': case 'h6':
            return <div key={keyPrefix} style={style} className="er-tx-strong text-sm font-bold mt-4 mb-2">{children}</div>;
        case 'blockquote':
            return <blockquote key={keyPrefix} className="er-bq my-4 pl-4 border-l-2 italic">{children}</blockquote>;
        case 'pre':
            return <pre key={keyPrefix} className="er-pre my-4 p-3 rounded-xl border overflow-x-auto text-xs font-mono">{children}</pre>;
        case 'ul': return <ul key={keyPrefix} className="er-tx my-3 pl-5 list-disc space-y-1">{children}</ul>;
        case 'ol': return <ol key={keyPrefix} className="er-tx my-3 pl-5 list-decimal space-y-1">{children}</ol>;
        case 'li': return <li key={keyPrefix} className="leading-7">{children}</li>;
        case 'strong': case 'b': return <strong key={keyPrefix} className="er-tx-strong font-bold">{children}</strong>;
        case 'em': case 'i': return <em key={keyPrefix} className="er-tx italic">{children}</em>;
        case 'u': return <u key={keyPrefix}>{children}</u>;
        case 's': return <s key={keyPrefix} className="opacity-60">{children}</s>;
        case 'sup': return <sup key={keyPrefix}>{children}</sup>;
        case 'sub': return <sub key={keyPrefix}>{children}</sub>;
        case 'small': return <small key={keyPrefix} className="text-xs opacity-70">{children}</small>;
        case 'code': return <code key={keyPrefix} className="er-pre rounded px-1.5 py-0.5 font-mono text-xs">{children}</code>;
        case 'figure': return <figure key={keyPrefix} className="my-4">{children}</figure>;
        case 'figcaption': return <figcaption key={keyPrefix} className="er-tx-dim text-center text-[11px] mt-1">{children}</figcaption>;
        case 'table':
            return (
                <div key={keyPrefix} className="er-tx my-4 overflow-x-auto">
                    <table className="w-full border-collapse text-xs">{children}</table>
                </div>
            );
        case 'thead': return <thead key={keyPrefix}>{children}</thead>;
        case 'tbody': return <tbody key={keyPrefix}>{children}</tbody>;
        case 'tr': return <tr key={keyPrefix} className="er-line border-b">{children}</tr>;
        case 'td': return <td key={keyPrefix} className="px-2 py-1.5 align-top">{children}</td>;
        case 'th': return <th key={keyPrefix} className="er-tx-strong px-2 py-1.5 align-top font-bold">{children}</th>;
        case 'div': case 'section': case 'article':
            return <div key={keyPrefix} style={style}>{children}</div>;
        default:
            return <span key={keyPrefix}>{children}</span>;
    }
}

/** EPUB 原文渲染主体。html 为空且给出 fallbackText 时降级为纯文本模式。 */
export const EpubReaderContent: React.FC<{ html: string; textOnly?: boolean; fallbackText?: string }> = ({ html, textOnly, fallbackText }) => {
    const tree = React.useMemo(() => {
        if (!html) return null;
        try {
            const doc = new DOMParser().parseFromString(`<div id="epub-root">${html}</div>`, 'text/html');
            const root = doc.getElementById('epub-root');
            return root ? renderChildren(root, 'r') : null;
        } catch {
            return null;
        }
    }, [html]);

    if (textOnly || (!tree && fallbackText)) {
        return (
            <div>
                {textOnly && (
                    <div className="er-note mb-4 text-[11px] rounded-xl px-3 py-2 border">
                        本章内容体积较大，已切换为纯文本模式（插图不显示）。
                    </div>
                )}
                <div className="er-tx whitespace-pre-wrap leading-7">{fallbackText}</div>
            </div>
        );
    }
    if (!tree) {
        return <div className="er-tx-dim text-center text-sm py-10">本章内容为空</div>;
    }
    return <div className="er-body">{tree}</div>;
};

/* ============================== AI 总结侧滑 ============================== */

/** 极简富文本：按行分段，仅支持 **加粗**（AI 总结输出够用）。 */
function renderRichText(text: string): React.ReactNode[] {
    return text.split(/\n+/).map((line, i) => (
        <p key={i} className="er-tx mb-2 leading-6 text-sm whitespace-pre-wrap">
            {line.split(/(\*\*[^*]+\*\*)/g).map((part, j) => (
                part.startsWith('**') && part.endsWith('**')
                    ? <strong key={j} className="er-tx-strong font-bold">{part.slice(2, -2)}</strong>
                    : part
            ))}
        </p>
    ));
}

export type SummaryState = 'idle' | 'loading' | 'done' | 'error';

/** AI 章节总结侧滑面板：与课堂章节侧栏同款（animate-slide-in-right）视觉语言；配色随阅读主题。 */
export const SummaryPanel: React.FC<{
    open: boolean;
    state: SummaryState;
    content: string;
    error?: string;
    theme?: ReadingThemeId;
    onClose: () => void;
    onRetry: () => void;
}> = ({ open, state, content, error, theme = 'dark', onClose, onRetry }) => {
    if (!open) return null;
    return (
        <div className="epub-r absolute inset-0 z-50 flex" data-theme={theme}>
            <div className="flex-1 bg-black/50 backdrop-blur-sm" onClick={onClose}></div>
            <div className="epub-r-panel er-line border-l w-80 max-w-[85%] h-full flex flex-col animate-slide-in-right shadow-2xl">
                <div className="er-line flex items-center justify-between px-4 py-3 border-b">
                    <h3 className="er-tx-strong font-bold text-sm uppercase tracking-widest">AI 章节总结</h3>
                    <button onClick={onClose} className="epub-r-btn p-1.5 rounded-full transition-colors">
                        <X size={18} />
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto no-scrollbar p-4">
                    {state === 'loading' && (
                        <div className="h-full min-h-40 flex flex-col items-center justify-center gap-3 er-tx-dim">
                            <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
                            <span className="text-xs font-mono tracking-widest">SUMMARIZING...</span>
                        </div>
                    )}
                    {state === 'error' && (
                        <div className="h-full min-h-40 flex flex-col items-center justify-center gap-3 text-center px-4">
                            <WarningCircle size={36} className="text-red-400" />
                            <p className="er-tx text-xs">{error || '总结生成失败'}</p>
                            <button onClick={onRetry} className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl transition-colors">
                                <ArrowsClockwise size={14} /> 重试
                            </button>
                        </div>
                    )}
                    {state === 'done' && <div>{renderRichText(content)}</div>}
                    {state === 'idle' && (
                        <div className="h-full min-h-40 flex items-center justify-center text-xs er-tx-dim">尚未生成总结</div>
                    )}
                </div>
            </div>
        </div>
    );
};

/* ============================== 配色菜单 ============================== */

/** 阅读配色切换菜单：底部浮层，色块即时预览，点击即切换并持久化。 */
export const EpubThemeMenu: React.FC<{
    theme: ReadingThemeId;
    onPick: (t: ReadingThemeId) => void;
    onClose: () => void;
}> = ({ theme, onPick, onClose }) => (
    <div className="epub-r absolute inset-0 z-50 flex" data-theme={theme}>
        <div className="flex-1 bg-black/40 backdrop-blur-sm" onClick={onClose}></div>
        <div className="epub-r-panel er-line border absolute bottom-24 left-1/2 -translate-x-1/2 rounded-2xl p-4 shadow-2xl animate-slide-in-right" onClick={e => e.stopPropagation()}>
            <h4 className="er-tx-strong text-xs font-bold uppercase tracking-widest mb-3 flex items-center gap-1.5">
                <Palette size={14} /> 阅读配色
            </h4>
            <div className="flex gap-2">
                {READING_THEMES.map(t => (
                    <button
                        key={t.id}
                        onClick={() => onPick(t.id)}
                        className={`epub-r-theme-btn ${theme === t.id ? 'active' : ''}`}
                    >
                        <span className="epub-r-theme-swatch er-line" style={{ background: t.swatchBg }}>
                            <span className="w-4 h-0.5 rounded-full" style={{ background: t.swatchFg }}></span>
                        </span>
                        <span className="text-[10px] font-bold">{t.label}</span>
                    </button>
                ))}
            </div>
        </div>
    </div>
);

export default EpubReaderContent;
