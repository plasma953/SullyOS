import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// 版本更新弹窗已下线：进站不再弹新功能介绍。
// 锁住：弹窗组件 / 队列 / PhoneShell 挂载点全部消失；
// 手册（FAQApp ↔ changelogs）的跳转常量与链接不受影响，继续可用。

const eventSource = () => readFileSync(path.resolve(__dirname, '../components/UpdateNotificationEvent.tsx'), 'utf8');
const shellSource = () => readFileSync(path.resolve(__dirname, '../components/PhoneShell.tsx'), 'utf8');

describe('版本更新弹窗已下线', () => {
  it('UpdateNotificationEvent 不再有弹窗组件与队列，只剩常量', () => {
    const source = eventSource();
    expect(source).not.toContain('UpdatePopup');
    expect(source).not.toContain('UPDATE_QUEUE');
    expect(source).not.toContain('UpdateNotificationController');
    expect(source).not.toContain('shouldShowUpdateNotification');
  });

  it('PhoneShell 不再触发、不再挂载更新弹窗', () => {
    const source = shellSource();
    expect(source).not.toContain('UpdateNotificationController');
    expect(source).not.toContain('shouldShowUpdateNotification');
    expect(source).not.toContain('showUpdateNotification');
  });

  it('手册跳转用的常量保留（FAQApp 还在用）', () => {
    const source = eventSource();
    expect(source).toContain("FAQ_TARGET_SECTION_KEY = 'sullyos_faq_target_section'");
    expect(source).toContain("CHANGELOG_2026_08_30 = 'changelog-2026-08-30'");
  });
});

describe('Live2D update notification references', () => {
  it('links the handbook collaboration entry to its detailed release note', () => {
    const faqSource = readFileSync(path.resolve(__dirname, '../apps/FAQApp.tsx'), 'utf8');
    const detailSource = readFileSync(path.resolve(__dirname, '../public/changelogs/2026-8-30.html'), 'utf8');
    expect(faqSource).toContain('id: CHANGELOG_2026_08_30');
    expect(faqSource).toContain("src: 'changelogs/2026-8-30.html'");
    expect(detailSource).toContain('ChatApp');
    expect(detailSource).toContain('设置 → 导出');
    expect(detailSource).toContain('长按删除');
  });

  it('keeps the handbook card and detail page linked to the same changelog id', () => {
    const faqSource = readFileSync(path.resolve(__dirname, '../apps/FAQApp.tsx'), 'utf8');
    const detailSource = readFileSync(path.resolve(__dirname, '../public/changelogs/2026-8-10.html'), 'utf8');

    expect(faqSource).toContain('id: CHANGELOG_2026_08_10');
    expect(faqSource).toContain("src: 'changelogs/2026-8-10.html'");
    expect(detailSource).toContain('新增视频通话');
    expect(detailSource).toContain('新增面向 L2D 的桌面主题');
  });
});
