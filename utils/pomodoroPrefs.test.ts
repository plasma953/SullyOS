import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_POMODORO_PREFS,
  POMODORO_ACCENT_PRESETS,
  POMODORO_BALL_POS_LS_KEY,
  POMODORO_PREFS_LS_KEY,
  POMODORO_WATER_PRESETS,
  loadPomodoroBallPos,
  loadPomodoroPrefs,
  nextMessageMode,
  parsePomodoroPrefs,
  resetPomodoroPrefs,
  savePomodoroBallPos,
  savePomodoroPrefs,
} from './pomodoroPrefs';

const makeStore = () => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  });
  return values;
};

afterEach(() => vi.unstubAllGlobals());

describe('parsePomodoroPrefs', () => {
  it('falls back to defaults on null/broken input', () => {
    expect(parsePomodoroPrefs(null)).toEqual(DEFAULT_POMODORO_PREFS);
    expect(parsePomodoroPrefs('{broken')).toEqual(DEFAULT_POMODORO_PREFS);
    expect(parsePomodoroPrefs(42)).toEqual(DEFAULT_POMODORO_PREFS);
  });

  it('merges partial input over defaults', () => {
    expect(parsePomodoroPrefs({ accent: '#123456' })).toEqual({
      ...DEFAULT_POMODORO_PREFS,
      accent: '#123456',
    });
    expect(parsePomodoroPrefs({ messageMode: 'voice', bgDim: 0.3 })).toEqual({
      ...DEFAULT_POMODORO_PREFS,
      messageMode: 'voice',
      bgDim: 0.3,
    });
  });

  it('rejects invalid colors and keeps defaults', () => {
    const p = parsePomodoroPrefs({ accent: 'red', waterColor: '#zzzzzz' });
    expect(p.accent).toBe(DEFAULT_POMODORO_PREFS.accent);
    expect(p.waterColor).toBe(DEFAULT_POMODORO_PREFS.waterColor);
  });

  it('accepts 3-digit hex and normalizes case', () => {
    expect(parsePomodoroPrefs({ accent: '#abc' }).accent).toBe('#AABBCC');
    expect(parsePomodoroPrefs({ waterColor: '#4fa8c9' }).waterColor).toBe('#4FA8C9');
  });

  it('clamps bgDim into range', () => {
    expect(parsePomodoroPrefs({ bgDim: -1 }).bgDim).toBe(0);
    expect(parsePomodoroPrefs({ bgDim: 9 }).bgDim).toBe(1);
    expect(parsePomodoroPrefs({ bgDim: 'x' }).bgDim).toBe(DEFAULT_POMODORO_PREFS.bgDim);
  });

  it('rejects unknown message modes', () => {
    expect(parsePomodoroPrefs({ messageMode: 'video' }).messageMode).toBe('text');
  });

  it('keeps valid bgImage tokens and drops blanks', () => {
    expect(parsePomodoroPrefs({ bgImage: 'blobref:b_1' }).bgImage).toBe('blobref:b_1');
    expect(parsePomodoroPrefs({ bgImage: '   ' }).bgImage).toBeUndefined();
  });
});

describe('pomodoro prefs persistence', () => {
  it('round-trips through localStorage', () => {
    makeStore();
    savePomodoroPrefs({ accent: '#112233', messageMode: 'mixed' });
    expect(loadPomodoroPrefs()).toEqual({
      ...DEFAULT_POMODORO_PREFS,
      accent: '#112233',
      messageMode: 'mixed',
    });
  });

  it('resetPomodoroPrefs wipes the key and restores defaults', () => {
    const values = makeStore();
    savePomodoroPrefs({ accent: '#112233' });
    expect(resetPomodoroPrefs()).toEqual(DEFAULT_POMODORO_PREFS);
    expect(values.has(POMODORO_PREFS_LS_KEY)).toBe(false);
  });
});

describe('pomodoro ball position', () => {
  it('starts null and round-trips', () => {
    const values = makeStore();
    expect(loadPomodoroBallPos()).toBeNull();
    savePomodoroBallPos({ x: 120, y: 340 });
    expect(loadPomodoroBallPos()).toEqual({ x: 120, y: 340 });
    expect(values.get(POMODORO_BALL_POS_LS_KEY)).toBe(JSON.stringify({ x: 120, y: 340 }));
  });

  it('rejects garbage ball positions', () => {
    const values = makeStore();
    values.set(POMODORO_BALL_POS_LS_KEY, '{nope');
    expect(loadPomodoroBallPos()).toBeNull();
    values.set(POMODORO_BALL_POS_LS_KEY, JSON.stringify({ x: 'a', y: 1 }));
    expect(loadPomodoroBallPos()).toBeNull();
  });
});

describe('nextMessageMode', () => {
  it('cycles text -> voice -> mixed -> text', () => {
    expect(nextMessageMode('text')).toBe('voice');
    expect(nextMessageMode('voice')).toBe('mixed');
    expect(nextMessageMode('mixed')).toBe('text');
  });
});

describe('pomodoro color presets', () => {
  it('ships usable accent and water palettes', () => {
    expect(POMODORO_ACCENT_PRESETS.length).toBeGreaterThanOrEqual(6);
    expect(POMODORO_WATER_PRESETS.length).toBeGreaterThanOrEqual(5);
    for (const p of [...POMODORO_ACCENT_PRESETS, ...POMODORO_WATER_PRESETS]) {
      expect(p.id).toBeTruthy();
      expect(p.name).toBeTruthy();
      expect(p.value).toMatch(/^#[0-9A-F]{6}$/);
    }
    expect(POMODORO_ACCENT_PRESETS.some((p) => p.value === DEFAULT_POMODORO_PREFS.accent)).toBe(true);
    expect(POMODORO_WATER_PRESETS.some((p) => p.value === DEFAULT_POMODORO_PREFS.waterColor)).toBe(true);
  });
});
