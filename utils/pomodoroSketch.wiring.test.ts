/**
 * 番茄钟手绘风改造的接线测试：源码字符串断言，防止后续重构把链路改断。
 * （行为逻辑由 vitest 单测覆盖，这里只钉「谁引用了谁」。）
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string): string =>
  readFileSync(join(__dirname, '..', rel), 'utf8');

describe('pomodoro sketch wiring', () => {
  const app = read('apps/PomodoroApp.tsx');

  it('主界面挂载悬浮球、设置面板与热力图', () => {
    expect(app).toContain("from './pomodoro/CompanionBall'");
    expect(app).toContain("from './pomodoro/PomodoroSettings'");
    expect(app).toContain("from './pomodoro/UsageHeatmap'");
    expect(app).toContain("from './pomodoro/WaterBallSketch'");
    expect(app).toContain("from './pomodoro/SketchKit'");
    expect(app).toContain('<CompanionBall');
    expect(app).toContain('<UsageHeatmap');
  });

  it('计时态不再有惩罚弹窗，停止走轻确认 + 后台落库', () => {
    expect(app).not.toContain('punish &&');
    expect(app).not.toContain('handleAcceptPunish');
    expect(app).toContain('stopConfirm');
    expect(app).toContain('abortRun(session');
    expect(app).toContain("punishStatus: 'loading'");
  });

  it('鼓励按偏好走文字/语音/混合，语音失败回落文字', () => {
    expect(app).toContain('canSynthesizeSpeech');
    expect(app).toContain('synthesizeSpeechDetailed');
    expect(app).toContain('voice-unavailable');
    expect(app).toContain("prefsRef.current");
  });

  it('悬浮球轻点循环切换模式，位置持久化走 prefs', () => {
    const ball = read('apps/pomodoro/CompanionBall.tsx');
    expect(ball).toContain('onCycleMode');
    expect(ball).toContain('clampBubblePos');
    expect(ball).toContain('savePomodoroBallPos');
    expect(ball).toContain('loadPomodoroBallPos');
    expect(ball).toContain('setPointerCapture');
  });

  it('背景图走 blobref 管线，不写 base64', () => {
    const settings = read('apps/pomodoro/PomodoroSettings.tsx');
    expect(settings).toContain('processImageToBlob');
    expect(settings).toContain('putImageBlob');
    expect(app).toContain('useBlobRefUrl(prefs.bgImage)');
  });

  it('热力图聚合走纯函数，历史上限提到 500', () => {
    const session = read('utils/pomodoroSession.ts');
    expect(session).toContain('POMODORO_HISTORY_LIMIT = 500');
    expect(session).toContain('aggregateFocusByDay');
    const heat = read('apps/pomodoro/UsageHeatmap.tsx');
    expect(heat).toContain('aggregateFocusByDay');
    expect(heat).toContain('heatLevelOf');
  });

  it('手绘风禁区：主文件无玻璃模糊、无渐变、无纯白底', () => {
    expect(app).not.toContain('backdrop-blur');
    expect(app).not.toContain('bg-gradient-to');
    expect(app).not.toContain('bg-white');
    expect(app).not.toContain('text-white');
  });
});
