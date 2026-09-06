/**
 * imageGenTags — 聊天自动生图的标签解析纯函数。
 *
 * 模型在回复里写 `[[GEN_IMAGE: 英文 tag, ... | portrait|landscape|square]]`，
 * 这里负责：解析 / 从正文剥离 / 把 @角色名 替换成外貌档案。
 * 无副作用，可单测；真正的网络调用在 latentImageGen.ts。
 */

export type ImageGenResolution = 'square' | 'portrait' | 'landscape';

export interface GenImageRequest {
    /** 清理过的英文 tag 串（已压成单行）。 */
    prompt: string;
    resolution: ImageGenResolution;
}

export const DEFAULT_IMAGE_GEN_RESOLUTION: ImageGenResolution = 'portrait';

const TAG_RE = /\[\[GEN_IMAGE\s*:\s*([\s\S]*?)\]\]/gi;

const RESOLUTION_ALIASES: Record<string, ImageGenResolution> = {
    square: 'square',
    portrait: 'portrait',
    landscape: 'landscape',
    '方': 'square',
    '竖': 'portrait',
    '横': 'landscape',
};

function normalizeResolution(token: string | undefined): ImageGenResolution | null {
    if (!token) return null;
    return RESOLUTION_ALIASES[token.trim().toLowerCase()] ?? null;
}

function cleanPrompt(raw: string): string {
    return raw.replace(/\s+/g, ' ').trim();
}

/**
 * 从回复文本里抽出所有 GEN_IMAGE 请求。
 * - `|` 最后一个分段若是已知的分辨率词才算分辨率，否则整个 body 都是 prompt。
 * - 空 prompt 的标签直接丢弃。
 */
export function extractGenImageTags(text: string): GenImageRequest[] {
    if (!text || !/gen_image/i.test(text)) return [];
    const out: GenImageRequest[] = [];
    // 每次调用重置 lastIndex（TAG_RE 是全局正则）。
    TAG_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TAG_RE.exec(text)) !== null) {
        const body = (m[1] || '').trim();
        if (!body) continue;
        const parts = body.split('|');
        let resolution: ImageGenResolution | null = null;
        let promptRaw = body;
        if (parts.length > 1) {
            const maybeRes = normalizeResolution(parts[parts.length - 1]);
            if (maybeRes) {
                resolution = maybeRes;
                promptRaw = parts.slice(0, -1).join('|');
            }
        }
        const prompt = cleanPrompt(promptRaw);
        if (!prompt) continue;
        out.push({ prompt, resolution: resolution ?? DEFAULT_IMAGE_GEN_RESOLUTION });
    }
    return out;
}

/** 把所有 GEN_IMAGE 标签从正文里剥掉（落库前调用），保留周围文字。 */
export function stripGenImageTags(text: string): string {
    if (!text || !/gen_image/i.test(text)) return text;
    TAG_RE.lastIndex = 0;
    return text
        .replace(TAG_RE, '')
        .split('\n')
        .map(line => line.trimEnd())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

export interface AppearanceProfile {
    /** 名字 + 昵称/爱称，任一命中即替换。 */
    names: string[];
    /** 英文外貌 tag 串。 */
    tags: string;
}

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 把 prompt 里的 @角色名 机械替换成档案里的外貌 tag（柏宝绘式防漂移）。
 * - 长名字优先，避免「小白」吃掉「小白脸」的前缀。
 * - 档案里没建档的名字原样保留。
 */
export function resolveAppearanceRefs(prompt: string, profiles: AppearanceProfile[]): string {
    if (!prompt || !prompt.includes('@') || profiles.length === 0) return prompt;
    const entries: Array<{ name: string; tags: string }> = [];
    for (const p of profiles) {
        const tags = (p.tags || '').trim();
        if (!tags) continue;
        for (const n of p.names || []) {
            const name = (n || '').trim();
            if (name) entries.push({ name, tags });
        }
    }
    entries.sort((a, b) => b.name.length - a.name.length);
    let out = prompt;
    for (const { name, tags } of entries) {
        out = out.replace(new RegExp(`@${escapeRegExp(name)}(?![\\w])`, 'g'), tags);
    }
    return out;
}
