/**
 * 手绘风水球：手绘不规则圆 + 单色扁平水（无渐变）+ 铅笔排线质感。
 * 水位随进度抬升；两条错相位手绘波浪线缓移（水球隐喻必需，幅度调小）。
 */
import React from 'react';
import { SKETCH_FONT, SKETCH_INK, SKETCH_PAPER } from './SketchKit';

/** 手绘不规则圆 path（确定性扰动，同尺寸只算一种形状） */
const wobblyCircle = (cx: number, cy: number, r: number, seed = 1): string => {
  const N = 96;
  const pts: string[] = [];
  for (let i = 0; i <= N; i += 1) {
    const t = (i / N) * Math.PI * 2;
    const rr = r * (1 + 0.013 * Math.sin(3 * t + seed) + 0.009 * Math.sin(7 * t + seed * 2.3));
    pts.push(`${(cx + rr * Math.cos(t)).toFixed(1)},${(cy + rr * Math.sin(t)).toFixed(1)}`);
  }
  return `M ${pts.join(' L ')} Z`;
};

/** 手绘波浪面：振幅逐段微差，像随手画的 */
const squiggle = (size: number, waterY: number, dx: number, amps: number[], close: boolean): string => {
  const seg = size / 4;
  let d = `M ${-size + dx} ${waterY} `;
  for (let i = 0; i < 8; i += 1) {
    const a = amps[i % amps.length];
    d += `q ${(seg / 2).toFixed(1)} ${i % 2 === 0 ? -a : (a * 0.55).toFixed(1)} ${seg.toFixed(1)} 0 `;
  }
  if (close) d += `L ${size * 2} ${size + 10} L ${-size} ${size + 10} Z`;
  return d;
};

interface WaterBallSketchProps {
  progress: number;
  label: string;
  sub: string;
  waterColor: string;
}

const WaterBallSketch: React.FC<WaterBallSketchProps> = ({ progress, label, sub, waterColor }) => {
  const size = 228;
  const r = 104;
  const c = size / 2;
  const p = Math.min(1, Math.max(0, progress));
  const waterY = c + r - p * r * 2;
  const body = wobblyCircle(c, c, r);
  return (
    <div className="relative mx-auto" style={{ width: size, height: size }}>
      <style>{`@keyframes skWaveA { from { transform: translateX(0); } to { transform: translateX(-${size / 2}px); } } @keyframes skWaveB { from { transform: translateX(-${size / 2}px); } to { transform: translateX(0); } }`}</style>
      {/* 手绘投影：错位虚线圆 */}
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute" style={{ left: 5, top: 5, opacity: 0.25 }}>
        <path d={body} fill="none" stroke={SKETCH_INK} strokeWidth="2" strokeDasharray="6 5" />
      </svg>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="relative block">
        <defs>
          <clipPath id="sk-ball-clip">
            <path d={body} />
          </clipPath>
          <pattern id="sk-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="rgba(58,54,48,0.20)" strokeWidth="1" />
          </pattern>
        </defs>
        <path d={body} fill="rgba(58,54,48,0.05)" />
        <g clipPath="url(#sk-ball-clip)">
          <path d={squiggle(size, waterY, 0, [5, 7, 4, 6], true)} fill={waterColor} opacity="0.92" />
          <rect x="0" y={waterY} width={size} height={size} fill="url(#sk-hatch)" />
          <g style={{ animation: 'skWaveA 6s linear infinite' }}>
            <path d={squiggle(size, waterY, 0, [5, 7, 4, 6], false)} fill="none" stroke={SKETCH_PAPER} strokeWidth="2.5" opacity="0.85" />
          </g>
          <g style={{ animation: 'skWaveB 9s linear infinite' }}>
            <path d={squiggle(size, waterY + 7, -30, [4, 6, 3, 5], false)} fill="none" stroke={SKETCH_INK} strokeWidth="1.5" opacity="0.3" />
          </g>
        </g>
        <path d={body} fill="none" stroke={SKETCH_INK} strokeWidth="2.5" />
        <path d={wobblyCircle(c, c, r - 8, 2)} fill="none" stroke={SKETCH_INK} strokeWidth="1" strokeDasharray="5 6" opacity="0.5" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <div
          className="text-4xl tabular-nums"
          style={{ fontFamily: SKETCH_FONT, fontWeight: 700, color: SKETCH_INK, textShadow: `0 0 4px ${SKETCH_PAPER}, 0 0 8px ${SKETCH_PAPER}` }}
        >
          {label}
        </div>
        <div
          className="mt-1 max-w-[150px] truncate text-xs"
          style={{ fontFamily: SKETCH_FONT, color: SKETCH_INK, textShadow: `0 0 4px ${SKETCH_PAPER}` }}
        >
          {sub}
        </div>
        <div className="mt-0.5 text-[10px] tabular-nums" style={{ fontFamily: SKETCH_FONT, color: SKETCH_INK, opacity: 0.7 }}>
          {Math.floor(p * 100)}%
        </div>
      </div>
    </div>
  );
};

export default WaterBallSketch;
