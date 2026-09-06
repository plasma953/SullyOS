/**
 * 铅笔手绘风原子件（番茄钟专用）。
 *
 * 与系统其他 App 的深色玻璃风是刻意并存的例外：纸底 + 虚线框 +
 * 不规则圆角 + 交叉线阴影 + 楷体栈；禁渐变 / 纯白 / 玻璃模糊，
 * 动效一律短促（入场微抖、按下沉 1px）。
 */
import React from 'react';

export const SKETCH_PAPER = '#f5f0e8';
export const SKETCH_INK = '#3a3630';
export const SKETCH_MUTED = '#8a8378';
export const SKETCH_LINE = '#5d564c';
export const SKETCH_FONT = `'Kaiti SC','STKaiti','KaiTi','DFKai-SB',serif`;

/** 经典手绘不规则圆角（四角微差，看起来像手画的） */
export const SKETCH_RADIUS = '255px 15px 225px 15px / 15px 225px 15px 255px';
export const SKETCH_RADIUS_SM = '13px 15px 12px 16px / 15px 12px 16px 13px';

/** 一次性注入的手绘风 keyframes（整个 App 只挂一份） */
export const SketchKeyframes: React.FC = () => (
  <style>{`
    @keyframes skPop { 0% { transform: scale(.92) rotate(-1.2deg); opacity: 0; } 60% { transform: scale(1.02) rotate(.6deg); opacity: 1; } 100% { transform: scale(1) rotate(0); opacity: 1; } }
    @keyframes skJitter { 0% { transform: rotate(0); } 30% { transform: rotate(-3deg) scale(1.04); } 60% { transform: rotate(2.5deg) scale(1.02); } 100% { transform: rotate(0) scale(1); } }
    @keyframes skDots { 0%, 60%, 100% { transform: translateY(0); opacity: .45; } 30% { transform: translateY(-3px); opacity: 1; } }
    @keyframes skSink { from { transform: translateY(0); opacity: 1; } to { transform: translateY(8px); opacity: 0; } }
  `}</style>
);

/** 交叉线阴影层（手绘风不用纯色投影，用 45° 铅笔排线代替） */
export const SketchHatch: React.FC<{ color?: string; radius?: string; offset?: number }> = ({
  color = SKETCH_INK,
  radius = SKETCH_RADIUS_SM,
  offset = 3,
}) => (
  <div
    aria-hidden
    className="pointer-events-none absolute inset-0"
    style={{
      transform: `translate(${offset}px, ${offset}px)`,
      borderRadius: radius,
      background: `repeating-linear-gradient(45deg, ${color} 0 1px, transparent 1px 5px)`,
      opacity: 0.22,
    }}
  />
);

interface SketchBoxProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 描边色：默认墨色；气泡类传 accent */
  line?: string;
  radius?: string;
  shadow?: boolean;
}

/** 纸卡：纸底 + 虚线框 + 交叉线阴影 */
export const SketchBox: React.FC<SketchBoxProps> = ({
  line = SKETCH_INK,
  radius = SKETCH_RADIUS_SM,
  shadow = true,
  style,
  children,
  ...rest
}) => (
  <div
    {...rest}
    style={{
      position: 'relative',
      background: SKETCH_PAPER,
      color: SKETCH_INK,
      fontFamily: SKETCH_FONT,
      border: `2px dashed ${line}`,
      borderRadius: radius,
      ...style,
    }}
  >
    {shadow && <SketchHatch color={line} radius={radius} />}
    <div className="relative" style={{ zIndex: 1 }}>
      {children}
    </div>
  </div>
);

interface SketchButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary = accent 实底纸字；ghost = 纸底墨字 */
  tone?: 'primary' | 'ghost' | 'danger';
  accent?: string;
}

/** 手绘按钮：实色无渐变，按下整颗沉 1px */
export const SketchButton: React.FC<SketchButtonProps> = ({
  tone = 'ghost',
  accent = '#C0563F',
  style,
  children,
  ...rest
}) => {
  const face =
    tone === 'primary'
      ? { background: accent, color: SKETCH_PAPER, border: `2px solid ${accent}` }
      : tone === 'danger'
        ? { background: '#A8452F', color: SKETCH_PAPER, border: '2px solid #A8452F' }
        : { background: SKETCH_PAPER, color: SKETCH_INK, border: `2px dashed ${SKETCH_INK}` };
  return (
    <button
      {...rest}
      style={{
        fontFamily: SKETCH_FONT,
        fontWeight: 700,
        borderRadius: SKETCH_RADIUS_SM,
        transition: 'transform 90ms ease',
        ...face,
        ...style,
      }}
      onMouseDown={(e) => {
        (e.currentTarget as HTMLButtonElement).style.transform = 'translate(1px, 1px)';
        rest.onMouseDown?.(e);
      }}
      onMouseUp={(e) => {
        (e.currentTarget as HTMLButtonElement).style.transform = '';
        rest.onMouseUp?.(e);
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.transform = '';
        rest.onMouseLeave?.(e);
      }}
    >
      {children}
    </button>
  );
};

/** 小节标题：楷体小字 + accent 虚线下划线 */
export const SketchLabel: React.FC<{ children: React.ReactNode; accent?: string }> = ({
  children,
  accent = '#C0563F',
}) => (
  <div
    style={{
      fontFamily: SKETCH_FONT,
      fontWeight: 700,
      fontSize: 12,
      letterSpacing: '0.2em',
      color: SKETCH_MUTED,
      borderBottom: `2px dashed ${accent}`,
      paddingBottom: 4,
      display: 'inline-block',
    }}
  >
    {children}
  </div>
);

/** 用 accent 给出的半透明填充（热力图格 / 水球高光等按档位调不透明度） */
export const accentFill = (accent: string, alpha: number): string => {
  const m = /^#([0-9a-fA-F]{6})$/.exec(accent.trim());
  if (!m) return accent;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${Math.min(1, Math.max(0, alpha))})`;
};
