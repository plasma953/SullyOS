/**
 * 番茄钟外观与消息偏好（localStorage，App 级，与全局 OSTheme 互不干扰）。
 *
 * 背景图只存 blobref 令牌（图片本体经 putImageBlob 进 blobStore），
 * hex 颜色与枚举逐字段清洗，非法一律回落默认，存坏了也不炸界面。
 */

export const POMODORO_PREFS_LS_KEY = 'pomodoro_prefs_v1';
export const POMODORO_BALL_POS_LS_KEY = 'pomodoro_ball_pos_v1';

export type PomodoroMessageMode = 'text' | 'voice' | 'mixed';

export interface PomodoroPrefs {
  /** 背景图 blobref 令牌；缺省 = 纸底 */
  bgImage?: string;
  /** 背景图上方的纸色遮罩 0..1（默认 0.55），保墨字可读 */
  bgDim: number;
  /** 整体配色主色：按钮 / 边框 / 气泡描边 / 高亮 */
  accent: string;
  /** 水球单色（扁平水，手绘风不渐变） */
  waterColor: string;
  /** 角色消息形态：纯文字 / 纯语音 / 混合 */
  messageMode: PomodoroMessageMode;
}

export const DEFAULT_POMODORO_PREFS: PomodoroPrefs = {
  bgDim: 0.55,
  accent: '#C0563F',
  waterColor: '#4FA8C9',
  messageMode: 'text',
};

export interface PomodoroColorPreset {
  id: string;
  name: string;
  value: string;
}

/** 整体配色预设（低饱和手绘感，默认位必须是 DEFAULT accent） */
export const POMODORO_ACCENT_PRESETS: PomodoroColorPreset[] = [
  { id: 'ochre', name: '赭石', value: '#C0563F' },
  { id: 'pine', name: '墨绿', value: '#4E6E58' },
  { id: 'indigo-ink', name: '黛蓝', value: '#46586E' },
  { id: 'plum', name: '绛紫', value: '#7A5C72' },
  { id: 'vine-yellow', name: '藤黄', value: '#C99A3C' },
  { id: 'clay', name: '陶土', value: '#B07D4F' },
  { id: 'navy', name: '藏青', value: '#3E4E5E' },
  { id: 'ink-gray', name: '黛灰', value: '#5B6066' },
];

/** 水球配色预设（默认位必须是 DEFAULT waterColor） */
export const POMODORO_WATER_PRESETS: PomodoroColorPreset[] = [
  { id: 'pencil-blue', name: '铅笔蓝', value: '#4FA8C9' },
  { id: 'lake', name: '湖绿', value: '#5FA88F' },
  { id: 'mandarin', name: '蜜柑', value: '#E8A06B' },
  { id: 'sakura', name: '樱粉', value: '#D98AA5' },
  { id: 'grape', name: '葡萄紫', value: '#8E7CC3' },
  { id: 'smoke-blue', name: '烟灰蓝', value: '#7C93A8' },
];

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const normalizeHex = (value: unknown, fallback: string): string => {
  if (typeof value !== 'string' || !HEX_RE.test(value.trim())) return fallback;
  let hex = value.trim().slice(1);
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  return `#${hex.toUpperCase()}`;
};

const clamp01 = (value: unknown, fallback: number): number => {
  const n = typeof value === 'number' ? value : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, n));
};

const MESSAGE_MODES: PomodoroMessageMode[] = ['text', 'voice', 'mixed'];

/** 纯解析：对象或 JSON 字符串 → 清洗后的偏好。存储坏了也只回默认。 */
export const parsePomodoroPrefs = (raw: unknown): PomodoroPrefs => {
  let p: Record<string, unknown> | null = null;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      p = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    } catch {
      p = null;
    }
  } else if (raw && typeof raw === 'object') {
    p = raw as Record<string, unknown>;
  }
  const bgImage = typeof p?.bgImage === 'string' && p.bgImage.trim() ? p.bgImage.trim() : undefined;
  const mode = MESSAGE_MODES.includes(p?.messageMode as PomodoroMessageMode)
    ? (p?.messageMode as PomodoroMessageMode)
    : DEFAULT_POMODORO_PREFS.messageMode;
  return {
    bgImage,
    bgDim: clamp01(p?.bgDim, DEFAULT_POMODORO_PREFS.bgDim),
    accent: normalizeHex(p?.accent, DEFAULT_POMODORO_PREFS.accent),
    waterColor: normalizeHex(p?.waterColor, DEFAULT_POMODORO_PREFS.waterColor),
    messageMode: mode,
  };
};

const getStore = (): Storage | null => {
  try {
    const g = globalThis as unknown as { localStorage?: Storage };
    return g.localStorage ?? null;
  } catch {
    return null;
  }
};

export const loadPomodoroPrefs = (): PomodoroPrefs => {
  try {
    return parsePomodoroPrefs(getStore()?.getItem(POMODORO_PREFS_LS_KEY));
  } catch {
    return { ...DEFAULT_POMODORO_PREFS };
  }
};

export const savePomodoroPrefs = (patch: Partial<PomodoroPrefs>): PomodoroPrefs => {
  const merged = parsePomodoroPrefs({ ...loadPomodoroPrefs(), ...patch });
  try {
    getStore()?.setItem(POMODORO_PREFS_LS_KEY, JSON.stringify(merged));
  } catch {
    /* ignore */
  }
  return merged;
};

export const resetPomodoroPrefs = (): PomodoroPrefs => {
  try {
    getStore()?.removeItem(POMODORO_PREFS_LS_KEY);
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_POMODORO_PREFS };
};

/** 悬浮球轻点：纯文字 → 纯语音 → 混合 → 纯文字 */
export const nextMessageMode = (mode: PomodoroMessageMode): PomodoroMessageMode =>
  mode === 'text' ? 'voice' : mode === 'voice' ? 'mixed' : 'text';

export interface PomodoroBallPos {
  x: number;
  y: number;
}

/** 悬浮球位置（left/top 像素，读容器 rect 时换算）。坏值一律当没存过。 */
export const loadPomodoroBallPos = (): PomodoroBallPos | null => {
  try {
    const raw = getStore()?.getItem(POMODORO_BALL_POS_LS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as { x?: unknown; y?: unknown };
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
    return { x: p.x as number, y: p.y as number };
  } catch {
    return null;
  }
};

export const savePomodoroBallPos = (pos: PomodoroBallPos): void => {
  try {
    getStore()?.setItem(POMODORO_BALL_POS_LS_KEY, JSON.stringify({ x: pos.x, y: pos.y }));
  } catch {
    /* ignore */
  }
};
