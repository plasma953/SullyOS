/**
 * EPUB 原文阅读器组件（自习室专用）。
 * - EpubReaderContent：把章节 rawHtml（图片已改写为 blobref 令牌）白名单渲染成 React 树；
 * - SummaryPanel：AI 章节总结右侧滑出面板（loading / error / done 三态 + 遮罩关闭）。
 * 视觉对齐自习室课堂（深色玻璃拟态 + Tailwind）。
 */
import React from 'react';
import { useBlobRefUrl } from '../../../utils/blobRef';
import { X, ArrowsClockwise, WarningCircle } from '@phosphor-icons/react';

/** 解析 blobref 令牌后渲染；首帧未解析完成时占位，避免闪破图。 */
const BlobImg: React.FC<{ src: string; className?: string }> = ({ src, className }) => {
    const resolved = useBlobRefUrl(src);
    if (!resolved) {
        return <span className="block my-3 h-32 rounded-xl bg-white/5 animate-pulse" aria-label="图片加载中" />;
    }
    return <img src={resolved} className={className} loading="lazy" alt="" />;
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
            return <BlobImg key={keyPrefix} src={src} className="block max-w-full my-4 mx-auto rounded-xl border border-white/10" />;
        }
        case 'br': return <br key={keyPrefix} />;
        case 'hr': return <hr key={keyPrefix} className="my-5 border-white/10" />;
        case 'a': return <span key={keyPrefix} className="text-emerald-300/80 underline decoration-dotted">{children}</span>;
        case 'p': return <p key={keyPrefix} style={style} className="my-3 leading-7 text-slate-200">{children}</p>;
        case 'h1': return <h1 key={keyPrefix} style={style} className="text-xl font-bold mt-6 mb-3 text-white">{children}</h1>;
        case 'h2': return <h2 key={keyPrefix} style={style} className="text-lg font-bold mt-5 mb-3 text-white">{children}</h2>;
        case 'h3': return <h3 key={keyPrefix} style={style} className="text-base font-bold mt-4 mb-2 text-white">{children}</h3>;
        case 'h4': case 'h5': case 'h6':
            return <div key={keyPrefix} style={style} className="text-sm font-bold mt-4 mb-2 text-white">{children}</div>;
        case 'blockquote':
            return <blockquote key={keyPrefix} className="my-4 pl-4 border-l-2 border-emerald-500/50 text-slate-300 italic">{children}</blockquote>;
        case 'pre':
            return <pre key={keyPrefix} className="my-4 p-3 rounded-xl bg-black/40 border border-white/10 overflow-x-auto text-xs font-mono text-emerald-100">{children}</pre>;
        case 'ul': return <ul key={keyPrefix} className="my-3 pl-5 list-disc space-y-1 text-slate-200">{children}</ul>;
        case 'ol': return <ol key={keyPrefix} className="my-3 pl-5 list-decimal space-y-1 text-slate-200">{children}</ol>;
        case 'li': return <li key={keyPrefix} className="leading-7">{children}</li>;
        case 'strong': case 'b': return <strong key={keyPrefix} className="font-bold text-white">{children}</strong>;
        case 'em': case 'i': return <em key={keyPrefix} className="italic text-slate-100">{children}</em>;
        case 'u': return <u key={keyPrefix}>{children}</u>;
        case 's': return <s key={keyPrefix} className="opacity-60">{children}</s>;
        case 'sup': return <sup key={keyPrefix}>{children}</sup>;
        case 'sub': return <sub key={keyPrefix}>{children}</sub>;
        case 'small': return <small key={keyPrefix} className="text-xs opacity-70">{children}</small>;
        case 'code': return <code key={keyPrefix} className="px-1.5 py-0.5 rounded bg-black/40 text-orange-200 font-mono text-xs">{children}</code>;
        case 'figure': return <figure key={keyPrefix} className="my-4">{children}</figure>;
        case 'figcaption': return <figcaption key={keyPrefix} className="text-center text-[11px] text-slate-400 mt-1">{children}</figcaption>;
        case 'table':
            return (
                <div key={keyPrefix} className="my-4 overflow-x-auto">
                    <table className="w-full border-collapse text-xs text-slate-200">{children}</table>
                </div>
            );
        case 'thead': return <thead key={keyPrefix}>{children}</thead>;
        case 'tbody': return <tbody key={keyPrefix}>{children}</tbody>;
        case 'tr': return <tr key={keyPrefix} className="border-b border-white/10">{children}</tr>;
        case 'td': return <td key={keyPrefix} className="px-2 py-1.5 align-top">{children}</td>;
        case 'th': return <th key={keyPrefix} className="px-2 py-1.5 align-top font-bold text-white">{children}</th>;
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
                    <div className="mb-4 text-[11px] text-amber-300/80 bg-amber-500/10 border border-amber-400/20 rounded-xl px-3 py-2">
                        本章内容体积较大，已切换为纯文本模式（插图不显示）。
                    </div>
                )}
                <div className="whitespace-pre-wrap leading-7 text-slate-200">{fallbackText}</div>
            </div>
        );
    }
    if (!tree) {
        return <div className="text-center text-slate-500 text-sm py-10">本章内容为空</div>;
    }
    return <div>{tree}</div>;
};

/** 极简富文本：按行分段，仅支持 **加粗**（AI 总结输出够用）。 */
function renderRichText(text: string): React.ReactNode[] {
    return text.split(/\n+/).map((line, i) => (
        <p key={i} className="mb-2 leading-6 text-slate-200 text-sm whitespace-pre-wrap">
            {line.split(/(\*\*[^*]+\*\*)/g).map((part, j) => (
                part.startsWith('**') && part.endsWith('**')
                    ? <strong key={j} className="text-white font-bold">{part.slice(2, -2)}</strong>
                    : part
            ))}
        </p>
    ));
}

export type SummaryState = 'idle' | 'loading' | 'done' | 'error';

/** AI 章节总结侧滑面板：与课堂章节侧栏同款（animate-slide-in-right）视觉语言。 */
export const SummaryPanel: React.FC<{
    open: boolean;
    state: SummaryState;
    content: string;
    error?: string;
    onClose: () => void;
    onRetry: () => void;
}> = ({ open, state, content, error, onClose, onRetry }) => {
    if (!open) return null;
    return (
        <div className="absolute inset-0 z-50 flex">
            <div className="flex-1 bg-black/50 backdrop-blur-sm" onClick={onClose}></div>
            <div className="w-80 max-w-[85%] bg-slate-900 border-l border-white/10 h-full flex flex-col animate-slide-in-right shadow-2xl">
                <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
                    <h3 className="text-white font-bold text-sm uppercase tracking-widest">AI 章节总结</h3>
                    <button onClick={onClose} className="p-1.5 rounded-full text-slate-400 hover:text-white hover:bg-white/10 transition-colors">
                        <X size={18} />
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto no-scrollbar p-4">
                    {state === 'loading' && (
                        <div className="h-full min-h-40 flex flex-col items-center justify-center gap-3 text-slate-400">
                            <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
                            <span className="text-xs font-mono tracking-widest">SUMMARIZING...</span>
                        </div>
                    )}
                    {state === 'error' && (
                        <div className="h-full min-h-40 flex flex-col items-center justify-center gap-3 text-center px-4">
                            <WarningCircle size={36} className="text-red-400" />
                            <p className="text-xs text-slate-400">{error || '总结生成失败'}</p>
                            <button onClick={onRetry} className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl transition-colors">
                                <ArrowsClockwise size={14} /> 重试
                            </button>
                        </div>
                    )}
                    {state === 'done' && <div>{renderRichText(content)}</div>}
                    {state === 'idle' && (
                        <div className="h-full min-h-40 flex items-center justify-center text-xs text-slate-500">尚未生成总结</div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default EpubReaderContent;