/**
 * imageGenFlow — 聊天生图的编排层（内联标签 / 手动按钮共用）。
 *
 * runImageGenReply(req, deps)：fire-and-forget，由调用方 `void` 调用——文字消息
 * 先落库，这里的长耗时（LLM 提取档案 + 排队生图 + 轮询）绝不阻塞聊天。
 * 函数自己吞掉所有异常转 toast，永不 throw。
 *
 * 链路：
 *   1. 外貌档案 ensure（说话角色 + prompt 里 @ 到的已知角色，首次自动从人设提取）
 *   2. resolveAppearanceRefs 替换 @名字
 *   3. queueLatentGeneration 串行生图
 *   4. putImageBlob → blobref 令牌
 *   5. DB.saveMessage(type:'image') + saveGalleryImage（照用户发图入库模板）
 *   6. announceChatGen(replyArrived) → 开着该会话的 Chat 自动 reload，不在则补未读
 */

import type { APIConfig, CharacterProfile, Message, UserProfile } from '../types';
import { DB } from './db';
import { putImageBlob } from './blobRef';
import {
    resolveAppearanceRefs,
    type AppearanceProfile,
    type GenImageRequest,
} from './imageGenTags';
import {
    queueLatentGeneration,
    type LatentFetch,
} from './latentImageGen';
import { announceChatGen, CHAT_GEN_EVENTS } from './chatGenEvents';
import { getLocalDateKey } from './localDate';

export interface ImageGenMeta {
    prompt: string;
    resolution: string;
    seed: number;
    artworkId: string;
}

export interface ImageGenFlowDeps {
    apiConfig: APIConfig;
    char: CharacterProfile;
    userProfile: UserProfile;
    /** 外貌档案来源（含说话角色；@ 到的别角色也从这里匹配）。 */
    characters: CharacterProfile[];
    /** 近历史（相册 chatContext 用，可为空）。 */
    contextMsgs: Message[];
    hooks: {
        addToast: (msg: string, type: 'info' | 'success' | 'error') => void;
    };
    /** 档案自动提取后回写（调用方接 updateCharacter）。 */
    saveCharProfile: (charId: string, profile: string) => void;
    /** 单测注入；缺省全局 fetch。 */
    fetchImpl?: LatentFetch;
}

// SD 系默认负面词：latent.moe 不套站点默认，不给就等于没有。
const DEFAULT_NEGATIVE_PROMPT = 'lowres, blurry, watermark, text, deformed, worst quality';

/** 外貌档案提取 LLM 的 system prompt（小调用，temperature 低）。 */
const PROFILE_EXTRACT_SYS = `你是角色外貌档案员。从【人设】里提取这个角色固定的外貌特征，输出一行英文 danbooru 风格 tag，逗号分隔，8-20 个 tag。
只写长相：发色、瞳色、发型、耳朵/尾巴等兽耳特征、体型、常穿的标志性服装。不要写性格、年龄数字、背景故事。
直接输出 tag 串本身，不要解释、不要引号、不要 Markdown。
例：cat girl, silver long hair, green eyes, cat ears, slender, black choker, school uniform`;

function cleanTagLine(raw: string): string {
    return (raw || '')
        .replace(/^[\s`"'']+|[\s`"'']+$/g, '')
        .replace(/^(tags?|输出)\s*[:：]\s*/i, '')
        .replace(/\n[\s\S]*$/, '')
        .trim()
        .slice(0, 500);
}

// 会话内 guard：提取中 / 提取失败过的本轮不再重试（省调用）。
const extractingProfiles = new Set<string>();
const extractFailedProfiles = new Set<string>();

async function extractAppearanceViaLLM(
    char: CharacterProfile,
    apiConfig: APIConfig,
    fetchImpl?: LatentFetch,
): Promise<string> {
    const baseUrl = (apiConfig.baseUrl || '').replace(/\/+$/, '');
    const { apiKey, model } = apiConfig;
    if (!baseUrl || !apiKey || !model) return '';
    const fetchFn: LatentFetch = fetchImpl ?? (fetch as unknown as LatentFetch);
    const persona = [char.systemPrompt, (char as any).writerPersona, (char as any).worldview]
        .filter(s => typeof s === 'string' && s.trim())
        .join('\n\n');
    const res = await fetchFn(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
            model,
            messages: [
                { role: 'system', content: PROFILE_EXTRACT_SYS },
                { role: 'user', content: `【角色名】${char.name}\n\n【人设】\n${persona || '(人设为空，按名字直觉给一套通用的)'}` },
            ],
            temperature: 0.2,
            max_tokens: 300,
        }),
    });
    if (!res.ok) return '';
    let data: any = null;
    try {
        data = await res.json();
    } catch {
        return '';
    }
    return cleanTagLine(data?.choices?.[0]?.message?.content || '');
}

async function ensureAppearanceProfile(
    char: CharacterProfile,
    deps: ImageGenFlowDeps,
): Promise<string> {
    const cur = ((char as any).imageGenProfile || '').trim();
    if (cur) return cur;
    if (extractingProfiles.has(char.id) || extractFailedProfiles.has(char.id)) return '';
    extractingProfiles.add(char.id);
    try {
        const tags = await extractAppearanceViaLLM(char, deps.apiConfig, deps.fetchImpl);
        if (tags) {
            (char as any).imageGenProfile = tags;
            try {
                deps.saveCharProfile(char.id, tags);
            } catch { /* 存档失败不阻断本次生图 */ }
            return tags;
        }
        extractFailedProfiles.add(char.id);
        return '';
    } catch {
        extractFailedProfiles.add(char.id);
        return '';
    } finally {
        extractingProfiles.delete(char.id);
    }
}

function findCharByName(name: string, characters: CharacterProfile[]): CharacterProfile | null {
    const key = name.trim().toLowerCase();
    if (!key) return null;
    return characters.find(c => (c.name || '').trim().toLowerCase() === key) ?? null;
}

/**
 * prompt 里 @ 到的已知角色（+ 说话角色自己），ensure 档案后组装替换表。
 * ensure 上限 3 个，防病态 prompt 刷调用。
 */
async function collectAppearanceProfiles(
    rawPrompt: string,
    deps: ImageGenFlowDeps,
): Promise<AppearanceProfile[]> {
    const wanted = new Map<string, CharacterProfile>();
    wanted.set(deps.char.id, deps.char);
    const atRe = /@([^@\s,，、。！？!?.|\]]+)/g;
    let m: RegExpExecArray | null;
    while ((m = atRe.exec(rawPrompt)) !== null) {
        const hit = findCharByName(m[1], deps.characters);
        if (hit && !wanted.has(hit.id) && wanted.size < 4) wanted.set(hit.id, hit);
    }
    const out: AppearanceProfile[] = [];
    let ensured = 0;
    for (const c of wanted.values()) {
        let tags = ((c as any).imageGenProfile || '').trim();
        if (!tags && ensured < 3) {
            ensured++;
            tags = await ensureAppearanceProfile(c, deps);
        }
        if (tags) out.push({ names: [c.name], tags });
    }
    return out;
}

function buildGalleryChatContext(char: CharacterProfile, userName: string, contextMsgs: Message[]): string[] | undefined {
    if (!contextMsgs || contextMsgs.length === 0) return undefined;
    return contextMsgs.slice(-10).map(m => {
        const sender = m.role === 'user' ? userName : char.name;
        const isMedia = m.type === 'image' || m.type === 'emoji';
        const preview = isMedia ? '[图片]' : String(m.content || '').substring(0, 100);
        return `${sender}: ${preview}`;
    });
}

/**
 * 执行一次生图并落库。调用方 fire-and-forget；永不 throw，失败走 toast。
 */
export async function runImageGenReply(req: GenImageRequest, deps: ImageGenFlowDeps): Promise<void> {
    const { char, apiConfig, hooks } = deps;
    try {
        const apiKey = (apiConfig.latentImageKey || '').trim();
        if (!apiKey) {
            hooks.addToast('生图缺 Key：去「设置 → AI 生图」填 Latent API Key', 'error');
            return;
        }

        const profiles = await collectAppearanceProfiles(req.prompt, deps);
        const prompt = resolveAppearanceRefs(req.prompt, profiles);

        const res = await queueLatentGeneration({
            apiKey,
            prompt,
            negativePrompt: DEFAULT_NEGATIVE_PROMPT,
            resolution: req.resolution,
            fetchImpl: deps.fetchImpl,
        });

        const token = await putImageBlob(res.blob);

        const meta: ImageGenMeta = {
            prompt,
            resolution: req.resolution,
            seed: res.seed,
            artworkId: res.artworkId,
        };
        const savedId = await DB.saveMessage({
            charId: char.id,
            role: 'assistant',
            type: 'image',
            content: token,
            metadata: { imageGen: meta },
        } as any);

        // 相册附带记录：跟用户发图同一模板（Chat.tsx），失败不阻断消息。
        try {
            await DB.saveGalleryImage({
                id: `img-${Date.now()}-${Math.random()}`,
                charId: char.id,
                url: token,
                timestamp: Date.now(),
                sourceMessageId: savedId,
                savedDate: getLocalDateKey(),
                chatContext: buildGalleryChatContext(char, deps.userProfile?.name || '我', deps.contextMsgs),
            });
        } catch (err) {
            console.warn('[imageGen] 图片存相册失败，消息照常保留', err);
            hooks.addToast('图片没能存进相册，消息照常保留', 'error');
        }

        // 开着该会话的 Chat 自动 reload；不在则由 Chat 自己的监听补未读/toast。
        announceChatGen(CHAT_GEN_EVENTS.replyArrived, { charId: char.id, charName: char.name });
    } catch (e: any) {
        if (e?.name === 'AbortError') return;
        console.warn('[imageGen] 生图失败', e);
        hooks.addToast(`生图失败：${e?.message || '未知错误'}`, 'error');
    }
}

const TAG_SUGGEST_SYS = `你是分镜师。把【聊天场景】浓缩成一行英文 danbooru 风格生图 tag，逗号分隔，8-20 个 tag。
画面主体、人物外貌关键词、动作、场景、光线、氛围都要有；人物用 @名字 指代（如 @小苏），不要自己编外貌。
直接输出 tag 串本身，不要解释、不要引号、不要 Markdown。`;

function checkLlmReady(apiConfig: APIConfig): string {
    const baseUrl = (apiConfig?.baseUrl || '').replace(/\/+$/, '');
    if (!baseUrl || !apiConfig?.apiKey || !apiConfig?.model) {
        throw new Error('请先在「设置」里配置 LLM API（baseUrl + key + model）');
    }
    return baseUrl;
}

/**
 * 手动生图：按楼层场景让 LLM 写一组 tag（用户可在弹窗里改）。
 * 返回清理过的一行 tag。抛出的 Error message 可直接 toast。
 */
export async function suggestImageTags(
    scene: string,
    char: CharacterProfile,
    apiConfig: APIConfig,
    fetchImpl?: LatentFetch,
): Promise<string> {
    const baseUrl = checkLlmReady(apiConfig);
    const fetchFn: LatentFetch = fetchImpl ?? (fetch as unknown as LatentFetch);
    const res = await fetchFn(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
        body: JSON.stringify({
            model: apiConfig.model,
            messages: [
                { role: 'system', content: TAG_SUGGEST_SYS },
                { role: 'user', content: `【角色】${char.name}\n\n【聊天场景】\n${scene.slice(0, 2000)}` },
            ],
            temperature: 0.7,
            max_tokens: 500,
        }),
    });
    if (!res.ok) throw new Error(`写 tag 失败 (HTTP ${res.status})`);
    let data: any = null;
    try {
        data = await res.json();
    } catch {
        throw new Error('写 tag 返回非 JSON');
    }
    const tags = cleanTagLine(data?.choices?.[0]?.message?.content || '');
    if (!tags) throw new Error('LLM 没写出 tag，换个说法重试');
    return tags;
}
