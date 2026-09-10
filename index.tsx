import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { installTranslateCrashGuard } from './utils/translateCrashGuard';
import { ActiveMsgRuntime } from './utils/activeMsgRuntime';
import { KeepAlive } from './utils/keepAlive';
import { ProactiveChat } from './utils/proactiveChat';
import { VRScheduler } from './utils/vrWorld/scheduler';
import { installIOSStandaloneWorkaround } from './utils/iosStandalone';
import { installWakeListener } from './utils/proactivePushConfig';
import { detectCapacitorNative } from './utils/pushSubscribeShared';
import { Capacitor } from '@capacitor/core';

// 默认构建不开启时 Rollup 会整段裁掉；普通浏览器/PWA 不加载原生插件、不申请权限。
if (import.meta.env.VITE_AMSG_NATIVE_PUSH === 'true' && Capacitor.isNativePlatform()) {
  if (Capacitor.getPlatform() === 'android') {
    void import('./utils/unifiedPushRuntime')
      .then(({ initUnifiedPushRuntime }) => initUnifiedPushRuntime())
      .catch((err) => console.warn('[UnifiedPush] module load failed:', err));
  } else {
    void import('./utils/nativeAmsgPush')
      .then(({ initNativeAmsgPush }) => initNativeAmsgPush())
      .catch((err) => console.warn('[NativePush] module load failed:', err));
  }
}

// Register the keep-alive Service Worker early so it's ready before any AI calls.
// 原生壳（APK/WKWebView）跳过：M1 计划 §已知事实 的既定结论——WebView 里 SW
// 可注册但 push 永不可达，注册即半工作状态。守卫后 .then 链照常执行（resume 们
// 不依赖 SW 本身，只依赖 init 已 settle）。
const runtimeBootstrap = detectCapacitorNative()
  ? Promise.resolve()
  : KeepAlive.init();
runtimeBootstrap.then(() => {
  // Resume any active proactive schedule after SW is ready
  ProactiveChat.resume();
  // Resume 「彼方」 autonomous-login schedules
  VRScheduler.resume();
  void ActiveMsgRuntime.init();
  // Record every wake the SW reports so the diagnostic panel can show "last received".
  installWakeListener();
});

installIOSStandaloneWorkaround();

// 本仓库无使用统计设施，不向任何服务器上报（2026-09-08 移除 umami 统计线）。

// 浏览器自动翻译 (Chrome/Edge 等) 会改动 React 托管的 DOM，导致 reconcile 时
// insertBefore/removeChild 抛 NotFoundError 白屏。挂载前先打护栏。详见该 util 注释。
installTranslateCrashGuard();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
