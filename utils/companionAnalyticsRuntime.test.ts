import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('静态陪伴与视频快照 Umami 埋点', () => {
  const appearance = readFileSync(path.resolve(__dirname, '../apps/Appearance.tsx'), 'utf8');
  const companion = readFileSync(path.resolve(__dirname, '../components/os/CompanionHome.tsx'), 'utf8');
  const call = readFileSync(path.resolve(__dirname, '../apps/CallApp.tsx'), 'utf8');

  it('埋点参数不包含文本、角色名、文件名或 Blob 引用', () => {
    const analyticsLines = [appearance, companion, call]
      .flatMap(source => source.split('\n'))
      .filter(line => line.includes('trackEvent(') || line.includes('来源:') || line.includes('形象:') || line.includes('模式:'));
    const payload = analyticsLines.join('\n');
    expect(payload).not.toMatch(/character\.name|selectedChar\.name|file\.name|imageRef|snapshot\.ref|\binput\b|assistantText/);
  });
});
