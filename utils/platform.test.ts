import { describe, it, expect, vi, beforeEach } from 'vitest';
import { detectRuntime, isNativeApp } from './platform';

describe('detectRuntime', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('无平台痕迹时返回 web', () => {
    expect(detectRuntime()).toBe('web');
  });

  it('Capacitor 原生环境返回 capacitor', () => {
    vi.stubGlobal('Capacitor', { isNativePlatform: true });
    expect(detectRuntime()).toBe('capacitor');
  });

  it('Capacitor 浏览器环境不算原生', () => {
    vi.stubGlobal('Capacitor', { isNativePlatform: false });
    expect(detectRuntime()).toBe('web');
  });

  it('Tauri 环境返回 tauri', () => {
    vi.stubGlobal('__TAURI_INTERNALS__', { metadata: { currentWindow: { label: 'main' } } });
    expect(detectRuntime()).toBe('tauri');
  });
});

describe('isNativeApp', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('web 环境为 false', () => {
    expect(isNativeApp()).toBe(false);
  });

  it('capacitor 与 tauri 均为 true', () => {
    vi.stubGlobal('Capacitor', { isNativePlatform: true });
    expect(isNativeApp()).toBe(true);
    vi.unstubAllGlobals();
    vi.stubGlobal('__TAURI_INTERNALS__', {});
    expect(isNativeApp()).toBe(true);
  });
});
