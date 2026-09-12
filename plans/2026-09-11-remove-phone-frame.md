# 移除窗口化手机框 · 执行计划（2026-09-11）

> **执行者须知**：按步骤顺序执行；每步自带文件路径与现状行号（2026-09-11 扫描）。写文件只用 Write/Edit 工具；含中文的 oldString 只从 Read 工具输出逐字取。手机端与平板横竖屏行为不能变。

**Goal:** 删掉电脑端「窗口化仿真手机框」（`DesktopFrame`），只保留两态：够宽=电脑版 UI，否则手机 UI 铺满窗口。`desktopMode` 保留为布局强制开关，文案改为「自动 / 强制电脑版 / 强制手机版」。

**用户已拍板:** ①窄窗电脑显示手机 UI 铺满（不套框）；②保留 `desktopMode` 设置只改文案。

**Architecture:** `DesktopHost` 由三态（桌面全屏 / 窗口化手机框 / 透传）收成两态；`DesktopFrame`、`utils/desktopShell.ts` 及其测试整文件删除；`portalHost` / `hostViewport` 中只为框服务的分支与 setter 一并移除（不再有「框内坐标系/框内 portal 宿主」）。

---

## 一、会触碰的文件

- `components/desktop/DesktopHost.tsx`（重写）
- `components/desktop/DesktopFrame.tsx`（删除）
- `utils/desktopShell.ts`（删除）、`utils/desktopShell.test.ts`（删除）
- `utils/portalHost.ts`、`utils/portalHost.test.ts`（简化）
- `utils/hostViewport.ts`、`utils/hostViewport.test.ts`（简化）
- `apps/Appearance.tsx`（文案）
- `apps/Launcher.tsx`（清理死变量）
- `types.ts`（注释）
- `utils/buildInfo.ts`（版本号）
- `notes/ethernet-branch-context.md`、`plans/web-desktop-adaptation-2026-09-11.md`（补记）

## 二、步骤

### Task 1 `DesktopHost.tsx` 二态化
整文件替换为：

```tsx
import React from 'react';
import { useOS } from '../../context/OSContext';
import { useLayoutMode } from '../../utils/layoutMode';
import { DesktopBackdrop } from './DesktopBackdrop';

/**
 * 桌面外壳两态：
 *   1. desktop（宽 >= 1024 且高 >= 600，或用户强制）→ 全屏电脑版 UI（左侧 Dock 由 PhoneShell 内部渲染）；
 *   2. 其余（手机/平板竖屏/窄窗）→ 透传，手机 UI 铺满窗口。
 * 2026-09-11 起移除「窗口化手机框」仿真层，不再有居中金属外框。
 */
export const DesktopHost: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { theme } = useOS();
    const layoutMode = useLayoutMode(theme.desktopMode);

    if (layoutMode === 'desktop') {
        return (
            <div className="fixed inset-0 z-0 overflow-hidden bg-black">
                <DesktopBackdrop wallpaper={theme.wallpaper ?? ''} mode={theme.desktopBackdrop ?? 'blur'} />
                <div className="relative z-10 h-full w-full">{children}</div>
            </div>
        );
    }
    return <>{children}</>;
};
```

### Task 2 删除三个文件
`components/desktop/DesktopFrame.tsx`、`utils/desktopShell.ts`、`utils/desktopShell.test.ts`。
验收：`rg "DesktopFrame|desktopShell|resolveDesktopMode|useDesktopViewport" apps components utils` 零命中（历史 docs/plans/notes 不算）。

### Task 3 `portalHost` 简化
`utils/portalHost.ts` 整文件替换为：

```ts
/** 浮层统一挂到 document.body。2026-09-11 移除窗口化手机框后不再有「框内浮层宿主」。 */
export const getPortalHost = (): HTMLElement => document.body;
```

`utils/portalHost.test.ts` 整文件替换为：

```ts
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { getPortalHost } from './portalHost';

describe('portalHost', () => {
    it('返回 document.body', () => {
        expect(getPortalHost()).toBe(document.body);
    });
});
```

### Task 4 `hostViewport` 简化
`utils/hostViewport.ts` 整文件替换为：

```ts
export interface HostGeometry {
    /** fixed 定位坐标系原点（无处不 0：一律按可视窗口算）。 */
    ox: number;
    oy: number;
    /** 可用宽高（可视窗口；visualViewport 优先，与既有写法一致）。 */
    W: number;
    H: number;
}

/**
 * fixed 定位 + client 坐标换算的唯一入口。
 * 2026-09-11 移除窗口化手机框后不再有「框内坐标系」，统一回落可视窗口。
 */
export const getHostGeometry = (el?: Element | null): HostGeometry => {
    const view = el?.ownerDocument?.defaultView ?? (typeof window !== 'undefined' ? window : undefined);
    if (!view) return { ox: 0, oy: 0, W: 0, H: 0 };
    const vv = (view as Window).visualViewport;
    return { ox: 0, oy: 0, W: Math.round(vv?.width ?? view.innerWidth), H: Math.round(vv?.height ?? view.innerHeight) };
};
```

`utils/hostViewport.test.ts`：删框坐标系用例与 `SULLY_VIEWPORT_ATTR` 导入，只留「按 window 尺寸」用例（中文注释以 Read 实际内容为准，可保留原第二用例的测试名）。

### Task 5 文案与注释
- `apps/Appearance.tsx:1318-1321` 三档：
  - `{ id: 'auto', label: '自动', hint: '按窗口切换', icon: '◐' }`
  - `{ id: 'on', label: '强制电脑版', hint: '窄窗也用', icon: '▣' }`
  - `{ id: 'off', label: '强制手机版', hint: '宽窗也用', icon: '—' }`
- `apps/Appearance.tsx:1360-1362` 说明改：`窗口宽 ≥ 1024 且高 ≥ 600 时自动用电脑版布局；手机与平板竖屏不受影响。`
- `types.ts:294` 注释改：`/** 桌面端布局模式：auto = 按窗口尺寸自动（宽>=1024 且高>=600 用电脑版）；on/off = 强制电脑版/手机版。默认 auto（undefined 视为 auto）。 */`
- `types.ts:296` 注释改：`/** 电脑版布局背景：blur = 当前壁纸模糊放大（默认）；color = 壁纸主色调纯色。 */`
- `apps/Launcher.tsx:1088`：`'--app-icon-size': 'clamp(2.75rem, calc((var(--vp-width, 100vw) - 6.5rem) / 4), 3.5rem)'` → `'--app-icon-size': 'clamp(2.75rem, calc((100vw - 6.5rem) / 4), 3.5rem)'`。

### Task 6 文档与版本
- `notes/ethernet-branch-context.md` 末尾追加条目（背景、删了什么、门禁数字、是否 push）。
- `plans/web-desktop-adaptation-2026-09-11.md` 末尾补一行：窗口化手机框已删除，窄窗电脑直接铺满手机 UI；`desktopMode` 保留为布局强制开关并改文案。
- `utils/buildInfo.ts:17` → `v3.15 (Frameless)`。

## 三、验收

```powershell
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
corepack pnpm@9.15.9 vitest run
node_modules\.bin\tsc.CMD --noEmit -p tsconfig.json   # 触碰文件零新增
corepack pnpm@9.15.9 vitest run utils/mojibakeGuard.test.ts
node_modules\.bin\vite.CMD build
```

手动（用户，Vercel）：宽窗=电脑版；900×700 及更窄=手机 UI 铺满无框；外观三档开关行为正确；窄窗下聊天等浮层位置正常（body 承载）；手机/平板行为不变。
另：`rg "DesktopFrame|desktopShell|setPortalHost|SULLY_VIEWPORT_ATTR" apps components utils` 零命中（测试计数会因删除 desktopShell.test 少 1 文件）。

## 四、边界

- 不改 `layoutMode` 的 1024×600 判定、平板横竖屏行为、`DesktopDock`/桌面主页/`DesktopBackdrop`。
- 不删 `desktopMode` 字段与设置卡；历史 spec/计划文档不改写。

---

## 执行状态（2026-09-11）

- ✅ Task 1 `DesktopHost.tsx` 二态化；✅ Task 2 删除 `DesktopFrame.tsx` / `utils/desktopShell.ts` / `utils/desktopShell.test.ts`；✅ Task 3/4 `portalHost` / `hostViewport` 简化 + 测试同步；✅ Task 5 Appearance 文案 / types 注释 / Launcher 死变量；✅ Task 6 notes、web-desktop 计划补记、`v3.15 (Frameless)`。
- ✅ 死引用清零：`rg "DesktopFrame|desktopShell|resolveDesktopMode|useDesktopViewport|setPortalHost|SULLY_VIEWPORT_ATTR|--vp-width" apps components utils` 零命中。
- ✅ 门禁：全量 428 文件 / 5084 用例全绿；`tsc --noEmit` 45 存量错误、触碰文件零命中；mojibake 绿；触碰文件 FFFD/BOM 0；`vite build` 通过。
- 提交与 push 见仓库记录（供 Vercel 实测）。
