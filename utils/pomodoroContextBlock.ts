/**
 * Pomodoro context block for the unified chat payload builder.
 *
 * When a focus run is live, every char utterance (normal chat, amsg
 * proactive, emotion eval) sees one short volatile-tail line stating that
 * the user is currently in a pomodoro run. This is the ordering guard:
 * all three LLM paths share buildChatRequestPayload, so they stay
 * consistent and never fight the Pomodoro App's own lines.
 *
 * Pure read of localStorage key pomodoro_session_v1 — no React, no DB —
 * so the worker/Node side can import it safely.
 */

import { POMODORO_SESSION_LS_KEY } from './pomodoroSession';
import type { PomodoroSession } from './pomodoroSession';

export const readLivePomodoroSession = (): PomodoroSession | null => {
  try {
    const g = globalThis as unknown as { localStorage?: Storage };
    const store = g.localStorage;
    if (!store) return null;
    const raw = store.getItem(POMODORO_SESSION_LS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as PomodoroSession;
    if (!p || typeof p !== 'object') return null;
    if (p.status === 'completed' || p.status === 'abandoned') return null;
    if (!p.topic || !p.charId) return null;
    return p;
  } catch {
    return null;
  }
};

export const buildPomodoroContextBlock = (
  userName: string = '用户',
  now: number = Date.now(),
): string => {
  const s = readLivePomodoroSession();
  if (!s) return '';
  const openMs = s.segmentStartedAt != null ? Math.max(0, now - s.segmentStartedAt) : 0;
  const focusedMs = s.accumulatedMs + openMs;
  const focusedMin = Math.max(0, Math.floor(focusedMs / 60000));
  const totalMin = Math.max(1, Math.round(s.durationMs / 60000));
  const awayNote = s.segmentStartedAt == null ? '（当前切出了番茄钟界面，计时已暂停）' : '';
  return `\n[番茄钟进行中] ${userName}正在番茄钟专注「${s.topic}」，本轮计划${totalMin}分钟，已专注约${focusedMin}分钟${awayNote}。你可以用自然的方式偶尔关心进度，但不要刷屏说教。\n`;
};