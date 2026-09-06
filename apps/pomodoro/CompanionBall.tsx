/**
 * 番茄钟陪伴悬浮球：底部可拖动的角色头像球 + 消息气泡层。
 *
 * - 拖拽：照抄 GlobalMiniPlayer（pointer capture + 4px 阈值区分点按，
 *   位置经 clampBubblePos 钳制并持久化）。
 * - 轻点：循环切换消息模式 纯文字 → 纯语音 → 混合（与设置面板同一份 prefs）。
 * - 气泡：文字气泡直出；语音气泡带语音条并自动播放一次，支持重播与转文字；
 *   TTS 失败一律由调用方回落成文字，这里只管播给定的 audioUrl。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChatTeardropText, Play, Pause, Shuffle, SpeakerHigh, X } from '@phosphor-icons/react';
import TokenImg from '../../components/os/TokenImg';
import { isIOSStandaloneWebApp, readSafeAreaInsets } from '../../utils/iosStandalone';
import { clampBubblePos, resolveInsets, resolveSafeTopInset } from '../../utils/floatingBallBounds';
import { isImageValue } from '../../utils/blobRef';
import {
  loadPomodoroBallPos,
  savePomodoroBallPos,
  type PomodoroMessageMode,
} from '../../utils/pomodoroPrefs';
import {
  SKETCH_FONT,
  SKETCH_INK,
  SKETCH_MUTED,
  SKETCH_PAPER,
  SketchHatch,
  accentFill,
} from './SketchKit';
import type { CharacterProfile } from '../../types';

export interface CompanionBubble {
  id: string;
  kind: 'text' | 'voice';
  text: string;
  /** voice 的可播 URL（TtsResult.url）；缺席则当文字渲染 */
  audioUrl?: string;
  at: number;
}

export const BALL_SIZE = 56;
const DRAG_THRESHOLD = 4;
const BUBBLE_TTL_MS = 10_000;
const BUBBLE_WIDTH = 230;

const MODE_META: Record<PomodoroMessageMode, { label: string; Icon: React.ElementType }> = {
  text: { label: '纯文字', Icon: ChatTeardropText },
  voice: { label: '纯语音', Icon: SpeakerHigh },
  mixed: { label: '混合', Icon: Shuffle },
};

const readSafeTopInset = (): number => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return 0;
  const standaloneSafeTop = parseFloat(
    window.getComputedStyle(document.documentElement).getPropertyValue('--standalone-safe-area-top'),
  ) || 0;
  if (standaloneSafeTop > 0) return standaloneSafeTop;
  return resolveSafeTopInset({
    standaloneSafeTop,
    probedSafeTop: readSafeAreaInsets().top || 0,
    isIOSStandalone: isIOSStandaloneWebApp(),
  });
};

const computeInsets = (parent: HTMLElement): { insetTop: number; insetBottom: number } => {
  const cs = window.getComputedStyle(parent);
  return resolveInsets({
    padTop: parseFloat(cs.paddingTop) || 0,
    padBottom: parseFloat(cs.paddingBottom) || 0,
    safeTop: readSafeTopInset(),
  });
};

interface CompanionBallProps {
  char: CharacterProfile | null;
  mode: PomodoroMessageMode;
  accent: string;
  bubbles: CompanionBubble[];
  /** 正在生成下一句（LLM/TTS） */
  typing: boolean;
  onCycleMode: () => void;
  onDismissBubble: (id: string) => void;
}

const CompanionBall: React.FC<CompanionBallProps> = ({
  char,
  mode,
  accent,
  bubbles,
  typing,
  onCycleMode,
  onDismissBubble,
}) => {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(() => loadPomodoroBallPos());
  const [parentW, setParentW] = useState(0);
  const [jitterKey, setJitterKey] = useState(0);
  const [expandedText, setExpandedText] = useState<Record<string, boolean>>({});
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [leavingIds, setLeavingIds] = useState<Record<string, boolean>>({});
  const dragState = useRef<{
    startX: number; startY: number;
    offX: number; offY: number;
    parentW: number; parentH: number;
    insetTop: number; insetBottom: number;
    moved: boolean;
    pointerId: number | null;
  } | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playedRef = useRef<Set<string>>(new Set());
  const timersRef = useRef<Map<string, number>>(new Map());

  // 挂载与窗口变化时量父容器宽（气泡朝屏幕中央生长用）
  useEffect(() => {
    const measure = () => {
      const el = wrapRef.current?.parentElement as HTMLElement | null;
      if (el) setParentW(el.getBoundingClientRect().width);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // 新语音气泡：自动播一次（正在播的先停掉）
  useEffect(() => {
    const latest = [...bubbles].reverse().find((b) => b.kind === 'voice' && b.audioUrl);
    if (!latest || !latest.audioUrl || playedRef.current.has(latest.id)) return;
    playedRef.current.add(latest.id);
    try {
      const a = audioRef.current ?? new Audio();
      audioRef.current = a;
      a.pause();
      a.src = latest.audioUrl;
      setPlayingId(latest.id);
      a.onended = () => setPlayingId((cur) => (cur === latest.id ? null : cur));
      void a.play().catch(() => setPlayingId(null));
    } catch {
      setPlayingId(null);
    }
  }, [bubbles]);

  // 气泡 10s 自动收起（带 200ms 滑落动画）
  useEffect(() => {
    for (const b of bubbles) {
      if (timersRef.current.has(b.id)) continue;
      const t = window.setTimeout(() => {
        setLeavingIds((m) => ({ ...m, [b.id]: true }));
        const t2 = window.setTimeout(() => onDismissBubble(b.id), 200);
        timersRef.current.set(`${b.id}:leave`, t2);
      }, BUBBLE_TTL_MS);
      timersRef.current.set(b.id, t);
    }
    return () => {
      for (const t of timersRef.current.values()) window.clearTimeout(t);
      timersRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bubbles]);

  useEffect(() => () => {
    try {
      audioRef.current?.pause();
    } catch { /* ignore */ }
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const el = wrapRef.current;
    if (!el) return;
    const parent = el.parentElement as HTMLElement | null;
    if (!parent) return;
    const parentRect = parent.getBoundingClientRect();
    const bubbleRect = el.getBoundingClientRect();
    const { insetTop, insetBottom } = computeInsets(parent);
    dragState.current = {
      startX: e.clientX,
      startY: e.clientY,
      offX: e.clientX - bubbleRect.left,
      offY: e.clientY - bubbleRect.top,
      parentW: parentRect.width,
      parentH: parentRect.height,
      insetTop,
      insetBottom,
      moved: false,
      pointerId: e.pointerId,
    };
    try {
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    } catch { /* ignore */ }
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const ds = dragState.current;
    const el = wrapRef.current;
    if (!ds || !el) return;
    const dx = e.clientX - ds.startX;
    const dy = e.clientY - ds.startY;
    if (!ds.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD) ds.moved = true;
    if (!ds.moved) return;
    const parent = el.parentElement as HTMLElement | null;
    if (!parent) return;
    const parentRect = parent.getBoundingClientRect();
    const next = clampBubblePos(
      e.clientX - parentRect.left - ds.offX,
      e.clientY - parentRect.top - ds.offY,
      { parentW: ds.parentW, parentH: ds.parentH, insetTop: ds.insetTop, insetBottom: ds.insetBottom, bubble: BALL_SIZE },
    );
    setPos(next);
  }, []);

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const ds = dragState.current;
    if (ds && !ds.moved) {
      // 轻点：循环切换消息模式
      setJitterKey((k) => k + 1);
      onCycleMode();
    } else if (ds?.moved) {
      try {
        const el = wrapRef.current;
        if (el) {
          const parent = el.parentElement as HTMLElement | null;
          const pr = parent?.getBoundingClientRect();
          const br = el.getBoundingClientRect();
          if (pr) savePomodoroBallPos({ x: br.left - pr.left, y: br.top - pr.top });
        }
      } catch { /* ignore */ }
    }
    dragState.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    } catch { /* ignore */ }
  }, [onCycleMode]);

  const toggleReplay = useCallback((b: CompanionBubble) => {
    if (!b.audioUrl) return;
    try {
      const a = audioRef.current ?? new Audio();
      audioRef.current = a;
      if (playingId === b.id) {
        a.pause();
        setPlayingId(null);
        return;
      }
      a.pause();
      a.src = b.audioUrl;
      setPlayingId(b.id);
      a.onended = () => setPlayingId((cur) => (cur === b.id ? null : cur));
      void a.play().catch(() => setPlayingId(null));
    } catch {
      setPlayingId(null);
    }
  }, [playingId]);

  if (!char) return null;

  const meta = MODE_META[mode];
  const ModeIcon = meta.Icon;
  const avatar = char.avatar;
  const hasImg = !!avatar && isImageValue(avatar);

  const positional: React.CSSProperties = pos
    ? { left: pos.x, top: pos.y }
    : { right: 12, bottom: 12 };

  // 气泡朝屏幕中央生长，避免贴边被裁
  const ballCenterX = pos ? pos.x + BALL_SIZE / 2 : parentW - 12 - BALL_SIZE / 2;
  const growRight = parentW > 0 && ballCenterX < parentW / 2;

  const visible = bubbles.slice(-2);

  return (
    <div
      ref={wrapRef}
      className="absolute z-40 touch-none select-none"
      style={{ ...positional, width: BALL_SIZE, height: BALL_SIZE }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {/* 气泡层：球的上方 */}
      <div
        className="absolute flex flex-col gap-2"
        style={{
          bottom: BALL_SIZE + 10,
          width: BUBBLE_WIDTH,
          ...(growRight ? { left: 0 } : { right: 0 }),
        }}
      >
        {typing && (
          <div
            className="self-start px-3 py-2 text-xs"
            style={{
              background: SKETCH_PAPER,
              color: SKETCH_MUTED,
              fontFamily: SKETCH_FONT,
              border: `2px dashed ${accent}`,
              borderRadius: '13px 15px 12px 16px / 15px 12px 16px 13px',
              animation: 'skPop 160ms ease',
            }}
          >
            <span style={{ display: 'inline-flex', gap: 3 }}>
              {[0, 1, 2].map((i) => (
                <span key={i} style={{ animation: `skDots 1s ${i * 0.15}s infinite` }}>•</span>
              ))}
            </span>
          </div>
        )}
        {visible.map((b) => {
          const isVoice = b.kind === 'voice' && !!b.audioUrl;
          const showText = !isVoice || expandedText[b.id];
          const leaving = leavingIds[b.id];
          return (
            <div
              key={b.id}
              className="relative self-start px-3 py-2"
              style={{
                width: '100%',
                background: SKETCH_PAPER,
                color: SKETCH_INK,
                fontFamily: SKETCH_FONT,
                border: `2px dashed ${accent}`,
                borderRadius: '13px 15px 12px 16px / 15px 12px 16px 13px',
                boxShadow: `3px 3px 0 ${accentFill(accent, 0.25)}`,
                animation: leaving ? 'skSink 200ms ease forwards' : 'skPop 160ms ease',
              }}
            >
              <div className="mb-0.5 flex items-center gap-1 text-[10px] font-bold" style={{ color: accent }}>
                {char.name}
                <button
                  aria-label="收起"
                  onClick={() => onDismissBubble(b.id)}
                  className="ml-auto rounded-full p-0.5"
                  style={{ color: SKETCH_MUTED }}
                >
                  <X className="h-3 w-3" weight="bold" />
                </button>
              </div>
              {isVoice && (
                <button
                  onClick={() => toggleReplay(b)}
                  className="mb-1 flex w-full items-center gap-2 rounded-full px-2.5 py-1.5"
                  style={{ background: accentFill(accent, 0.14), border: `1.5px dashed ${accent}` }}
                  aria-label={playingId === b.id ? '暂停' : '重播'}
                >
                  {playingId === b.id ? (
                    <Pause className="h-4 w-4 shrink-0" weight="fill" style={{ color: accent }} />
                  ) : (
                    <Play className="h-4 w-4 shrink-0" weight="fill" style={{ color: accent }} />
                  )}
                  <span className="flex flex-1 items-end gap-[2px]" aria-hidden>
                    {[5, 9, 6, 11, 7, 10, 5, 8, 6, 9, 5].map((h, i) => (
                      <span key={i} style={{ width: 2, height: h, background: accent, opacity: playingId === b.id ? 1 : 0.45, borderRadius: 1 }} />
                    ))}
                  </span>
                  <span className="text-[10px] font-bold" style={{ color: accent }}>
                    {expandedText[b.id] ? '收起' : '转文字'}
                  </span>
                </button>
              )}
              {isVoice && !expandedText[b.id] ? null : (
                <div
                  className="text-[13px] leading-relaxed"
                  onClick={isVoice ? () => setExpandedText((m) => ({ ...m, [b.id]: !m[b.id] })) : undefined}
                >
                  {b.text}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 球本体 */}
      <div
        className="relative h-full w-full overflow-hidden"
        style={{
          background: SKETCH_PAPER,
          border: `2.5px dashed ${accent}`,
          borderRadius: '48% 52% 46% 54% / 52% 48% 54% 46%',
        }}
      >
        <div key={jitterKey} className="h-full w-full" style={jitterKey > 0 ? { animation: 'skJitter 220ms ease' } : undefined}>
          {hasImg ? (
            <TokenImg value={avatar} className="h-full w-full object-cover" draggable={false} />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xl font-bold" style={{ color: accent, fontFamily: SKETCH_FONT }}>
              {avatar && avatar.length <= 2 ? avatar : char.name.slice(0, 1)}
            </div>
          )}
        </div>
      </div>
      <SketchHatch color={accent} radius="48% 52% 46% 54% / 52% 48% 54% 46%" offset={3} />

      {/* 模式角标 */}
      <div
        className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full"
        style={{ background: SKETCH_PAPER, border: `2px solid ${accent}`, color: accent }}
        title={`消息模式：${meta.label}（轻点切换）`}
      >
        <ModeIcon className="h-3.5 w-3.5" weight="bold" />
      </div>
    </div>
  );
};

export default CompanionBall;
