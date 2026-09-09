export type Runtime = 'capacitor' | 'tauri' | 'web';

interface RuntimeGlobals {
  Capacitor?: { isNativePlatform?: boolean };
  __TAURI_INTERNALS__?: unknown;
}

export function detectRuntime(): Runtime {
  const g = globalThis as RuntimeGlobals;
  if (g.Capacitor?.isNativePlatform) return 'capacitor';
  if (g.__TAURI_INTERNALS__ != null) return 'tauri';
  return 'web';
}

export function isNativeApp(): boolean {
  const r = detectRuntime();
  return r === 'capacitor' || r === 'tauri';
}
