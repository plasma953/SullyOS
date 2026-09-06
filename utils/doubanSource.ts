import { getProxyWorkerUrl } from './proxyWorker';
import type { SocialComment, SocialPost } from '../types';

/**
 * Spark「发现」页的豆瓣小组真实内容源。
 *
 * 数据链路：豆瓣 rexxar 公开接口（匿名可读）← sfworker `/social/douban/*`
 * 补 iPhone UA + m 站 Referer、话题列表 120s 缓存（见 worker/index.js）。
 * 归一化成 SocialPost（origin='douban'，id 带 `douban:` 前缀），与 LLM 生成帖
 * 共用信息流合并（utils/socialFeedMerge.ts）与 IndexedDB（social_posts）。
 *
 * 模拟互动（点赞/评论/收藏）全部只写本地，不回写豆瓣。
 */

export interface DoubanGroup {
    /** 小组 slug（rexxar 的 group 参数，如 hangzhou、meishi） */
    id: string;
    /** 展示用中文名 */
    name: string;
}

/** 预置小组：2026-09-06 实测「今日有新帖」的活跃组。同城生活 + 吃喝玩乐向。 */
export const DEFAULT_DOUBAN_GROUPS: DoubanGroup[] = [
    { id: 'hangzhou', name: '杭州' },
    { id: 'shenzhen', name: '深圳' },
    { id: 'wuhan', name: '武汉' },
    { id: 'zufang', name: '租房' },
    { id: 'meishi', name: '美食' },
    { id: 'qinggan', name: '情感' },
    { id: 'movie', name: '电影' },
    { id: 'travel', name: '旅行' },
];

const GROUPS_LS_KEY = 'spark_douban_groups';
const HIDDEN_LS_KEY = 'spark_douban_hidden';

export function loadDoubanGroups(): DoubanGroup[] {
    try {
        const raw = localStorage.getItem(GROUPS_LS_KEY);
        if (!raw) return [...DEFAULT_DOUBAN_GROUPS];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [...DEFAULT_DOUBAN_GROUPS];
        const cleaned = parsed
            .filter((g: any) => g && typeof g.id === 'string' && typeof g.name === 'string')
            .map((g: any) => ({ id: g.id.trim(), name: g.name.trim() }))
            .filter((g: DoubanGroup) => g.id && g.name);
        return cleaned.length > 0 ? cleaned : [...DEFAULT_DOUBAN_GROUPS];
    } catch {
        return [...DEFAULT_DOUBAN_GROUPS];
    }
}

export function saveDoubanGroups(groups: DoubanGroup[]): void {
    try {
        localStorage.setItem(GROUPS_LS_KEY, JSON.stringify(groups));
    } catch { /* localStorage 不可用就当内存态用 */ }
}

/**
 * 解析用户输入的小组：接受 slug（hangzhou）、数字 id、或完整 URL
 * （https://www.douban.com/group/hangzhou/）。返回 slug，非法返回 null。
 */
export function parseDoubanGroupInput(input: string): string | null {
    const text = (input || '').trim();
    if (!text) return null;
    const urlMatch = text.match(/douban\.com\/group\/([A-Za-z0-9_-]+)/i);
    const slug = urlMatch ? urlMatch[1] : (/^[A-Za-z0-9_-]{1,64}$/.test(text) ? text : null);
    if (!slug) return null;
    // 纯数字 id 的小组主页形如 /group/12345/，rexxar 同样接受，直接透传
    return slug;
}

/** 用户在信息流删掉的豆瓣帖 id（sourceId），刷新时不再加回来。 */
export function loadHiddenDoubanIds(): Set<string> {
    try {
        const raw = localStorage.getItem(HIDDEN_LS_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        return new Set(Array.isArray(arr) ? arr.filter((x: any) => typeof x === 'string') : []);
    } catch {
        return new Set();
    }
}

export function addHiddenDoubanId(sourceId: string): void {
    try {
        const set = loadHiddenDoubanIds();
        set.add(sourceId);
        // 只保留最近 500 个，防无限膨胀
        const arr = [...set].slice(-500);
        localStorage.setItem(HIDDEN_LS_KEY, JSON.stringify(arr));
    } catch { /* ignore */ }
}

// --- 时间 / 文本 ---

/** 'YYYY-MM-DD HH:mm:ss(.ffffff)?' → 毫秒时间戳；解析失败回 0（沉底，绝不能冒充最新） */
export function parseDoubanTime(input: unknown): number {
    if (typeof input === 'string' && input.trim()) {
        const normalized = input.trim().replace(' ', 'T').replace(/(\.\d{3})\d+$/, '$1');
        const ms = Date.parse(normalized);
        if (Number.isFinite(ms)) return ms;
    }
    if (typeof input === 'number' && Number.isFinite(input)) {
        return input > 1e12 ? input : input * 1000;
    }
    return 0;
}

/** 详情正文可能是富文本/HTML，转纯文本展示 */
export function stripHtml(input: unknown): string {
    if (typeof input !== 'string') return '';
    return input
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|li|tr)>/gi, '\n')
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

// --- 图片代理（渲染时调用，不落库：worker 地址可换，库里只存豆瓣原链） ---

/** 是否豆瓣图床链接（需要走 /social/img 代理防盗链） */
export function isDoubanImageUrl(url: unknown): url is string {
    if (typeof url !== 'string' || !url) return false;
    try {
        const host = new URL(url).hostname.toLowerCase();
        return host === 'doubanio.com' || host.endsWith('.doubanio.com');
    } catch {
        return false;
    }
}

/** 豆瓣原链 → worker 图片代理地址；非豆瓣链接原样返回 */
export function doubanImgUrl(url: unknown): string {
    if (!isDoubanImageUrl(url)) return typeof url === 'string' ? url : '';
    try {
        return `${getProxyWorkerUrl()}/social/img?u=${encodeURIComponent(url)}`;
    } catch {
        return url;
    }
}

// --- worker 调用 ---

const DOUBAN_TIMEOUT_MS = 20000;

async function workerGet(path: string, params: Record<string, string>): Promise<any> {
    const base = getProxyWorkerUrl();
    const qs = new URLSearchParams(params).toString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DOUBAN_TIMEOUT_MS);
    try {
        const res = await fetch(`${base}${path}?${qs}`, { signal: controller.signal });
        const text = await res.text().catch(() => '');
        let json: any = null;
        try { json = text ? JSON.parse(text) : null; } catch { /* non-json */ }
        if (!res.ok) throw new Error((json && json.error) || `HTTP ${res.status}`);
        if (!json || json.success !== true) throw new Error((json && json.error) || '代理返回异常');
        return json.data;
    } finally {
        clearTimeout(timer);
    }
}

/** 拉一个小组的话题列表（start 分页，0 起），归一化成 SocialPost */
export async function fetchDoubanTopics(group: DoubanGroup, start = 0): Promise<SocialPost[]> {
    const data = await workerGet('/social/douban/topics', { group: group.id, start: String(start) });
    const topics = Array.isArray(data?.topics) ? data.topics : [];
    const hidden = loadHiddenDoubanIds();
    const posts: SocialPost[] = [];
    for (const t of topics) {
        const post = normalizeDoubanTopic(t, group);
        if (post && post.sourceId && !hidden.has(post.sourceId)) posts.push(post);
    }
    return posts;
}

/** 拉话题详情（正文/原图/点赞数），返回归一化后的增量字段 */
export async function fetchDoubanTopicDetail(sourceId: string): Promise<{
    content: string;
    images: string[];
    likes: number;
    commentsCount: number;
} | null> {
    const data = await workerGet('/social/douban/topic', { id: sourceId });
    if (!data || typeof data !== 'object') return null;
    const content = stripHtml((data as any).content || (data as any).abstract || '');
    const photos = Array.isArray((data as any).photos) ? (data as any).photos : [];
    const images = photos
        .map((p: any) => p?.image?.large?.url || p?.image?.normal?.url || p?.image?.raw?.url || '')
        .filter((u: any) => typeof u === 'string' && u)
        .slice(0, 9);
    // 封面兜底：无内图但有 cover_url 时用封面
    if (images.length === 0 && typeof (data as any).cover_url === 'string' && (data as any).cover_url) {
        images.push((data as any).cover_url);
    }
    return {
        content,
        images,
        likes: Number((data as any).like_count ?? (data as any).reactions_count ?? 0) || 0,
        commentsCount: Number((data as any).comments_count ?? 0) || 0,
    };
}

/** 拉话题评论（豆瓣真实评论）。端点形态未经长期验证，失败由调用方静默跳过。 */
export async function fetchDoubanComments(sourceId: string, start = 0): Promise<SocialComment[]> {
    const data = await workerGet('/social/douban/comments', { id: sourceId, start: String(start) });
    // 两层容错：comments / replies / list 任一数组形态都接受
    const raw = Array.isArray(data?.comments)
        ? data.comments
        : Array.isArray(data?.replies)
            ? data.replies
            : Array.isArray(data?.list)
                ? data.list
                : [];
    const comments: SocialComment[] = [];
    (raw as any[]).forEach((c: any, index: number) => {
        // 无服务端 id 时用索引兜底，保证同批拉取的 key 稳定、不抖动重排
        const comment = normalizeDoubanComment(c, index);
        if (comment) comments.push(comment);
    });
    return comments;
}

// --- 归一化 ---

export function normalizeDoubanTopic(topic: any, group: DoubanGroup): SocialPost | null {
    const tid = String(topic?.id ?? '').trim();
    const title = String(topic?.title ?? '').trim();
    if (!tid || !title) return null;
    const author = (topic?.author && typeof topic.author === 'object') ? topic.author : {};
    const photos = Array.isArray(topic?.photos) ? topic.photos : [];
    const images = photos
        .map((p: any) => p?.image?.normal?.url || p?.image?.large?.url || '')
        .filter((u: any) => typeof u === 'string' && u)
        .slice(0, 9);
    if (images.length === 0 && typeof topic?.cover_url === 'string' && topic.cover_url) {
        images.push(topic.cover_url);
    }
    return {
        id: `douban:${tid}`,
        origin: 'douban',
        sourceId: tid,
        sourceUrl: typeof topic?.url === 'string' && topic.url
            ? topic.url
            : `https://www.douban.com/group/topic/${tid}/`,
        groupTitle: group.name,
        groupId: group.id,
        authorName: String(author?.name || '豆友'),
        authorAvatar: typeof author?.avatar === 'string' ? author.avatar : '',
        title,
        content: stripHtml(topic?.abstract || ''),
        images,
        likes: Number(topic?.reactions_count ?? 0) || 0,
        isCollected: false,
        isLiked: false,
        comments: [],
        timestamp: parseDoubanTime(topic?.update_time || topic?.create_time),
        tags: [group.name],
        authorType: 'stranger',
    };
}

export function normalizeDoubanComment(raw: any, fallbackIndex = 0): SocialComment | null {
    if (!raw || typeof raw !== 'object') return null;
    const text = stripHtml(raw.text ?? raw.content ?? raw.raw ?? '');
    if (!text) return null;
    const author = (raw.author && typeof raw.author === 'object') ? raw.author : {};
    const authorName = String(author?.name ?? raw.author_name ?? raw.user_name ?? '豆友');
    return {
        id: `douban-cmt:${String(raw.id ?? `idx-${fallbackIndex}`)}`,
        authorName,
        authorAvatar: typeof (author?.avatar ?? raw.author_avatar) === 'string'
            ? (author?.avatar ?? raw.author_avatar)
            : '',
        content: text.slice(0, 500),
        likes: Number(raw.vote_count ?? raw.like_count ?? raw.likes ?? 0) || 0,
        authorType: 'stranger',
    };
}
