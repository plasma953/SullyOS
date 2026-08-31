// 多桥注册表 —— 读兼容与写归一两条规则钉住。
import { describe, it, expect } from 'vitest';
import { getEffectiveBridges, normalizeBridges, makeBridgeId } from './bridgeRegistry';
import type { APIConfig, BridgeConfig } from '../types';

describe('getEffectiveBridges', () => {
  it('bridges 数组优先，旧 bridge 单桥被忽略', () => {
    const list: BridgeConfig[] = [{ id: 'a', name: 'A', url: 'https://a.example', enabled: true }];
    const cfg = { bridges: list, bridge: { url: 'https://old.example', enabled: true } } as APIConfig;
    expect(getEffectiveBridges(cfg)).toEqual(list);
  });

  it('无 bridges 时回退旧 bridge 单桥（老配置零迁移）', () => {
    const cfg = { bridge: { url: 'https://old.example', enabled: true } } as APIConfig;
    const out = getEffectiveBridges(cfg);
    expect(out).toHaveLength(1);
    expect(out[0].url).toBe('https://old.example');
  });

  it('两者皆空返回空数组', () => {
    expect(getEffectiveBridges({} as APIConfig)).toEqual([]);
  });
});

describe('normalizeBridges', () => {
  it('补 id / 丢空行 / 归一 url 尾斜杠与默认健康路径', () => {
    const out = normalizeBridges([
      { name: '', url: 'https://a.example/', enabled: true },
      { name: 'x', url: '   ', enabled: true },
    ] as BridgeConfig[])!;
    expect(out).toHaveLength(1);
    expect(out[0].id).toMatch(/^bridge_/);
    expect(out[0].name).toBe('未命名桥');
    expect(out[0].url).toBe('https://a.example');
    expect(out[0].healthPath).toBe('/');
  });

  it('id 冲突去重，禁用态与 token 保留', () => {
    const id = makeBridgeId();
    const out = normalizeBridges([
      { id, name: 'A', url: 'https://a.example', token: ' tk ', enabled: false },
      { id, name: 'B', url: 'https://b.example', enabled: true },
    ] as BridgeConfig[])!;
    expect(out).toHaveLength(2);
    expect(out[0].id).toBe(id);
    expect(out[1].id).not.toBe(id);
    expect(out[0].token).toBe('tk');
    expect(out[0].enabled).toBe(false);
  });

  it('非数组入参返回 undefined（不误清配置）', () => {
    expect(normalizeBridges(undefined)).toBeUndefined();
    expect(normalizeBridges(null)).toBeUndefined();
  });
});
