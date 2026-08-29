/**
 * Instant Push UI 退役守卫（源码级断言）。
 *
 * 旧版 Instant Push（自部署 CF Worker 那一代）已于 2026-08-27 停止接入，其设置面板、
 * 下线通知与 Worker 更新提醒整体退役——主动消息统一由「主动消息 2.0」（VPS 后端）承载。
 * 这里钉的是「别把退役做得不干净」：
 *   · 用户可见 UI 层不允许再出现 Instant Push 的配置入口 / 部署指引；
 *   · 运行时链路（useChatAI / instantPushClient）保留，存量用户聊天不受影响。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative: string) => readFileSync(resolve(here, relative), 'utf8');
/** 文件读不到才算退役干净（源文件被删）。 */
const gone = (relative: string): boolean => {
  try { read(relative); return false; } catch { return true; }
};

describe('Instant Push UI 退役守卫', () => {
  it('设置页不再有 Instant Push 配置入口', () => {
    const settingsSrc = read('../apps/Settings.tsx');
    expect(settingsSrc).not.toContain('InstantPushSettingsModal');
    expect(settingsSrc).not.toContain('title="Instant Push"');
  });

  it('设置面板与两个运维弹窗组件已整体删除', () => {
    expect(gone('../components/settings/InstantPushSettingsModal.tsx')).toBe(true);
    expect(gone('../components/InstantPushSunsetEvent.tsx')).toBe(true);
    expect(gone('../components/WorkerUpdateReminderEvent.tsx')).toBe(true);
  });

  it('PhoneShell 不再挂载下线通知 / Worker 更新提醒', () => {
    const shellSrc = read('../components/PhoneShell.tsx');
    expect(shellSrc).not.toContain('InstantPushSunsetController');
    expect(shellSrc).not.toContain('WorkerUpdateReminderController');
  });

  it('运行时链路保留（存量用户兜底）：useChatAI 仍读 Instant Push 配置', () => {
    const chatAiSrc = read('../hooks/useChatAI.ts');
    expect(chatAiSrc).toContain('isInstantConfigReady');
  });
});