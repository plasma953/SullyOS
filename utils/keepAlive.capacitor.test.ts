import { describe, it, expect } from 'vitest';

// 钉住 M1 计划的要求：Capacitor 原生壳内不注册 keep-alive SW（WebView 里 SW 半支持，
// 注册了也是不可预期状态）。用正则钉 index.tsx 源码里的守卫（本仓库 wiring 测试惯例，
// 参照 apiPresetSwitch.wiring.test.ts 的源码正则钉法）。
describe('KeepAlive.init platform guard (wiring)', () => {
  it('index.tsx 在原生壳内跳过 KeepAlive SW 注册', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(path.resolve(__dirname, '../index.tsx'), 'utf-8');
    // 必须存在原生守卫（二选一的探测函数）
    expect(src).toMatch(/isNativeApp\(\)|detectCapacitorNative\(\)/);
    // KeepAlive.init 调用必须被守卫包住（不允许裸调用）
    const bareCall = /^\s*KeepAlive\.init\(\)/m;
    expect(bareCall.test(src)).toBe(false);
    expect(src).toContain('KeepAlive');
  });
});
