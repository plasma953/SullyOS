/**
 * 鱼声 Fish Audio TTS 工具 —— MiniMax 的平行实现，供聊天 / 约会 / 电话二选一复用。
 *
 * 与 MiniMax 的关键差异：
 *  1. 鱼声直接返回二进制音频（mp3），不是 JSON 里塞 hex；
 *  2. 选音色用 reference_id（voiceProfile.fishReferenceId），不是 MiniMax 的 voice_id；
 *  3. 模型走 `model` 请求头（s2.1-pro / s2-pro / s1）；
 *  4. 没有 MiniMax 的 <#秒#> 停顿标记 —— 那套标记鱼声不认、会被原样念出来，
 *     所以这里绝不 insertSpeechBreaks，还要把混进来的 <#x#> 清掉做兜底。
 *  5. 情绪用方括号 cue（[happy] 等），这里把上层传来的 emotion 前置成一个方括号标签。
 *
 * 文本清洗 / <语音> 标签解析仍复用 minimaxTts 的那套（与服务商无关）。
 */
import { CharacterProfile, APIConfig } from '../types';
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { hashTtsParams, getCachedTts, saveCachedTts } from './ttsCache';
import { normalizeApiKey } from './minimaxApiKey';
import { getProxyWorkerUrl } from './proxyWorker';
import type { TtsResult } from './minimaxTts';
import { isStaticWebDeployment } from './staticWebDeployment';

const FISH_PROXY_PATH = '/api/fishaudio/tts';
const FISH_UPSTREAM = 'https://api.fish.audio/v1/tts';
const DEFAULT_FISH_MODEL = 's2.1-pro';
// 鱼声语音指南原文已迁入提示词目录（utils/promptPresetCatalog）。保留旧导出名作别名。
import { getBuiltinContent } from './promptPresetCatalog';
export const FISH_VOICE_ACTING_GUIDE = getBuiltinContent('voice.fish');

// 鱼声方括号 cue：单层 [..]（区别于系统标记 [[..]]），内容 1–40 字符。
const FISH_BRACKET_CUE_RE = /\[[^\[\]]{1,40}\]/g;

// ⚠️ Fish 实际可靠生效的标签就这一小撮（来自 app UI 调色板）。其它自然语言标签
// （[smug]/[teasing]/[curious]… 这种）S2.1 大多弱响应甚至忽略 → 听起来像没打标签、平。
// 所以一律把 cue 归一到这个支持集，映射不到的丢弃。
const FISH_SUPPORTED_CUES = new Set([
  // 情感语调
  'angry', 'sad', 'embarrassed', 'emphasis', 'whispering', 'soft', 'breathy', 'excited',
  // 音效
  'laughing', 'chuckling', 'moaning', 'clear throat', 'sobbing', 'crying loudly',
  'sighing', 'panting', 'groaning', 'crowd laughing', 'background laughter', 'audience laughing',
  // 停顿
  'pause', 'long pause',
]);

// 把模型可能写出的各种 cue（同义词 / MiniMax 习惯 / 自造词 / 圆括号声音标签）映射到支持集。
const FISH_CUE_SYNONYMS: Record<string, string> = {
  // 停顿（含 MiniMax/旧版写法）
  'break': 'pause', 'short pause': 'pause',
  'long-break': 'long pause', 'longbreak': 'long pause', 'long break': 'long pause',
  // 正面情绪 → 官方正面只有 excited
  happy: 'excited', joyful: 'excited', delighted: 'excited', cheerful: 'excited', glad: 'excited',
  smug: 'excited', proud: 'excited', gleeful: 'excited', playful: 'excited', teasing: 'excited',
  confident: 'excited', surprised: 'excited', amazed: 'excited', curious: 'excited', hopeful: 'excited',
  enthusiastic: 'excited', eager: 'excited',
  // 生气/烦躁
  annoyed: 'angry', irritated: 'angry', frustrated: 'angry', mad: 'angry', furious: 'angry', grumpy: 'angry',
  // 难过/失落/撒娇示弱
  unhappy: 'sad', disappointed: 'sad', hurt: 'sad', depressed: 'sad', pleading: 'sad', sulking: 'sad', lonely: 'sad', regretful: 'sad',
  // 害羞/尴尬
  shy: 'embarrassed', bashful: 'embarrassed', awkward: 'embarrassed', flustered: 'embarrassed',
  // 轻柔/温柔/疲惫/平静 → soft
  'soft tone': 'soft', gentle: 'soft', tender: 'soft', warm: 'soft', calm: 'soft', soothing: 'soft',
  tired: 'soft', sleepy: 'soft', relaxed: 'soft', sincere: 'soft',
  // 气声/紧张/害怕 → breathy
  nervous: 'breathy', anxious: 'breathy', scared: 'breathy', fearful: 'breathy', worried: 'breathy', timid: 'breathy',
  // 悄悄话
  whisper: 'whispering', hushed: 'whispering', murmuring: 'whispering',
  // 强调
  emphatic: 'emphasis', stressing: 'emphasis',
  // 音效
  laugh: 'laughing', laughs: 'laughing',
  giggle: 'chuckling', giggling: 'chuckling', giggles: 'chuckling', chuckle: 'chuckling', chuckles: 'chuckling',
  sigh: 'sighing', sighs: 'sighing',
  sob: 'sobbing', sobs: 'sobbing', crying: 'crying loudly', cry: 'crying loudly',
  groan: 'groaning', groans: 'groaning',
  pant: 'panting', pants: 'panting', gasp: 'panting', gasps: 'panting', gasping: 'panting', 'out of breath': 'panting',
  moan: 'moaning', moans: 'moaning',
  'clears throat': 'clear throat', ahem: 'clear throat', cough: 'clear throat', coughs: 'clear throat',
};

/**
 * 把任意 cue 文本归一到 Fish 支持的标签。映射不到返回 ''（应丢弃）。
 * 顺序：精确支持集 → 精确同义词 → 自然语言短语包含匹配（"very excited"→excited、
 * "gentle and warm"→soft、"laughing nervously"→laughing）。
 */
const normalizeFishCue = (inner: string): string => {
  const key = (inner || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!key) return '';
  if (FISH_SUPPORTED_CUES.has(key)) return key;
  if (FISH_CUE_SYNONYMS[key]) return FISH_CUE_SYNONYMS[key];
  for (const [syn, canon] of Object.entries(FISH_CUE_SYNONYMS)) {
    if (key.includes(syn)) return canon;
  }
  for (const canon of FISH_SUPPORTED_CUES) {
    if (key.includes(canon)) return canon;
  }
  return '';
};

/** emotion 属性兜底映射（→ 支持集）。 */
const FISH_EMOTION_MAP: Record<string, string> = {
  happy: 'excited',
  sad: 'sad',
  angry: 'angry',
  fearful: 'breathy',
  disgusted: 'angry',
  surprised: 'excited',
  calm: 'soft',
};

const FISH_VOICE_TAG_RE = /<[语語]音[^>]*>([\s\S]*?)<\/[语語]音>/;

/**
 * 鱼声专用文本清洗（区别于 MiniMax 的 cleanTextForTts）：
 * 关键差异 —— **保留**英文方括号 cue（[happy]/[whispering]…）原样送进 API。
 * 但要清掉「会被鱼声念出来」的脏东西：
 *  - 系统标记 [[..]]、双语分隔、中文舞台指示（…）、MiniMax <#秒#>；
 *  - **把所有 cue 归一到 Fish 实际支持的标签**（圆括号声音标签转方括号、自造/同义词
 *    映射到支持集、映射不到的丢弃），避免写了无效标签等于没打、或被原样念出来。
 */
export const cleanTextForTtsFish = (raw: string): string => {
  if (!raw) return '';
  const tagMatch = raw.match(FISH_VOICE_TAG_RE);
  let text = tagMatch ? tagMatch[1] : raw;
  text = text
    .replace(/\[\[.*?\]\]/g, '')                 // [[系统标记]]（双层，先于单层 cue 处理）
    .replace(/%%BILINGUAL%%[\s\S]*/i, '')        // 双语分隔及之后
    .replace(/（[^）]{0,48}）/g, '')              // 中文圆括号舞台指示，一律删
    .replace(/<#\s*[\d.]+\s*#>/g, '')            // MiniMax 停顿标记，鱼声不认
    // 西文圆括号（模型按 MiniMax 习惯写的 (laughs)/(sighs) 等）→ 先转成方括号，交给下面归一
    .replace(/\(([^)]{1,40})\)/g, '[$1]')
    // 换行写死成停顿：段落空行 → 长停，普通换行 → 短停（用 Fish 官方的 pause/long pause）
    .replace(/\n{2,}/g, ' [long pause] ')
    .replace(/\n+/g, ' [pause] ')
    // 归一：每个方括号 cue → Fish 实际支持的标签；映射不到的（含中文、自造词、舞台指示）丢弃
    .replace(/\[([^\[\]]{1,40})\]/g, (_m, inner: string) => {
      const canon = normalizeFishCue(inner);
      return canon ? `[${canon}]` : '';
    })
    .replace(/\s+/g, ' ')
    .trim();
  // 把挤在一起的多个 cue 压到最多 2 个：换行停顿 [long pause] 常撞上模型句界写的
  // [sighing][confident]，叠成 3+ 会突兀/鬼畜。保留一个停顿 + 一个情绪即可。
  text = collapseAdjacentCues(text);
  return text;
};

/**
 * 合并相邻 cue：连写的 [a][b][c]（中间只有空格）压到最多 2 个。
 * 规则：先去相邻重复；≤2 个原样保留（[sad][whispering] 这种合法叠加不动）；
 * 3+ 时——有停顿 cue 就留「停顿 + 最后一个情绪」，没有就留前两个情绪。
 */
const collapseAdjacentCues = (s: string): string =>
  s.replace(/\[[^\]]+\](?:\s*\[[^\]]+\])+/g, (run) => {
    const cues = run.match(/\[[^\]]+\]/g) || [];
    const dedup = cues.filter((c, i) => i === 0 || c.toLowerCase() !== cues[i - 1].toLowerCase());
    if (dedup.length <= 2) return dedup.join(' ');
    const isPause = (c: string) => /^\[(pause|long pause)\]$/i.test(c);
    const pause = dedup.find(c => /^\[long pause\]$/i.test(c)) || dedup.find(isPause);
    const emotions = dedup.filter(c => !isPause(c));
    if (pause) return emotions.length ? `${pause} ${emotions[emotions.length - 1]}` : pause;
    return `${emotions[0]} ${emotions[1]}`;
  });

/**
 * 把鱼声演出标记从「要显示给用户」的文本里清掉：方括号 cue + 鱼声圆括号特效。
 * 用于聊天气泡 / 转文字面板，免得用户看到一堆 [whispering]、(break)。
 */
export const stripFishMarkupForDisplay = (text?: string | null): string => {
  if (!text) return '';
  return text
    .replace(FISH_BRACKET_CUE_RE, '')
    // 圆括号里若是声音标签（(laughs)/(sighs) 等映射得到支持 cue）→ 演出指令，删；否则是正常括注，保留
    .replace(/\(([^)]{1,40})\)/g, (m, inner: string) => (normalizeFishCue(inner) ? '' : m))
    .replace(/<#\s*[\d.]+\s*#>/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([，。！？、；：,.!?…])/g, '$1')
    .trim();
};

/**
 * 精准版显示清洗：只删「被识别为 cue 的」方括号/圆括号（[excited]/[pause]/[smug]/(laughs) 等
 * —— 凡 normalizeFishCue 认得的都算），普通括注（[重要]/[TODO]/(顺便) 等）原样保留。
 * 因为只删可识别的 cue 词，可**安全地无差别用于任意显示文本**（聊天气泡 / 转文字 / 翻译），
 * 不挑服务商，也不会误伤用户自己打的括号内容。
 */
export const stripFishCuesForDisplay = (text?: string | null): string => {
  if (!text) return '';
  return text
    .replace(/\[([^\[\]]{1,40})\]/g, (m, inner: string) => (normalizeFishCue(inner) ? '' : m))
    .replace(/\(([^)]{1,40})\)/g, (m, inner: string) => (normalizeFishCue(inner) ? '' : m))
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([，。！？、；：,.!?…])/g, '$1')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .trim();
};

/** 解析 apiConfig 里的鱼声 Key（独立 Key，不复用通用 apiKey —— 那是 LLM 的）。 */
export const resolveFishAudioApiKey = (apiConfig: APIConfig): string =>
  normalizeApiKey(apiConfig.fishAudioApiKey || '');

/**
 * 归一化鱼声音色 id（reference_id）。容忍用户直接粘 fish.audio 网页链接：
 *   https://fish.audio/app/text-to-speech/?modelId=98655a12fa944e26b274c535e5e03842
 * 也容忍只粘 id 本身。reference_id 是 32 位十六进制（UUID 去横线）。
 */
export const normalizeFishReferenceId = (raw?: string | null): string => {
  const s = (raw || '').trim();
  if (!s) return '';
  // 1) URL 里的 ?modelId=... / &modelId=...
  const byQuery = s.match(/[?&]modelId=([a-z0-9]+)/i);
  if (byQuery) return byQuery[1];
  // 2) 任意位置的 32 位十六进制串（覆盖纯 id 和路径形式）
  const byHex = s.match(/[a-f0-9]{32}/i);
  if (byHex) return byHex[0];
  // 3) 兜底：去掉可能的查询串/空白
  return s.split(/[?#\s]/)[0];
};

/** 该角色能否用鱼声合成（必须有 Key + reference_id）。 */
export const canSynthesizeFish = (char: CharacterProfile, apiConfig: APIConfig): boolean =>
  !!resolveFishAudioApiKey(apiConfig) && !!normalizeFishReferenceId(char.voiceProfile?.fishReferenceId);

const isNative = (): boolean => {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
};

const shouldBypassWebProxy = (): boolean => {
  if (typeof window === 'undefined') return false;
  return isStaticWebDeployment(window.location.protocol, window.location.hostname);
};

/** base64 → Blob（CapacitorHttp 二进制响应是 base64 字符串）。 */
const base64ToBlob = (b64: string, mime = 'audio/mpeg'): Blob => {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
};

/**
 * 调鱼声 /v1/tts，拿回音频 Blob。
 * web：默认走 /api/fishaudio/tts 代理；静态预览（github.io / file:）直连上游兜底。
 * native：CapacitorHttp 直连上游，responseType='blob' 绕过浏览器 CORS。
 */
const fishFetchAudio = async (
  payload: any,
  apiKey: string,
  model: string,
): Promise<Blob> => {
  const jsonHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    model,
  };

  if (isNative()) {
    const response = await CapacitorHttp.request({
      url: FISH_UPSTREAM,
      method: 'POST',
      headers: jsonHeaders,
      data: payload,
      responseType: 'blob',
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`鱼声 TTS 失败 (HTTP ${response.status})`);
    }
    // CapacitorHttp blob 响应：data 是 base64 字符串
    return base64ToBlob(String(response.data || ''));
  }

  // 静态部署（github.io / file:）没有 /api serverless 代理，直连 api.fish.audio 会被浏览器
  // CORS 挡（Fish 不发 ACAO 头）。走项目通用 sfworker 代理 /fishaudio/tts（带 CORS 头）。
  // model 放 query，避免自定义 model 头触发预检失败；只留 Authorization（worker 已允许）。
  let url: string;
  let headers: Record<string, string>;
  if (shouldBypassWebProxy()) {
    url = `${getProxyWorkerUrl()}/fishaudio/tts?model=${encodeURIComponent(model)}`;
    headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
  } else {
    url = FISH_PROXY_PATH;
    headers = jsonHeaders;
  }
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.text()).slice(0, 200); } catch { /* ignore */ }
    throw new Error(`鱼声 TTS 失败 (HTTP ${res.status})${detail ? `：${detail}` : ''}`);
  }
  const blob = await res.blob();
  if (!blob.size) throw new Error('鱼声 TTS 返回空音频');
  return blob;
};

/**
 * 调鱼声 TTS，返回可播放 URL + 原始 blob（可写 IndexedDB 持久化）。
 * 与 minimaxTts.synthesizeSpeechDetailed 同签名，方便 ttsRouter 透明切换。
 */
export async function synthesizeSpeechFishDetailed(
  text: string,
  char: CharacterProfile,
  apiConfig: APIConfig,
  options?: { languageBoost?: string; groupId?: string; emotion?: string },
): Promise<TtsResult> {
  const apiKey = resolveFishAudioApiKey(apiConfig);
  if (!apiKey) throw new Error('缺少鱼声 Fish Audio API Key');
  const vp = char.voiceProfile;
  const referenceId = normalizeFishReferenceId(vp?.fishReferenceId);
  if (!referenceId) throw new Error('角色未配置鱼声音色（reference_id）');

  const model = (vp?.fishModel || apiConfig.fishAudioModel || DEFAULT_FISH_MODEL).trim() || DEFAULT_FISH_MODEL;

  // Fish-aware 清洗：保留方括号 cue / 圆括号特效，只清系统标记和 MiniMax 残留。
  let spoken = cleanTextForTtsFish(text);
  // 兜底：上层传了整条 emotion 属性、且正文没有任何「情绪/语气」cue 时，前置一个 cue。
  // 注意只看情绪类 cue，[break]/[long-break] 这类停顿不算（否则换行插的停顿会顶掉兜底）。
  const emotionCues = (spoken.match(/\[([^\]]+)\]/g) || [])
    .filter(c => !/^\[(pause|long pause)\]$/i.test(c.trim()));
  const hasInlineCue = emotionCues.length > 0;
  const fishEmotion = options?.emotion ? FISH_EMOTION_MAP[options.emotion.toLowerCase()] : undefined;
  if (fishEmotion && !hasInlineCue) spoken = `[${fishEmotion}] ${spoken}`;
  if (!spoken) throw new Error('鱼声 TTS 文本为空');

  // F12 调试：打印 LLM 带标签原文 + 实际送鱼声的文本，方便排查「标签被念出来」之类问题。
  console.log('[fishaudio] TTS', {
    model,
    reference_id: referenceId,
    emotion_attr: options?.emotion || '',
    raw_llm_text: text,        // LLM 输出的带标签原文
    sent_to_fish: spoken,      // 清洗后真正发给鱼声的文本
  });

  const payload: any = {
    text: spoken,
    reference_id: referenceId,
    format: 'mp3',
    // 展开数字/日期为自然读法，长文本更稳。
    normalize: true,
  };
  // 语速：角色配了就用角色的；没配则默认 0.9（比 1.0 慢一档）——鱼声默认读得偏赶，
  // 尤其外语长段落容易"一口气念完"，稍微放慢更像真人说话、段落停顿也更听得出。
  const speed = (typeof vp?.speed === 'number' && vp.speed > 0) ? vp.speed : 0.9;
  payload.prosody = { speed: Math.max(0.5, Math.min(2, speed)) };

  const cacheKey = hashTtsParams({
    kind: 'fishaudio-tts',
    text: payload.text,
    model,
    reference_id: payload.reference_id,
    format: payload.format,
    prosody: payload.prosody,
  });
  const cached = await getCachedTts(cacheKey);
  if (cached) {
    return { url: URL.createObjectURL(cached), blob: cached };
  }

  const blob = await fishFetchAudio(payload, apiKey, model);
  saveCachedTts(cacheKey, blob).catch(() => { /* ignore */ });
  return { url: URL.createObjectURL(blob), blob };
}

/** 薄封装：只要可播放 URL 时用。 */
export async function synthesizeSpeechFish(
  text: string,
  char: CharacterProfile,
  apiConfig: APIConfig,
  options?: { languageBoost?: string; groupId?: string; emotion?: string },
): Promise<string> {
  const { url } = await synthesizeSpeechFishDetailed(text, char, apiConfig, options);
  return url;
}
