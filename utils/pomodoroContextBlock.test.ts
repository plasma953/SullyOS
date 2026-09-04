import { describe, it, expect, beforeEach } from 'vitest';
import { buildPomodoroContextBlock } from './pomodoroContextBlock';
import { POMODORO_SESSION_LS_KEY } from './pomodoroSession';

describe('pomodoro context block', () => {
  beforeEach(() => {
    try { localStorage.removeItem(POMODORO_SESSION_LS_KEY); } catch { /* noop */ }
  });

  it('returns empty string when no live session', () => {
    expect(buildPomodoroContextBlock('Tester', 1000)).toBe('');
  });

  it('renders topic and minutes while running', () => {
    const now = 10 * 60_000;
    localStorage.setItem(POMODORO_SESSION_LS_KEY, JSON.stringify({
      sessionKey: 'pomo-x', charId: 'c1', topic: 'physics',
      durationMs: 25 * 60_000, startedAt: 0, accumulatedMs: 0,
      segmentStartedAt: 0, awaySince: null, awayLimitMs: 5 * 60_000,
      status: 'running', encourageMinMs: 180_000, encourageMaxMs: 420_000,
      nextEncourageAt: null, encouragements: [],
    }));
    const block = buildPomodoroContextBlock('Tester', now);
    expect(block).toContain('physics');
    expect(block).toContain('10');
  });

  it('marks paused-away state', () => {
    const now = 20 * 60_000;
    localStorage.setItem(POMODORO_SESSION_LS_KEY, JSON.stringify({
      sessionKey: 'pomo-y', charId: 'c1', topic: 'chem',
      durationMs: 25 * 60_000, startedAt: 0, accumulatedMs: 5 * 60_000,
      segmentStartedAt: null, awaySince: 15 * 60_000, awayLimitMs: 5 * 60_000,
      status: 'paused', encourageMinMs: 180_000, encourageMaxMs: 420_000,
      nextEncourageAt: null, encouragements: [],
    }));
    expect(buildPomodoroContextBlock('Tester', now)).toContain('chem');
  });

  it('stays silent for finished sessions', () => {
    localStorage.setItem(POMODORO_SESSION_LS_KEY, JSON.stringify({
      sessionKey: 'pomo-z', charId: 'c1', topic: 'bio',
      durationMs: 25 * 60_000, startedAt: 0, accumulatedMs: 25 * 60_000,
      segmentStartedAt: null, awaySince: null, awayLimitMs: 5 * 60_000,
      status: 'completed', encourageMinMs: 180_000, encourageMaxMs: 420_000,
      nextEncourageAt: null, encouragements: [],
    }));
    expect(buildPomodoroContextBlock('Tester', 999)).toBe('');
  });
});
