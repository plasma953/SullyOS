# M1: 平台适配层 + Capacitor APK 产物线 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立平台适配层并在 GitHub Actions 上自动产出可安装的 SullyOS Android APK。

**Architecture:** 零依赖运行时探测层 `utils/platform.ts`（capacitor/tauri/web 三态）作为后续所有平台分流的唯一收口；引入 Capacitor 把现有 vite `dist` 包进 Android WebView 壳；CI 用 GitHub Actions 在 push-free 的手动触发下产出 debug 签名 APK artifact。本里程碑不触碰业务代码、不触碰 `worker/amsg/**`、不触碰语音线。

**Tech Stack:** TypeScript + Vitest、Capacitor（最新稳定 major，回退预案钉 7）、Gradle（Android 侧随 Capacitor 生成）、GitHub Actions（ubuntu-latest + temurin 21 + pnpm）。

**Spec:** `docs/superpowers/specs/2026-09-09-multiplatform-sync-design.md`（§2 平台适配层、§3 APK 线）

## Global Constraints

- 包管理只用 pnpm（仓库有 `pnpm-lock.yaml`），测试只跑 `pnpm vitest run`
- 本里程碑禁止修改：`worker/**`、`api/**`、任何聊天/语音业务组件；`types.ts` 若无必要不碰
- 含中文的文件一律用专用读写工具编辑，禁止 shell 重定向写文件；写完用字节扫描自查 U+FFFD（`EF BF BD`）
- commit message 用英文；每个 Task 末尾提交一次；若用户不希望自动提交，执行开始前说明
- Node 22（本机与 CI 一致）；pnpm 版本以执行期 `pnpm --version` 实测为准，并同步写入 CI 的 `pnpm/action-setup` `version` 输入

---

### Task 1: 平台适配层 `utils/platform.ts`

**Files:**
- Create: `utils/platform.ts`
- Create: `utils/platform.test.ts`

**Interfaces:**
- Consumes: 无（零依赖）
- Produces: `detectRuntime(): Runtime`（`'capacitor' | 'tauri' | 'web'`）、`isNativeApp(): boolean` —— Task 3 的 SW 处理与后续 M2-M5 全部依赖这两个函数名

- [ ] **Step 1: 写失败测试**

创建 `utils/platform.test.ts`：

```ts
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run utils/platform.test.ts`
Expected: FAIL（`Cannot find module './platform'` 或导出不存在）

- [ ] **Step 3: 最小实现**

创建 `utils/platform.ts`：

```ts
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
```

实现要点：用 `globalThis` 而非 `window`，使 node 与 jsdom 两种 vitest 环境均可测；`__TAURI_INTERNALS__` 是 Tauri 2 注入的全局，Tauri 1 为 `__TAURI__`，本项目按 Tauri 2 设计（spec §5.3），若将来引 Tauri 1 再扩展。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run utils/platform.test.ts`
Expected: PASS（8 个用例全绿）

- [ ] **Step 5: 提交**

```bash
git add utils/platform.ts utils/platform.test.ts
git commit -m "feat: add runtime platform detection layer"
```

---

### Task 2: 引入 Capacitor 并生成 Android 壳

**Files:**
- Modify: `package.json`（dependencies/devDependencies、scripts）
- Create: `capacitor.config.ts`
- Create: `android/**`（`npx cap add android` 生成，入库）
- Modify: `.gitignore`

**Interfaces:**
- Consumes: 无
- Produces: `android/` 目录（Gradle 工程）、`npx cap sync android` 可重复执行、npm script `cap:sync` —— Task 5 的 CI 与 M4 的 `src-tauri` 并行线都依赖 `dist` 产物路径约定

- [ ] **Step 1: 核查 vite 产物路径与 base**

Run: `rg -n "outDir|base:" vite.config.ts`
Expected: 记录 `build.outDir`（缺省即 `dist`）与 `base`（应为 `'/'` 或缺省）。**若 outDir 不是 `dist`**：`capacitor.config.ts` 的 `webDir` 用实测值；**若 base 是相对路径（如 `./`）**：改为 `'/'` 并跑 `pnpm build` + 现有测试确认无回归（Capacitor WebView 从根路径加载）。

- [ ] **Step 2: 安装依赖**

```bash
pnpm add @capacitor/core
pnpm add -D @capacitor/cli @capacitor/android
```

执行期规则：取当前最新稳定 major；随后跑 `pnpm build && npx cap --version` 确认 CLI 可用。**若 Android 侧 Gradle 同步报兼容性错误**（minSdk/AGP 冲突类），回退：`pnpm add @capacitor/core@7 && pnpm add -D @capacitor/cli@7 @capacitor/android@7` 重来。

- [ ] **Step 3: 创建配置**

创建 `capacitor.config.ts`：

```ts
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.sullyos.app',
  appName: 'SullyOS',
  webDir: 'dist',
};

export default config;
```

（`webDir` 按 Step 1 实测值；`appName` 若要与现 PWA 显示名一致，用 `rg -n "name" public/manifest.json` 实测后替换。）

- [ ] **Step 4: 生成 android 平台**

```bash
pnpm build
npx cap add android
npx cap sync android
```

Expected: `android/` 目录生成，`android/app/src/main/assets/public/` 内出现 dist 内容，sync 无报错。

- [ ] **Step 5: 更新 .gitignore**

在 `.gitignore` 末尾追加：

```gitignore
# Capacitor / Android build artifacts
android/app/build/
android/.gradle/
android/local.properties
android/app/src/main/assets/public/
android/capacitor-cordova-android-plugins/
```

（`android/app/src/main/assets/public/` 是 `cap sync` 重建产物，CI 流程保证先 sync 后构建，不入库以减 diff 噪音。）

- [ ] **Step 6: 提交**

```bash
git add package.json pnpm-lock.yaml capacitor.config.ts android .gitignore
git commit -m "feat: add Capacitor Android shell with generated platform"
```

---

### Task 3: SW 注册核查与处理

**Files:**
- Modify（条件触发）: SW 注册调用点（Step 1 定位）
- Modify: SW 调用点对应测试（若有）

**Interfaces:**
- Consumes: Task 1 的 `isNativeApp()`
- Produces: 原生 App 内 SW 不产生副作用；Web dev 形态行为不变

- [ ] **Step 1: 定位 SW 注册**

Run: `rg -n "serviceWorker|registerSW|workbox" src/ index.html vite.config.ts`
Expected: 记录命中的文件与行。**分三种情况处理：**

- **情况 A（无命中）**：本 Task 结束，无改动，跳过 Step 2-3，直接提交空变更或并入 Task 2（执行者在此打勾说明"无 SW"）。
- **情况 B（命中，注册代码在入口/模块内）**：进入 Step 2。
- **情况 C（vite-plugin-pwa 之类的插件）**：检查 `vite.config.ts` 插件配置，在 `VitePWA` 选项中加 `selfDestroying: true` 的原生分支不可行（构建期静态）——改为 Step 2 的运行时守卫包裹注册函数，并在 `pnpm build` 后确认 `dist/` 内 SW 文件存在与否不影响（保留文件、仅运行时不注册）。

**已知事实（2026-09-09 审查）**：仓库存在 `utils/keepAlive.ts:20` 注册 `public/sw-keep-alive.js`（amsg2 保活/推送 SW，`useChatAI.ts:6` 经 KeepAlive 类调用）。它属于情况 B 的潜在命中点。APK WebView（`https://localhost` origin）里该 SW **可注册但 push 事件永不可达**（WebView 无推送服务绑定），功能上等价"无推送"，与 spec §7.1 C2 结论一致——处理原则：**不删不改注册逻辑本身**（web/dev 形态仍用），只在 Step 1 记录其行为，冒烟（Task 5）验证启动路径无异常；push 订阅路径由既有 `describePushCapabilityGap()` 守卫优雅降级（`utils/activeMsgClient.ts:1276`）。

- [ ] **Step 2: 加运行时守卫（仅情况 B/C）**

在注册调用外层包裹（`import { isNativeApp } from '../utils/platform';` 路径按实际层级调整）：

```ts
if (!isNativeApp()) {
  navigator.serviceWorker.register('/sw.js');
}
```

（以实际命中的注册写法为准，保持参数不变，只加条件。）

- [ ] **Step 3: 跑全量测试确认无回归**

Run: `pnpm vitest run`
Expected: 全绿（若有钉死 SW 行为的测试，按守卫语义更新该测试用例）。

- [ ] **Step 4: 提交（情况 B/C 才有）**

```bash
git add -A
git commit -m "fix: guard service worker registration for native app runtimes"
```

---

### Task 4: GitHub Actions APK 产物线

**Files:**
- Create: `.github/workflows/build-apk.yml`
- Create: `docs/apk-build.md`

**Interfaces:**
- Consumes: Task 2 的 `android/` 与 `cap:sync` 能力、spec §3 的 workflow 定义
- Produces: 手动触发的 `Build APK` workflow，artifact 名 `sullyos-apk`

- [ ] **Step 1: 写 workflow**

创建 `.github/workflows/build-apk.yml`（pnpm `version` 输入填 Task 2 执行期实测的 `pnpm --version` 主版本，如 `9` 或 `10`）：

```yaml
name: Build APK
on:
  workflow_dispatch: {}
jobs:
  apk:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: 21
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - run: npx cap sync android
      - run: cd android && chmod +x gradlew && ./gradlew assembleDebug
      - uses: actions/upload-artifact@v4
        with:
          name: sullyos-apk
          path: android/app/build/outputs/apk/debug/app-debug.apk
```

- [ ] **Step 2: 写用户文档**

创建 `docs/apk-build.md`：Actions 页 → Build APK → Run workflow → 下载 `sullyos-apk` artifact → 手机安装（允许未知来源）→ 首次进入按 Web 版同流程配置 LLM/Worker。附一段「改完代码如何出新包」（跑同一 workflow）。文档用中文，与仓库其他 docs 风格一致。

- [ ] **Step 3: 推分支触发 CI 验收**

```bash
git add .github/workflows/build-apk.yml docs/apk-build.md
git commit -m "ci: add GitHub Actions APK build pipeline"
git push
```

在 GitHub 仓库 Actions 页手动运行 `Build APK`。
Expected: 全步骤绿，artifact 可下载。**若 gradle 步骤失败**：读日志分类——SDK 许可问题加 `ANDROID_SDK_ROOT` 与 `yes | sdkmanager --licenses` 步骤；内存问题给 gradle 加 `-Dorg.gradle.jvmargs=-Xmx2g`；Capacitor 版本兼容问题回退 Task 2 Step 2 的钉 7 预案。

- [ ] **Step 4: CI 失败修复循环直至绿**

（无固定代码步骤；每次修复后重跑 workflow，直到绿。）

---

### Task 5: 装机冒烟验收

**Files:**
- 无代码改动（验收任务；发现问题则修复后回到对应 Task 重走）

**Interfaces:**
- Consumes: Task 4 的 APK artifact
- Produces: M1 验收结论（写进本文件 checkbox 与执行会话记录）

- [ ] **Step 1: 下载 artifact 并安装到 Android 手机/平板**（允许未知来源安装）

- [ ] **Step 2: 冒烟清单逐项打勾**

1. App 打开进入虚拟手机 UI（桌面/图标正常渲染）
2. 导入或新建一个角色，进入聊天发一条消息，收到 LLM 回复（LLM/Worker 配置按 docs 原有流程）
3. 杀掉 App 进程后重开，角色与聊天记录仍在（IndexedDB 持久）
4. 设置页可打开、可改项，退出重进设置保留
5. 启动到聊天全程无推送相关崩溃（`describePushCapabilityGap` 守卫生效；主动消息设置区显示降级/不支持提示而非红屏报错）
6. 聊天与 MCP 链路在 capacitor origin 下连通：`capacitor://localhost`（或 `https://localhost`）origin 下发消息/调 MCP 工具成功；记录 `utils/networkFailureDiagnosis.ts` 的 `toSameOriginProxyUrl` 对该 origin 的实际行为（映射成功/返回 null），异常则回填 spec §7.1 C1

- [ ] **Step 3: 提交验收记录**

```bash
git add docs/superpowers/plans/2026-09-09-m1-capacitor-apk.md
git commit -m "docs: record M1 smoke acceptance"
```

（把冒烟结果写在本文档 Task 5 末尾追加的小节里：日期、设备型号、Android 版本、异常记录。）

---

## M1 完成定义

- [ ] `utils/platform.ts` 全测试绿并入主
- [ ] `android/` 壳入库，`npx cap sync android` 可重复
- [ ] Actions `Build APK` 绿，artifact APK 装机通过 Task 5 全部冒烟项
- [ ] Vercel Web 线未受影响（`pnpm build` 与现有测试全绿）

M2+M3（VPS 同步 API + 客户端引擎）与 M4+M5（Tauri + 桌面形态）的计划在本里程碑验收后按 spec §6 的节奏另行编写。
