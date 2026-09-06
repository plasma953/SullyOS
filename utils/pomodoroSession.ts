/**
 * Pomodoro session state machine (pure functions, testable).
 *
 * Timing rule (confirmed): the clock only advances while the Pomodoro App
 * screen is open. Mount resumes a segment, unmount freezes it and stamps
 * awaySince. Coming back after awayLimitMs marks the run as abandoned and
 * the companion char starts the leave-punishment flow.
 */

export const POMODORO_SESSION_LS_KEY = 'pomodoro_session_v1';
export const POMODORO_HISTORY_LS_KEY = 'pomodoro_history_v1';

/** 历史上限：喂饱 12 周热力图（单条约 150B，总量可控） */
export const POMODORO_HISTORY_LIMIT = 500;

export const DEFAULT_AWAY_LIMIT_MS = 5 * 60 * 1000;
export const DEFAULT_ENCOURAGE_MIN_MS = 3 * 60 * 1000;
export const DEFAULT_ENCOURAGE_MAX_MS = 7 * 60 * 1000;
export const DEFAULT_DURATION_MS = 25 * 60 * 1000;

export type PomodoroStatus = 'running' | 'paused' | 'completed' | 'abandoned';
export type PomodoroOutcome = 'completed' | 'quit' | 'away';

export interface PomodoroEncouragement {
  at: number;
  text: string;
}

export interface PomodoroSession {
  sessionKey: string;
  charId: string;
  topic: string;
  durationMs: number;
  startedAt: number;
  /** ms accumulated from closed segments */
  accumulatedMs: number;
  /** start of the currently open segment, null while away */
  segmentStartedAt: number | null;
  /** when the user left the screen, null while open */
  awaySince: number | null;
  awayLimitMs: number;
  status: PomodoroStatus;
  encourageMinMs: number;
  encourageMaxMs: number;
  nextEncourageAt: number | null;
  encouragements: PomodoroEncouragement[];
}

export interface PomodoroHistoryEntry {
  sessionKey: string;
  charId: string;
  charName: string;
  topic: string;
  durationMs: number;
  focusedMs: number;
  outcome: PomodoroOutcome;
  endedAt: number;
  recordedToMemory: boolean;
}

import { addLocalDays, getLocalDateKey } from './localDate';

export const genSessionKey = (): string =>
  `pomo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export const createSession = (input: {
  charId: string;
  topic: string;
  durationMs?: number;
  awayLimitMs?: number;
  encourageMinMs?: number;
  encourageMaxMs?: number;
  now?: number;
}): PomodoroSession => {
  const now = input.now ?? Date.now();
  const encourageMinMs = input.encourageMinMs ?? DEFAULT_ENCOURAGE_MIN_MS;
  const encourageMaxMs = Math.max(encourageMinMs, input.encourageMaxMs ?? DEFAULT_ENCOURAGE_MAX_MS);
  const durationMs = Math.max(60_000, input.durationMs ?? DEFAULT_DURATION_MS);
  return {
    sessionKey: genSessionKey(),
    charId: input.charId,
    topic: input.topic.trim(),
    durationMs,
    startedAt: now,
    accumulatedMs: 0,
    segmentStartedAt: now,
    awaySince: null,
    awayLimitMs: input.awayLimitMs ?? DEFAULT_AWAY_LIMIT_MS,
    status: 'running',
    encourageMinMs,
    encourageMaxMs,
    nextEncourageAt: now + encourageMinMs + Math.random() * (encourageMaxMs - encourageMinMs),
    encouragements: [],
  };
};

/** Focused ms at `now` (open segment counts, away time does not). */
export const elapsedMs = (s: PomodoroSession, now: number): number => {
  const open = s.segmentStartedAt != null ? Math.max(0, now - s.segmentStartedAt) : 0;
  return s.accumulatedMs + open;
};

export const remainingMs = (s: PomodoroSession, now: number): number =>
  Math.max(0, s.durationMs - elapsedMs(s, now));

export const progressOf = (s: PomodoroSession, now: number): number => {
  if (s.durationMs <= 0) return 1;
  return Math.min(1, Math.max(0, elapsedMs(s, now) / s.durationMs));
};

export interface TickResult {
  elapsedMs: number;
  remainingMs: number;
  progress: number;
  done: boolean;
}

export const tickProgress = (s: PomodoroSession, now: number): TickResult => {
  const e = elapsedMs(s, now);
  const r = Math.max(0, s.durationMs - e);
  return { elapsedMs: e, remainingMs: r, progress: progressOf(s, now), done: r <= 0 };
};

/** Screen opened (mount): freeze away tracking, open a new segment. */
export const startSegment = (s: PomodoroSession, now: number): PomodoroSession => {
  if (s.status === 'completed' || s.status === 'abandoned') return s;
  if (s.segmentStartedAt != null) return s;
  return { ...s, segmentStartedAt: now, awaySince: null, status: 'running' };
};

/** Screen left (unmount): fold the open segment into accumulated, stamp away. */
export const pauseSegment = (s: PomodoroSession, now: number): PomodoroSession => {
  if (s.status === 'completed' || s.status === 'abandoned') return s;
  const acc = elapsedMs(s, now);
  return { ...s, accumulatedMs: acc, segmentStartedAt: null, awaySince: now, status: 'paused' };
};

export type AwayOutcome =
  | { kind: 'resume'; awayMs: number }
  | { kind: 'abandoned'; awayMs: number };

export const resolveAwayOutcome = (s: PomodoroSession, now: number): AwayOutcome => {
  if (s.awaySince == null) return { kind: 'resume', awayMs: 0 };
  const awayMs = Math.max(0, now - s.awaySince);
  if (awayMs > s.awayLimitMs) return { kind: 'abandoned', awayMs };
  return { kind: 'resume', awayMs };
};

export const markSessionAbandoned = (s: PomodoroSession): PomodoroSession => ({
  ...s,
  status: 'abandoned',
});

export const markSessionCompleted = (s: PomodoroSession, now: number): PomodoroSession => {
  const acc = elapsedMs(s, now);
  return {
    ...s,
    accumulatedMs: Math.max(acc, s.durationMs),
    segmentStartedAt: null,
    awaySince: null,
    status: 'completed',
    nextEncourageAt: null,
  };
};

export const shouldEncourage = (s: PomodoroSession, now: number): boolean =>
  s.status === 'running' &&
  s.nextEncourageAt != null &&
  now >= s.nextEncourageAt &&
  !tickProgress(s, now).done;

export const scheduleNextEncouragement = (
  s: PomodoroSession,
  now: number,
  rand: number = Math.random(),
): PomodoroSession => {
  const min = Math.max(30_000, s.encourageMinMs);
  const max = Math.max(min, s.encourageMaxMs);
  const r = Math.min(0.999999, Math.max(0, rand));
  return { ...s, nextEncourageAt: now + min + r * (max - min) };
};

export const markEncouraged = (
  s: PomodoroSession,
  text: string,
  now: number,
  rand: number = Math.random(),
): PomodoroSession =>
  scheduleNextEncouragement(
    { ...s, encouragements: [...s.encouragements, { at: now, text }] },
    now,
    rand,
  );

// ─── persistence (localStorage, guarded) ───

const getStore = (): Storage | null => {
  try {
    const g = globalThis as unknown as { localStorage?: Storage };
    return g.localStorage ?? null;
  } catch {
    return null;
  }
};

export const loadSession = (): PomodoroSession | null => {
  try {
    const store = getStore();
    if (!store) return null;
    const raw = store.getItem(POMODORO_SESSION_LS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as PomodoroSession;
    if (!p || typeof p !== 'object' || !p.sessionKey || !p.charId) return null;
    if (p.status === 'completed' || p.status === 'abandoned') return null;
    return p;
  } catch {
    return null;
  }
};

export const saveSession = (s: PomodoroSession | null): void => {
  try {
    const store = getStore();
    if (!store) return;
    if (!s) store.removeItem(POMODORO_SESSION_LS_KEY);
    else store.setItem(POMODORO_SESSION_LS_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
};

export const clearSession = (): void => saveSession(null);

export const loadPomodoroHistory = (): PomodoroHistoryEntry[] => {
  try {
    const store = getStore();
    if (!store) return [];
    const raw = store.getItem(POMODORO_HISTORY_LS_KEY);
    if (!raw) return [];
    const p = JSON.parse(raw);
    return Array.isArray(p) ? p.filter((e) => e && typeof e.sessionKey === 'string') : [];
  } catch {
    return [];
  }
};

export const appendPomodoroHistory = (e: PomodoroHistoryEntry): PomodoroHistoryEntry[] => {
  const next = [e, ...loadPomodoroHistory()].slice(0, POMODORO_HISTORY_LIMIT);
  try {
    getStore()?.setItem(POMODORO_HISTORY_LS_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
};

/** 热力图用的每日聚合。口径：当年所有结局的实际专注毫秒都算（真实投入）。 */
export interface PomodoroDayStat {
  /** 本地日期 YYYY-MM-DD */
  dateKey: string;
  sessions: number;
  focusedMs: number;
  completed: number;
}

/** 近 dayCount 天（含今天）的每日聚合，最老在前；脏条目忽略，空天补零。 */
export const aggregateFocusByDay = (
  history: PomodoroHistoryEntry[],
  dayCount: number,
  now: number = Date.now(),
): PomodoroDayStat[] => {
  const n = Math.max(1, Math.min(365, Math.floor(dayCount) || 12 * 7));
  const keys: string[] = [];
  let k: string | null = getLocalDateKey(new Date(now));
  for (let i = 0; i < n && k; i += 1) {
    keys.unshift(k);
    const prev = addLocalDays(k, -1);
    k = prev || null;
  }
  const buckets = new Map<string, PomodoroDayStat>();
  for (const key of keys) buckets.set(key, { dateKey: key, sessions: 0, focusedMs: 0, completed: 0 });
  for (const e of history) {
    if (!e || !Number.isFinite(e.endedAt)) continue;
    const b = buckets.get(getLocalDateKey(new Date(e.endedAt)));
    if (!b) continue;
    b.sessions += 1;
    b.focusedMs += Number.isFinite(e.focusedMs) ? Math.max(0, e.focusedMs) : 0;
    if (e.outcome === 'completed') b.completed += 1;
  }
  return [...buckets.values()];
};

export const formatClock = (ms: number): string => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const mm = Math.floor(total / 60).toString().padStart(2, '0');
  const ss = (total % 60).toString().padStart(2, '0');
  return `${mm}:${ss}`;
};

export const formatMinutes = (ms: number): string => {
  const m = ms / 60000;
  return Number.isInteger(m) ? `${m}` : m.toFixed(1);
};