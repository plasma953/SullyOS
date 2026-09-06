/**
 * 番茄钟设置面板（主页内展开）：背景图 / 整体配色 / 水球颜色 / 消息模式。
 * 全部即时生效并持久化（经父组件 savePomodoroPrefs）。
 */
import React, { useRef, useState } from 'react';
import { ChatTeardropText, Image, Shuffle, SpeakerHigh } from '@phosphor-icons/react';
import TokenImg from '../../components/os/TokenImg';
import { putImageBlob } from '../../utils/blobRef';
import { processImageToBlob } from '../../utils/file';
import {
  POMODORO_ACCENT_PRESETS,
  POMODORO_WATER_PRESETS,
  type PomodoroMessageMode,
  type PomodoroPrefs,
} from '../../utils/pomodoroPrefs';
import {
  SKETCH_INK,
  SKETCH_LINE,
  SKETCH_MUTED,
  SKETCH_PAPER,
  SketchBox,
  SketchButton,
  SketchLabel,
} from './SketchKit';

const MODE_OPTIONS: { id: PomodoroMessageMode; label: string; Icon: React.ElementType; hint: string }[] = [
  { id: 'text', label: '纯文字', Icon: ChatTeardropText, hint: '气泡直接显示文字' },
  { id: 'voice', label: '纯语音', Icon: SpeakerHigh, hint: '自动播放语音条' },
  { id: 'mixed', label: '混合', Icon: Shuffle, hint: '每句随机二选一' },
];

const isHex = (v: string): boolean => /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v.trim());

interface PomodoroSettingsProps {
  prefs: PomodoroPrefs;
  onChange: (patch: Partial<PomodoroPrefs>) => void;
}

const PomodoroSettings: React.FC<PomodoroSettingsProps> = ({ prefs, onChange }) => {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState('');
  const [customAccent, setCustomAccent] = useState('');
  const [customWater, setCustomWater] = useState('');
  const [colorErr, setColorErr] = useState('');

  const pickImage = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setUploadErr('');
    try {
      const blob = await processImageToBlob(file, { skipCompression: true });
      const token = await putImageBlob(blob);
      onChange({ bgImage: token });
    } catch {
      setUploadErr('图片存不下来，换一张试试');
    } finally {
      setUploading(false);
    }
  };

  const applyCustomColor = (field: 'accent' | 'waterColor', value: string) => {
    if (!isHex(value)) {
      setColorErr('颜色填 #RGB 或 #RRGGBB，比如 #C0563F');
      return;
    }
    setColorErr('');
    if (field === 'accent') setCustomAccent('');
    else setCustomWater('');
    onChange({ [field]: value.trim() } as Partial<PomodoroPrefs>);
  };

  const swatch = (value: string, selected: boolean, onPick: () => void, name: string) => (
    <button
      key={value}
      onClick={onPick}
      title={name}
      aria-label={name}
      className="h-9 w-9 transition active:scale-90"
      style={{
        background: value,
        borderRadius: '48% 52% 46% 54% / 52% 48% 54% 46%',
        border: selected ? `2.5px solid ${SKETCH_INK}` : `1.5px dashed ${SKETCH_LINE}`,
        outline: selected ? `2px dashed ${value}` : 'none',
        outlineOffset: 2,
      }}
    />
  );

  return (
    <SketchBox line={prefs.accent} style={{ padding: 14 }}>
      <div className="mb-3 flex items-center gap-2">
        <SketchLabel accent={prefs.accent}>纸面装扮</SketchLabel>
        <span className="text-[11px]" style={{ color: SKETCH_MUTED }}>改完即时生效，自动记住</span>
      </div>

      {/* 背景图 */}
      <div className="mb-1 text-xs font-bold" style={{ color: SKETCH_INK }}>背景图</div>
      <div className="flex items-center gap-3">
        <div
          className="flex h-16 w-24 shrink-0 items-center justify-center overflow-hidden"
          style={{ border: `2px dashed ${SKETCH_LINE}`, borderRadius: '10px 12px 11px 13px / 12px 10px 13px 11px', background: SKETCH_PAPER }}
        >
          {prefs.bgImage ? (
            <TokenImg value={prefs.bgImage} className="h-full w-full object-cover" />
          ) : (
            <span className="px-2 text-center text-[10px]" style={{ color: SKETCH_MUTED }}>纸底（默认）</span>
          )}
        </div>
        <div className="flex flex-1 flex-col gap-2">
          <div className="flex gap-2">
            <SketchButton
              tone="primary"
              accent={prefs.accent}
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="px-4 py-1.5 text-xs"
            >
              {uploading ? '贴上去…' : '选图'}
            </SketchButton>
            {prefs.bgImage && (
              <SketchButton onClick={() => onChange({ bgImage: undefined })} className="px-4 py-1.5 text-xs">
                清除
              </SketchButton>
            )}
          </div>
          <label className="flex items-center gap-2 text-[11px]" style={{ color: SKETCH_MUTED }}>
            纸纹浓度
            <input
              type="range"
              min={0}
              max={85}
              value={Math.round(prefs.bgDim * 100)}
              onChange={(e) => onChange({ bgDim: Number(e.target.value) / 100 })}
              className="flex-1"
              style={{ accentColor: prefs.accent }}
            />
          </label>
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          void pickImage(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      {uploadErr && <div className="mt-1 text-[11px]" style={{ color: '#A8452F' }}>{uploadErr}</div>}

      {/* 整体配色 */}
      <div className="mb-1 mt-4 text-xs font-bold" style={{ color: SKETCH_INK }}>整体配色（按钮 / 边框 / 气泡描边）</div>
      <div className="flex flex-wrap gap-2">
        {POMODORO_ACCENT_PRESETS.map((p) => swatch(p.value, prefs.accent === p.value, () => onChange({ accent: p.value }), p.name))}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <input
          value={customAccent}
          onChange={(e) => setCustomAccent(e.target.value)}
          placeholder="#C0563F 自定"
          maxLength={7}
          className="w-32 rounded-lg border px-2 py-1 text-xs outline-none"
          style={{ borderColor: SKETCH_LINE, background: SKETCH_PAPER, color: SKETCH_INK, borderRadius: '10px 12px 11px 13px / 12px 10px 13px 11px' }}
        />
        <SketchButton onClick={() => applyCustomColor('accent', customAccent)} className="px-3 py-1 text-xs">用这个</SketchButton>
      </div>

      {/* 水球颜色 */}
      <div className="mb-1 mt-4 text-xs font-bold" style={{ color: SKETCH_INK }}>水球颜色</div>
      <div className="flex flex-wrap gap-2">
        {POMODORO_WATER_PRESETS.map((p) => swatch(p.value, prefs.waterColor === p.value, () => onChange({ waterColor: p.value }), p.name))}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <input
          value={customWater}
          onChange={(e) => setCustomWater(e.target.value)}
          placeholder="#4FA8C9 自定"
          maxLength={7}
          className="w-32 rounded-lg border px-2 py-1 text-xs outline-none"
          style={{ borderColor: SKETCH_LINE, background: SKETCH_PAPER, color: SKETCH_INK, borderRadius: '10px 12px 11px 13px / 12px 10px 13px 11px' }}
        />
        <SketchButton onClick={() => applyCustomColor('waterColor', customWater)} className="px-3 py-1 text-xs">用这个</SketchButton>
      </div>
      {colorErr && <div className="mt-1 text-[11px]" style={{ color: '#A8452F' }}>{colorErr}</div>}

      {/* 消息模式 */}
      <div className="mb-1 mt-4 text-xs font-bold" style={{ color: SKETCH_INK }}>角色消息形态</div>
      <div className="grid grid-cols-3 gap-2">
        {MODE_OPTIONS.map(({ id, label, Icon, hint }) => {
          const active = prefs.messageMode === id;
          return (
            <button
              key={id}
              onClick={() => onChange({ messageMode: id })}
              className="flex flex-col items-center gap-0.5 px-2 py-2 transition active:scale-95"
              style={{
                background: active ? prefs.accent : SKETCH_PAPER,
                color: active ? SKETCH_PAPER : SKETCH_INK,
                border: active ? `2px solid ${prefs.accent}` : `2px dashed ${SKETCH_LINE}`,
                borderRadius: '12px 14px 13px 15px / 14px 12px 15px 13px',
              }}
            >
              <Icon className="h-4 w-4" weight="bold" />
              <span className="text-xs font-bold">{label}</span>
              <span className="text-[9px]" style={{ opacity: 0.75 }}>{hint}</span>
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-[11px]" style={{ color: SKETCH_MUTED }}>
        <Image className="h-3 w-3" />轻点底部悬浮球也能快速切换
      </div>
    </SketchBox>
  );
};

export default PomodoroSettings;
