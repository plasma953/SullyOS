import { describe, it, expect } from 'vitest';
import {
  buildEncouragementMessages,
  buildPunishmentMessages,
  buildReportReplyMessages,
} from './pomodoroLlm';
import type { CharacterProfile, UserProfile } from '../types';

const char = { id: 'c1', name: 'TestChar' } as CharacterProfile;
const user = { name: 'Tester' } as UserProfile;

describe('pomodoro llm prompt builders', () => {
  it('encouragement mentions topic and timing', () => {
    const m = buildEncouragementMessages(char, user, { topic: 'math', elapsedMs: 10 * 60_000, remainingMs: 15 * 60_000 });
    expect(m.system).toContain('math');
    expect(m.system).toContain('10');
    expect(m.system).toContain('15');
    expect(m.user).toContain('math');
  });

  it('punishment differs by reason (quit vs away)', () => {
    const q = buildPunishmentMessages(char, user, { topic: 'math', elapsedMs: 5 * 60_000 }, 'quit');
    const a = buildPunishmentMessages(char, user, { topic: 'math', elapsedMs: 5 * 60_000 }, 'away', 8);
    expect(q.system).not.toBe(a.system);
    expect(q.user).not.toBe(a.user);
    expect(a.system).toContain('8');
  });

  it('report reply differs by outcome (completed vs punished)', () => {
    const c = buildReportReplyMessages(char, user, { topic: 'math', elapsedMs: 25 * 60_000 }, 'completed');
    const p = buildReportReplyMessages(char, user, { topic: 'math', elapsedMs: 10 * 60_000 }, 'punished');
    expect(c.system).not.toBe(p.system);
    expect(c.user).toContain('math');
    expect(p.user).toContain('math');
  });
});
