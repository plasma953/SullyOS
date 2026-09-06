import { describe, it, expect } from 'vitest';
import {
  aggregateFocusByDay,
  createSession,
  elapsedMs,
  pauseSegment,
  startSegment,
  resolveAwayOutcome,
  tickProgress,
  shouldEncourage,
  scheduleNextEncouragement,
  markEncouraged,
  markSessionCompleted,
  formatClock,
} from './pomodoroSession';

describe('pomodoro session state machine', () => {
  it('only counts open-screen time (pause freezes, resume continues)', () => {
    const s0 = createSession({ charId: 'c1', topic: 'write', durationMs: 25 * 60_000, now: 1_000 });
    // open for 60s
    expect(elapsedMs(s0, 61_000)).toBe(60_000);
    const paused = pauseSegment(s0, 61_000);
    expect(paused.status).toBe('paused');
    expect(paused.awaySince).toBe(61_000);
    // 10 min away does not count
    expect(elapsedMs(paused, 661_000)).toBe(60_000);
    const resumed = startSegment(paused, 661_000);
    expect(elapsedMs(resumed, 721_000)).toBe(120_000);
  });

  it('away within limit resumes, beyond limit abandons', () => {
    const s0 = createSession({ charId: 'c1', topic: 'read', durationMs: 25 * 60_000, awayLimitMs: 5 * 60_000, now: 0 });
    const paused = pauseSegment(s0, 60_000);
    expect(resolveAwayOutcome(paused, 60_000 + 4 * 60_000).kind).toBe('resume');
    const over = resolveAwayOutcome(paused, 60_000 + 5 * 60_000 + 1);
    expect(over.kind).toBe('abandoned');
    if (over.kind === 'abandoned') expect(over.awayMs).toBeGreaterThan(5 * 60_000);
  });

  it('no awaySince means instant resume', () => {
    const s0 = createSession({ charId: 'c1', topic: 'x', now: 0 });
    expect(resolveAwayOutcome(s0, 999).kind).toBe('resume');
  });

  it('tick reports done at duration', () => {
    const s0 = createSession({ charId: 'c1', topic: 'x', durationMs: 60_000, now: 0 });
    expect(tickProgress(s0, 59_000).done).toBe(false);
    const t = tickProgress(s0, 60_000);
    expect(t.done).toBe(true);
    expect(t.progress).toBe(1);
    expect(t.remainingMs).toBe(0);
  });

  it('encouragement scheduling stays inside the configured window', () => {
    const s0 = createSession({
      charId: 'c1', topic: 'x', durationMs: 60 * 60_000,
      encourageMinMs: 3 * 60_000, encourageMaxMs: 7 * 60_000, now: 0,
    });
    const s1 = scheduleNextEncouragement({ ...s0, nextEncourageAt: null }, 1_000, 0);
    expect(s1.nextEncourageAt).toBe(1_000 + 3 * 60_000);
    const s2 = scheduleNextEncouragement({ ...s0, nextEncourageAt: null }, 1_000, 0.999999);
    expect(s2.nextEncourageAt!).toBeLessThanOrEqual(1_000 + 7 * 60_000);
    expect(s2.nextEncourageAt!).toBeGreaterThan(1_000 + 3 * 60_000);
  });

  it('shouldEncourage fires once per schedule then re-arms', () => {
    let s = createSession({ charId: 'c1', topic: 'x', durationMs: 60 * 60_000, now: 0 });
    s = { ...s, nextEncourageAt: 5_000 };
    expect(shouldEncourage(s, 4_999)).toBe(false);
    expect(shouldEncourage(s, 5_000)).toBe(true);
    s = markEncouraged(s, 'go!', 5_000, 0.5);
    expect(s.encouragements).toHaveLength(1);
    expect(shouldEncourage(s, 5_000)).toBe(false);
  });

  it('completed sessions stop scheduling', () => {
    const s0 = createSession({ charId: 'c1', topic: 'x', durationMs: 60_000, now: 0 });
    const done = markSessionCompleted(s0, 60_000);
    expect(done.status).toBe('completed');
    expect(shouldEncourage(done, 999_999)).toBe(false);
  });

  it('formatClock renders mm:ss', () => {
    expect(formatClock(25 * 60_000)).toBe('25:00');
    expect(formatClock(61_000)).toBe('01:01');
  });
});

describe('aggregateFocusByDay', () => {
  const entry = (over: Record<string, unknown>) => ({
    sessionKey: 'k', charId: 'c', charName: 'n', topic: 't',
    durationMs: 25 * 60_000, focusedMs: 25 * 60_000,
    outcome: 'completed' as const, endedAt: Date.now(), recordedToMemory: false,
    ...over,
  });

  it('zero-fills empty days, oldest first', () => {
    const now = new Date(2026, 8, 6, 12, 0, 0).getTime();
    const stats = aggregateFocusByDay([], 3, now);
    expect(stats.map((s) => s.dateKey)).toEqual(['2026-09-04', '2026-09-05', '2026-09-06']);
    expect(stats.every((s) => s.sessions === 0 && s.focusedMs === 0)).toBe(true);
  });

  it('sums focusedMs across outcomes, counts completed separately', () => {
    const day = new Date(2026, 8, 6, 10, 0, 0).getTime();
    const stats = aggregateFocusByDay([
      entry({ sessionKey: 'a', endedAt: day, focusedMs: 20 * 60_000, outcome: 'completed' }),
      entry({ sessionKey: 'b', endedAt: day + 3_600_000, focusedMs: 10 * 60_000, outcome: 'quit' }),
    ], 1, day + 7_200_000);
    expect(stats).toHaveLength(1);
    expect(stats[0].sessions).toBe(2);
    expect(stats[0].focusedMs).toBe(30 * 60_000);
    expect(stats[0].completed).toBe(1);
  });

  it('ignores out-of-window and broken entries', () => {
    const now = new Date(2026, 8, 6, 12, 0, 0).getTime();
    const stats = aggregateFocusByDay([
      entry({ sessionKey: 'old', endedAt: now - 30 * 86_400_000 }),
      entry({ sessionKey: 'bad', endedAt: Number.NaN }),
    ], 7, now);
    expect(stats.every((s) => s.sessions === 0)).toBe(true);
  });
});
