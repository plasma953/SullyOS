/**
 * 番茄钟使用热力图：近 12 周 GitHub 式格网，手绘风渲染。
 * 口径：当年所有结局的实际专注分钟都算（真实投入）。
 */
import React, { useMemo } from 'react';
import {
  aggregateFocusByDay,
  formatMinutes,
  type PomodoroHistoryEntry,
} from '../../utils/pomodoroSession';
import {
  SKETCH_FONT,
  SKETCH_LINE,
  SKETCH_MUTED,
  SKETCH_PAPER,
  SketchLabel,
  accentFill,
} from './SketchKit';

export const HEATMAP_WEEKS = 12;

/** 当日专注分钟 → 强度档 */
export const heatLevelOf = (focusedMs: number): 0 | 1 | 2 | 3 | 4 => {
  const m = Math.max(0, focusedMs) / 60_000;
  if (m <= 0) return 0;
  if (m < 15) return 1;
  if (m < 30) return 2;
  if (m < 60) return 3;
  return 4;
};

const LEVEL_ALPHA = [0, 0.3, 0.55, 0.8, 1];

interface UsageHeatmapProps {
  history: PomodoroHistoryEntry[];
  accent: string;
  /** 点格子：父组件 toast 当日详情 */
  onPickDay: (dateKey: string, sessions: number, focusedMs: number) => void;
}

const UsageHeatmap: React.FC<UsageHeatmapProps> = ({ history, accent, onPickDay }) => {
  const days = useMemo(() => aggregateFocusByDay(history, HEATMAP_WEEKS * 7), [history]);

  const { columns, monthLabels } = useMemo(() => {
    // 周一为行首对齐：首天按星期几补空
    const first = days[0] ? new Date(`${days[0].dateKey}T12:00:00`) : null;
    const padStart = first ? (first.getDay() + 6) % 7 : 0;
    const cells: ((typeof days)[number] | null)[] = [
      ...Array<null>(padStart).fill(null),
      ...days,
    ];
    while (cells.length % 7 !== 0) cells.push(null);
    const cols: ((typeof days)[number] | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) cols.push(cells.slice(i, i + 7));
    // 每列第一个非空格的月份；与左邻不同则标注
    const labels: (string | null)[] = cols.map((col, i) => {
      const hit = col.find((c) => c);
      if (!hit) return null;
      const month = Number(hit.dateKey.slice(5, 7));
      if (i === 0) return `${month}月`;
      const prevHit = cols[i - 1].find((c) => c);
      const prevMonth = prevHit ? Number(prevHit.dateKey.slice(5, 7)) : month;
      return prevMonth === month ? null : `${month}月`;
    });
    return { columns: cols, monthLabels: labels };
  }, [days]);

  const weekStat = useMemo(() => {
    const last7 = days.slice(-7);
    return {
      sessions: last7.reduce((a, d) => a + d.sessions, 0),
      focusedMs: last7.reduce((a, d) => a + d.focusedMs, 0),
    };
  }, [days]);

  const hasAny = days.some((d) => d.sessions > 0);

  return (
    <div>
      <div className="mb-2 flex items-baseline gap-2">
        <SketchLabel accent={accent}>专注脚印</SketchLabel>
        <span className="text-[11px]" style={{ color: SKETCH_MUTED, fontFamily: SKETCH_FONT }}>
          本周 {weekStat.sessions} 次 · 共 {formatMinutes(weekStat.focusedMs)} 分钟
        </span>
      </div>
      {!hasAny ? (
        <div className="py-3 text-center text-xs" style={{ color: SKETCH_MUTED, fontFamily: SKETCH_FONT }}>
          还没有记录，完成一次专注就来点亮第一格吧
        </div>
      ) : (
        <>
          <div className="flex">
            <div style={{ width: 16 }} />
            <div className="grid flex-1" style={{ gridTemplateColumns: `repeat(${columns.length}, 1fr)`, gap: 3 }}>
              {monthLabels.map((m, i) => (
                <div key={i} className="truncate text-[9px]" style={{ color: SKETCH_MUTED, fontFamily: SKETCH_FONT }}>
                  {m ?? ''}
                </div>
              ))}
            </div>
          </div>
          <div className="flex">
            <div className="grid shrink-0" style={{ width: 16, gridTemplateRows: 'repeat(7, 1fr)', gap: 3 }}>
              {['一', '', '三', '', '五', '', ''].map((w, i) => (
                <div key={i} className="flex items-center text-[9px]" style={{ color: SKETCH_MUTED, fontFamily: SKETCH_FONT }}>
                  {w}
                </div>
              ))}
            </div>
            <div className="grid flex-1" style={{ gridTemplateColumns: `repeat(${columns.length}, 1fr)`, gap: 3 }}>
              {columns.map((col, ci) =>
                col.map((cell, ri) =>
                  cell ? (
                    <button
                      key={`${ci}-${ri}`}
                      onClick={() => onPickDay(cell.dateKey, cell.sessions, cell.focusedMs)}
                      title={`${cell.dateKey}：${cell.sessions} 次`}
                      aria-label={`${cell.dateKey} ${cell.sessions} 次`}
                      style={{
                        aspectRatio: '1',
                        borderRadius: '4px 5px 4px 6px / 5px 4px 6px 4px',
                        border: `1.5px ${heatLevelOf(cell.focusedMs) === 0 ? 'dashed' : 'solid'} ${heatLevelOf(cell.focusedMs) === 0 ? SKETCH_LINE : accent}`,
                        background: heatLevelOf(cell.focusedMs) === 0 ? SKETCH_PAPER : accentFill(accent, LEVEL_ALPHA[heatLevelOf(cell.focusedMs)]),
                      }}
                    />
                  ) : (
                    <div key={`${ci}-${ri}`} style={{ aspectRatio: '1' }} />
                  ),
                ),
              )}
            </div>
          </div>
          <div className="mt-1.5 flex items-center justify-end gap-1 text-[10px]" style={{ color: SKETCH_MUTED, fontFamily: SKETCH_FONT }}>
            少
            {[0, 1, 2, 3, 4].map((l) => (
              <span
                key={l}
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: '3px 4px 3px 5px / 4px 3px 5px 3px',
                  border: `1px ${l === 0 ? 'dashed' : 'solid'} ${l === 0 ? SKETCH_LINE : accent}`,
                  background: l === 0 ? SKETCH_PAPER : accentFill(accent, LEVEL_ALPHA[l]),
                }}
              />
            ))}
            多
          </div>
        </>
      )}
    </div>
  );
};

export default UsageHeatmap;
