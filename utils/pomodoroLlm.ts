/**
 * Pomodoro companion LLM calls (pure-LLM per confirmed design).
 *
 * Three text kinds, all generated live from the companion char:
 *   1. encouragement — short cheer while focusing (App-local bubble only)
 *   2. punishment   — SFW or NSFW, decided by the char from persona/rapport
 *   3. report reply — char's chat response after a completed/accepted run
 *
 * Transport mirrors CallApp: direct safeFetchJson POST to
 * `${apiConfig.baseUrl}/chat/completions`. Any failure throws — the caller
 * swallows it and that round simply has no line (no fallback library).
 */

import type { CharacterProfile, UserProfile } from '../types';
import { ContextBuilder } from './context';
import { safeFetchJson, extractContent } from './safeApi';
import { elapsedMs, remainingMs } from './pomodoroSession';
import type { PomodoroSession } from './pomodoroSession';

export interface PomodoroLlmApi {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
}

export type PomodoroPunishReason = 'quit' | 'away';
export type PomodoroReportOutcome = 'completed' | 'punished';

const minOf = (ms: number): string => {
  const m = ms / 60000;
  return Number.isInteger(m) ? `${m}` : m.toFixed(1);
};

const apiMeta = (charId?: string, charName?: string, purpose?: string) => ({
  appName: '番茄钟',
  charId,
  charName,
  purpose: purpose || '番茄钟陪伴',
});

const coreOf = (char: CharacterProfile, user: UserProfile): string => {
  try {
    return ContextBuilder.buildCoreContext(char, user, false);
  } catch {
    return `你是${char.name}。`; 
  }
};

export interface PomodoroLlmMessages {
  system: string;
  user: string;
}

export const buildEncouragementMessages = (
  char: CharacterProfile,
  user: UserProfile,
  session: Pick<PomodoroSession, 'topic'> & { elapsedMs: number; remainingMs: number },
): PomodoroLlmMessages => {
  const userName = user?.name?.trim() || '用户';
  const system =
    `${coreOf(char, user)}\n\n` +
    `【番茄钟陪伴中】${userName}正在专注「${session.topic}」，已经坚持了${minOf(session.elapsedMs)}分钟，还剩${minOf(session.remainingMs)}分钟。\n` +
    `请用你的语气和人设说一句简短的鼓励（30字以内），可以提到主题和已坚持的时长。只输出鼓励本身，不要复读指令，不要加多余的解释。`;
  const userText = `我正在用番茄钟做「${session.topic}」，已经专注${minOf(session.elapsedMs)}分钟了，给我一句鼓励吧。`;
  return { system, user: userText };
};

export const buildPunishmentMessages = (
  char: CharacterProfile,
  user: UserProfile,
  session: Pick<PomodoroSession, 'topic'> & { elapsedMs: number },
  reason: PomodoroPunishReason,
  awayMin?: number,
): PomodoroLlmMessages => {
  const userName = user?.name?.trim() || '用户';
  const reasonText = reason === 'quit'
    ? `${userName}在番茄钟「${session.topic}」还剩不少时间时主动选择了提前退出` 
    : `${userName}在番茄钟「${session.topic}」中途离开超过${awayMin ?? 5}分钟，被判定为中途放弃`;
  const system =
    `${coreOf(char, user)}\n\n` +
    `【番茄钟监督】${reasonText}，已经专注了${minOf(session.elapsedMs)}分钟。\n` +
    `你是监督${userName}专注的陪伴者。请根据你的人设和你们的关系，给出一份惩罚内容：SFW或NSFW都可以，由你自行决定分寸。要求：保持你的说话风格，100字以内，具体、可执行，只输出惩罚内容本身。`;
  const userText = reason === 'quit'
    ? `我没能坚持完这次番茄钟「${session.topic}」，请给我惩罚。`
    : `我中途离开太久，这次番茄钟「${session.topic}」算我放弃，请给我惩罚。`;
  return { system, user: userText };
};

export const buildReportReplyMessages = (
  char: CharacterProfile,
  user: UserProfile,
  session: Pick<PomodoroSession, 'topic'> & { elapsedMs: number },
  outcome: PomodoroReportOutcome,
): PomodoroLlmMessages => {
  const userName = user?.name?.trim() || '用户';
  const outcomeText = outcome === 'completed'
    ? `${userName}刚刚用番茄钟完整专注了「${session.topic}」${minOf(session.elapsedMs)}分钟，坚持到了最后`
    : `${userName}的番茄钟「${session.topic}」中途结束（专注了${minOf(session.elapsedMs)}分钟），${userName}已经接受了你的惩罚`;
  const system =
    `${coreOf(char, user)}\n\n` +
    `【番茄钟记录】${outcomeText}。\n` +
    `请用你的语气在聊天里回应这件事（60字以内）：完成后就夸一夸、问问感受；受罚后就接住情绪、说说下次怎么更好。只输出你的回应本身。`;
  const userText = `【番茄钟报告】我在${minOf(session.elapsedMs)}分钟里专注做了「${session.topic}」（${outcome === 'completed' ? '已完成' : '中途结束，已接受惩罚'}）。`;
  return { system, user: userText };
};

const callPomodoroLlm = async (
  api: PomodoroLlmApi,
  msgs: PomodoroLlmMessages,
  purpose: string,
  char?: Pick<CharacterProfile, 'id' | 'name'>,
  maxTokens = 500,
): Promise<string> => {
  const baseUrl = api.baseUrl?.replace(/\/+$/, '');
  if (!baseUrl) throw new Error('missing baseUrl');
  if (!api.model) throw new Error('missing model');
  const data = await safeFetchJson(
    `${baseUrl}/chat/completions`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${api.apiKey || 'sk-none'}` },
      body: JSON.stringify({
        model: api.model,
        messages: [
          { role: 'system', content: msgs.system },
          { role: 'user', content: msgs.user },
        ],
        temperature: 0.9,
        max_tokens: maxTokens,
        stream: false,
      }),
    },
    1,
    30_000,
    apiMeta(char?.id, char?.name, purpose),
  );
  const text = extractContent(data)?.trim();
  if (!text) throw new Error('empty reply');
  return text;
};

export const generateEncouragement = async (
  api: PomodoroLlmApi,
  char: CharacterProfile,
  user: UserProfile,
  session: PomodoroSession,
  now: number = Date.now(),
): Promise<string> => {
  const msgs = buildEncouragementMessages(char, user, {
    topic: session.topic,
    elapsedMs: elapsedMs(session, now),
    remainingMs: remainingMs(session, now),
  });
  return callPomodoroLlm(api, msgs, '番茄钟·鼓励', char, 300);
};

export const generatePunishment = async (
  api: PomodoroLlmApi,
  char: CharacterProfile,
  user: UserProfile,
  session: PomodoroSession,
  reason: PomodoroPunishReason,
  now: number = Date.now(),
): Promise<string> => {
  const awayMin = session.awaySince != null
    ? Math.max(1, Math.round((now - session.awaySince) / 60000))
    : undefined;
  const msgs = buildPunishmentMessages(char, user, {
    topic: session.topic,
    elapsedMs: elapsedMs(session, now),
  }, reason, awayMin);
  return callPomodoroLlm(api, msgs, reason === 'quit' ? '番茄钟·提前退出惩罚' : '番茄钟·离开惩罚', char, 500);
};

export const generateReportReply = async (
  api: PomodoroLlmApi,
  char: CharacterProfile,
  user: UserProfile,
  session: PomodoroSession,
  outcome: PomodoroReportOutcome,
  now: number = Date.now(),
): Promise<string> => {
  const msgs = buildReportReplyMessages(char, user, {
    topic: session.topic,
    elapsedMs: Math.min(elapsedMs(session, now), session.durationMs),
  }, outcome);
  return callPomodoroLlm(api, msgs, '番茄钟·完成回应', char, 300);
};
