# Desktop Shell Phase 1（桌面外壳）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 宽屏鼠标浏览器自动把 SullyOS 装进仿真手机外框（灵动岛旗舰风），框外背景为模糊壁纸或主色纯色；手机端行为零变化。

**Architecture:** 新增 `components/desktop/` 外壳层包住现有 `PhoneShell`（内部不动）；判定/portal 宿主/视口读取做成 `utils/` 纯函数 + 薄 hook；`OSTheme` 加两字段走现有 `updateTheme` 持久化。

**Tech Stack:** React + TS + Vite + Tailwind（与仓库一致）；测试 `corepack pnpm@9.15.9 vitest run <file>`。

**Spec:** `docs/superpowers/specs/2026-09-06-desktop-shell-design.md`（§3-§6、§8、§9 桌面部分）

## Global Constraints

- ethernet 分支上开发，不建新分支；commit 身份 plasma953；英文 commit message；每次只 `git add` 真正动过的文件（工作区有 CRLF 噪音）。
- 写文件只用 Write/Edit（UTF-8 无 BOM）；含中文 oldString 只从 Read 输出取，不从 bash 输出复制；bash 参数避免中文；动过含中文文件后跑 `utils/mojibakeGuard.test.ts`。
- 本次触碰的文件在 `tsc --noEmit` 输出里零命中（全仓另有 48 个存量错误，与本次无关）。
- UI 沿用 `apps/Appearance.tsx` 现有选项卡片样式（`rounded-2xl border` + active 态 `border-primary bg-primary/10`），不引入新视觉语言。
- 埋点只进 `utils/analyticsSnapshot.ts` 快照，属性为写死枚举；改完在 `docs/analytics.md` 事件清单补行。
- vitest 默认 node 环境；需要 DOM 的测试文件首行加 `// @vitest-environment jsdom`（先例 `utils/appIcon.test.ts`）。

---

### Task 1: OSTheme 加 desktopMode / desktopBackdrop 字段

**Files:**
- Modify: `types.ts:161-164`（紧随 `statusBarMode` 之后）
- Test: tsc scoped check（类型字段无独立单测）

**Interfaces:**
- Consumes: 现有 `OSTheme`（`types.ts:119-213`）
- Produces: `DesktopMode = 'auto' | 'on' | 'off'`、`DesktopBackdrop = 'blur' | 'color'`，`OSTheme.desktopMode?`、`OSTheme.desktopBackdrop?`（缺省分别按 `auto` / `blur` 解释，不写迁移）

- [ ] **Step 1: 加字段**

```ts
/** 桌面端显示模式：auto = 宽屏鼠标自动进手机框；on/off = 强制开/关。默认 auto（undefined 视为 auto）。 */
desktopMode?: 'auto' | 'on' | 'off';
/** 桌面模式框外背景：blur = 当前壁纸模糊放大（默认）；color = 壁纸主色调纯色。 */
desktopBackdrop?: 'blur' | 'color';
```

- [ ] **Step 2: tsc 验证零命中**

Run: `corepack pnpm@9.15.9 exec tsc --noEmit 2>&1 | Select-String -Pattern 'types\.ts'`
Expected: 无输出（`types.ts` 零命中；其他文件的存量错误忽略）

- [ ] **Step 3: Commit**

```bash
git add types.ts
git commit -m "feat(desktop): add desktopMode/desktopBackdrop theme fields"
```

### Task 2: 桌面判定 utils/desktopShell.ts + 单测

**Files:**
- Create: `utils/desktopShell.ts`
- Create: `utils/desktopShell.test.ts`
- Test: `utils/desktopShell.test.ts`

**Interfaces:**
- Consumes: `OSTheme['desktopMode']`
- Produces: `isDesktopViewport(width: number, height: number, pointerFine: boolean): boolean`、`resolveDesktopMode(mode: 'auto'|'on'|'off'|undefined, viewport: {width,height,pointerFine}): boolean`、`useDesktopViewport(): {width,height,pointerFine}`（hook，监听 resize；实现用 `window.innerWidth/innerHeight` + `matchMedia('(pointer: fine)')`，SSR 防御 `typeof window === 'undefined'`）

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { isDesktopViewport, resolveDesktopMode } from './desktopShell';

describe('isDesktopViewport', () => {
    it('宽屏鼠标判定为桌面', () => {
        expect(isDesktopViewport(1920, 1080, true)).toBe(true);
    });
    it('窄屏/触屏/矮窗口不判定', () => {
        expect(isDesktopViewport(390, 844, false)).toBe(false);
        expect(isDesktopViewport(1920, 1080, false)).toBe(false);
        expect(isDesktopViewport(1920, 500, true)).toBe(false);
        expect(isDesktopViewport(800, 900, true)).toBe(false);
    });
    it('边界 900x600 通过', () => {
        expect(isDesktopViewport(900, 600, true)).toBe(true);
    });
});

describe('resolveDesktopMode', () => {
    const vp = { width: 1920, height: 1080, pointerFine: true };
    it('on 强制开，off 强制关，auto/undefined 跟随视口', () => {
        expect(resolveDesktopMode('on', { width: 390, height: 844, pointerFine: false })).toBe(true);
        expect(resolveDesktopMode('off', vp)).toBe(false);
        expect(resolveDesktopMode('auto', vp)).toBe(true);
        expect(resolveDesktopMode(undefined, vp)).toBe(true);
        expect(resolveDesktopMode('auto', { width: 390, height: 844, pointerFine: false })).toBe(false);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm@9.15.9 vitest run utils/desktopShell.test.ts`
Expected: FAIL（module not found）

- [ ] **Step 3: Write minimal implementation**

```ts
import { useEffect, useState } from 'react';

export interface DesktopViewport { width: number; height: number; pointerFine: boolean; }

export const DESKTOP_MIN_WIDTH = 900;
export const DESKTOP_MIN_HEIGHT = 600;

export const isDesktopViewport = (width: number, height: number, pointerFine: boolean): boolean =>
    pointerFine && width >= DESKTOP_MIN_WIDTH && height >= DESKTOP_MIN_HEIGHT;

export const resolveDesktopMode = (
    mode: 'auto' | 'on' | 'off' | undefined,
    vp: DesktopViewport,
): boolean => {
    if (mode === 'on') return true;
    if (mode === 'off') return false;
    return isDesktopViewport(vp.width, vp.height, vp.pointerFine);
};

const readViewport = (): DesktopViewport => ({
    width: typeof window === 'undefined' ? 0 : window.innerWidth,
    height: typeof window === 'undefined' ? 0 : window.innerHeight,
    pointerFine: typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: fine)').matches,
});

export const useDesktopViewport = (): DesktopViewport => {
    const [vp, setVp] = useState<DesktopViewport>(readViewport);
    useEffect(() => {
        const onResize = () => setVp(readViewport());
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);
    return vp;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm@9.15.9 vitest run utils/desktopShell.test.ts`
Expected: PASS（全部 4 条）

- [ ] **Step 5: Commit**

```bash
git add utils/desktopShell.ts utils/desktopShell.test.ts
git commit -m "feat(desktop): viewport detection and mode resolution"
```

### Task 3: portal 宿主 utils/portalHost.ts + 17 处替换

**Files:**
- Create: `utils/portalHost.ts`
- Create: `utils/portalHost.test.ts`（首行 `// @vitest-environment jsdom`）
- Modify（`document.body` → `getPortalHost()`，共 17 处）: `components/Amsg2DebugPanel.tsx:415`、`apps/Chat.tsx:3920,4586`、`apps/GroupChat.tsx:2379`、`components/events/qixi/QixiDemoEvent.tsx:1436`、`components/voice/VoiceFavoriteActionSheet.tsx:46`、`components/chat/ChatHeaderShell.tsx:545`、`components/chat/VoiceFavoritesPortal.tsx:484`、`components/chat/MemoryRepairPortal.tsx:747`、`components/date/story/StoryTheaterTheme.tsx:242`、`components/chat/McpMemoryModal.tsx:151`、`components/schedule/ScheduleAppearanceButton.tsx:344`、`components/journal/JournalAppearanceEditor.tsx:494,553,582`、`components/os/TamagotchiHome.tsx:1265`
- Test: `utils/portalHost.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `setPortalHost(el: HTMLElement | null): void`、`getPortalHost(): HTMLElement`（未设置时返回 `document.body`，手机路径行为不变）

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { getPortalHost, setPortalHost } from './portalHost';

describe('portalHost', () => {
    afterEach(() => setPortalHost(null));
    it('默认返回 document.body', () => {
        expect(getPortalHost()).toBe(document.body);
    });
    it('设置后返回宿主，清空后恢复', () => {
        const host = document.createElement('div');
        setPortalHost(host);
        expect(getPortalHost()).toBe(host);
        setPortalHost(null);
        expect(getPortalHost()).toBe(document.body);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm@9.15.9 vitest run utils/portalHost.test.ts`
Expected: FAIL（module not found）

- [ ] **Step 3: Write minimal implementation**

```ts
let host: HTMLElement | null = null;

/** 桌面模式由 DesktopFrame 设为框内浮层容器；PiP 期间设为 PiP 文档 body。null = 回落 document.body。 */
export const setPortalHost = (el: HTMLElement | null): void => { host = el; };

export const getPortalHost = (): HTMLElement => {
    if (host && host.isConnected) return host;
    if (typeof document !== 'undefined' && document.body) return document.body;
    return host as unknown as HTMLElement;
};
```

注：`isConnected` 防御宿主被卸载后 portal 丢进游离节点；node 环境无 document 时回退（测试外永不触发）。

- [ ] **Step 4: 替换 17 处调用点**：每处把 `document.body`（仅 portal 目标参数位）换成 `getPortalHost()` 并加 `import { getPortalHost } from '../../utils/portalHost'`（按各文件相对路径调整）。`utils/iosStandalone.ts:15` 的 `document.body` 是存在性检查，**不要动**。

- [ ] **Step 5: Run tests + tsc**

Run: `corepack pnpm@9.15.9 vitest run utils/portalHost.test.ts`
Expected: PASS
Run: `corepack pnpm@9.15.9 exec tsc --noEmit 2>&1 | Select-String -Pattern 'portalHost|Chat\.tsx|GroupChat|DebugPanel|Portal|Modal|ScheduleAppearanceButton|JournalAppearanceEditor|TamagotchiHome|StoryTheaterTheme|VoiceFavorite|ChatHeader'`
Expected: 无输出

- [ ] **Step 6: Commit**

```bash
git add utils/portalHost.ts utils/portalHost.test.ts components/Amsg2DebugPanel.tsx apps/Chat.tsx apps/GroupChat.tsx components/events/qixi/QixiDemoEvent.tsx components/voice/VoiceFavoriteActionSheet.tsx components/chat/ChatHeaderShell.tsx components/chat/VoiceFavoritesPortal.tsx components/chat/MemoryRepairPortal.tsx components/date/story/StoryTheaterTheme.tsx components/chat/McpMemoryModal.tsx components/schedule/ScheduleAppearanceButton.tsx components/journal/JournalAppearanceEditor.tsx components/os/TamagotchiHome.tsx
git commit -m "feat(desktop): route body portals through getPortalHost"
```

### Task 4: hostViewport 读取统一

**Files:**
- Create: `utils/hostViewport.ts`
- Create: `utils/hostViewport.test.ts`（首行 `// @vitest-environment jsdom`）
- Modify（`window.innerWidth/innerHeight` 布局读取改走 `getHostViewport(el).width/height`）: `components/DevDebugPanel.tsx`、`components/Amsg2DebugPanel.tsx`、`components/appearance/ChatAppearanceEditor.tsx:424`、`apps/ThemeMaker.tsx:542`、`components/call/Live2DActionSettings.tsx:67`、`components/call/Live2DAvatarCanvas.tsx`（7 处画布尺寸）、`apps/DateApp.tsx:974`、`components/journal/JournalAppearanceEditor.tsx`、`components/Amsg2DebugPanel.tsx`。只改**布局尺寸读取**，`utils/iosStandalone.ts` 的视口变量逻辑**不要动**。
- Test: `utils/hostViewport.test.ts`

**Interfaces:**
- Consumes: 框内屏幕区容器带 `data-sully-viewport` 属性（Task 6 提供）
- Produces: `getHostViewport(el: Element | null): { width: number; height: number }`（沿祖先找最近 `[data-sully-viewport]` 取 `getBoundingClientRect`；找不到回退 `ownerDocument.defaultView` 的 innerWidth/innerHeight；再无回退 `{0,0}`）

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { getHostViewport } from './hostViewport';

describe('getHostViewport', () => {
    it('框内元素返回框尺寸而非 window', () => {
        const frame = document.createElement('div');
        frame.setAttribute('data-sully-viewport', '');
        Object.defineProperty(frame, 'getBoundingClientRect', {
            value: () => ({ width: 393, height: 852 }),
        });
        const inner = document.createElement('div');
        frame.appendChild(inner);
        document.body.appendChild(frame);
        expect(getHostViewport(inner)).toEqual({ width: 393, height: 852 });
        frame.remove();
    });
    it('框外回退 window 尺寸', () => {
        const size = getHostViewport(document.body);
        expect(size.width).toBe(window.innerWidth);
        expect(size.height).toBe(window.innerHeight);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm@9.15.9 vitest run utils/hostViewport.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

```ts
export interface HostViewportSize { width: number; height: number; }

export const SULLY_VIEWPORT_ATTR = 'data-sully-viewport';

export const getHostViewport = (el: Element | null): HostViewportSize => {
    const host = el?.closest?.(`[${SULLY_VIEWPORT_ATTR}]`) ?? null;
    if (host) {
        const rect = host.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
            return { width: Math.round(rect.width), height: Math.round(rect.height) };
        }
    }
    const view = el?.ownerDocument?.defaultView ?? (typeof window !== 'undefined' ? window : undefined);
    if (view) return { width: view.innerWidth, height: view.innerHeight };
    return { width: 0, height: 0 };
};
```

- [ ] **Step 4: 替换布局读取点**：每个调用点需要一个就近 DOM 锚点（已有 ref 优先，否则用 `document.activeElement` 兜底——框内聚焦元素一定在框里；拖拽面板用面板自身 ref）。语义保持 clamp 不变，只换尺寸来源。

- [ ] **Step 5: Run tests + tsc scoped check**（模式同 Task 3 Step 5，文件名换成 hostViewport 相关）

- [ ] **Step 6: Commit**

```bash
git add utils/hostViewport.ts utils/hostViewport.test.ts <实际改动的文件>
git commit -m "feat(desktop): host-aware viewport size reads"
```

### Task 5: dominantHue 代表色扩展 + 单测

**Files:**
- Modify: `utils/dominantHue.ts`（追加，不动现有三个导出）
- Create: `utils/dominantHue.representative.test.ts`（node 环境，纯函数部分）
- Test: 同上

**Interfaces:**
- Consumes: 现有 `rgbToHsl`、`hslToHex`、`dominantHueOfPixels`、`hueFromImage`、`hueFromGradient`
- Produces: `representativeColorOfPixels(data: Uint8ClampedArray): string | null`（众数桶内像素平均 RGB → `#rrggbb`；全灰/透明返回 null）、`representativeColorFromImage(url: string): Promise<string | null>`（24×24 采样复用现有模式）、`representativeColorFromWallpaper(wallpaper: string): Promise<string | null>`（`http/blob:/data:` 走 image，`#`/`linear-gradient` 走 gradient 解析取平均色，其余 null；调用方落回默认纸色）

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { representativeColorOfPixels, representativeColorFromWallpaper } from './dominantHue';

const solidPixels = (r: number, g: number, b: number, n = 24 * 24): Uint8ClampedArray => {
    const data = new Uint8ClampedArray(n * 4);
    for (let i = 0; i < n; i++) { data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = 255; }
    return data;
};

describe('representativeColorOfPixels', () => {
    it('纯红返回红色系 hex', () => {
        const c = representativeColorOfPixels(solidPixels(220, 40, 40));
        expect(c).toMatch(/^#[0-9a-f]{6}$/);
        const r = parseInt(c!.slice(1, 3), 16);
        expect(r).toBeGreaterThan(150);
    });
    it('全灰/全透明返回 null', () => {
        expect(representativeColorOfPixels(solidPixels(200, 200, 200))).toBeNull();
        expect(representativeColorOfPixels(solidPixels(10, 10, 10))).toBeNull();
        const t = solidPixels(220, 40, 40);
        for (let i = 3; i < t.length; i += 4) t[i] = 0;
        expect(representativeColorOfPixels(t)).toBeNull();
    });
});

describe('representativeColorFromWallpaper', () => {
    it('渐变串提取平均色', async () => {
        const c = await representativeColorFromWallpaper('linear-gradient(135deg,#d23c3c,#7a1f1f)');
        expect(c).toMatch(/^#[0-9a-f]{6}$/);
    });
    it('空串返回 null', async () => {
        await expect(representativeColorFromWallpaper('')).resolves.toBeNull();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm@9.15.9 vitest run utils/dominantHue.representative.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**（桶逻辑复用 `dominantHueOfPixels` 的 24 桶划分与灰度过滤，众数桶内累加 RGB 求平均后转 hex；gradient 路径解析 hex 取饱和度加权平均 RGB；image 路径复刻 `hueFromImage` 的 canvas 采样骨架）

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm@9.15.9 vitest run utils/dominantHue.representative.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add utils/dominantHue.ts utils/dominantHue.representative.test.ts
git commit -m "feat(desktop): representative color extraction for backdrop"
```

### Task 6: DesktopHost / DesktopFrame / DesktopBackdrop 组件 + App 接线

**Files:**
- Create: `components/desktop/DesktopBackdrop.tsx`（props: `wallpaper: string; mode: 'blur'|'color'`；color 模式用 Task 5 API 取色并缓存，失败回落默认纸色；blur 模式 `filter: blur(60px) brightness(.7) saturate(1.2)` + `scale(1.1)`）
- Create: `components/desktop/DesktopFrame.tsx`（props: `children`；外框 bezel + 灵动岛 + 侧键 + 投影；屏幕区 `data-sully-viewport` + `transform: translateZ(0)` + inline 覆写 `--app-height/--safe-top:0/--chrome-top`；内含 portal 宿主 div 并 `setPortalHost` 注册/清理）
- Create: `components/desktop/DesktopHost.tsx`（props: `children`；读 `useDesktopViewport()` + `useOS().theme`，`resolveDesktopMode` 决定是否进框；非桌面直接 render children）
- Modify: `App.tsx`（`OSProvider` 内、`MusicProvider` 外包 `DesktopHost`，`PhoneShell` 作 children；其余不动）
- Test: 本仓库不收 React 组件测试（vitest exclude 思路见 vitest.config.ts）；验证 = tsc scoped + 手动清单（Task 9）

**Interfaces:**
- Consumes: Task 2（`useDesktopViewport`、`resolveDesktopMode`）、Task 3（`setPortalHost`）、Task 5（`representativeColorFromWallpaper`）、`useOS().theme`
- Produces: `<DesktopHost><PhoneShell/></DesktopHost>`；框内屏幕区纵横比 393:852，高度 `min(92vh, 940px)`，宽度按比例，窄窗按宽收缩（`max-width: 94vw` + aspect-ratio 保持）

- [ ] **Step 1: 写 DesktopBackdrop**（壁纸 `backgroundImage` 复用 `PhoneShell` 的 `getBgStyle` 判定规则：url 前缀走 `url()` 否则原样；不要复制函数，import 它——若未导出则在 PhoneShell 内导出）
- [ ] **Step 2: 写 DesktopFrame**（纯 CSS；灵动岛 `pointer-events-none`；portal 宿主 `position:fixed; inset:0; pointer-events:none`，子 portal 自带 pointer-events）
- [ ] **Step 3: 写 DesktopHost + App.tsx 接线**
- [ ] **Step 4: tsc scoped check**（`Desktop|App\.tsx` 零命中）+ `pnpm dev` 目测手机端无变化（窄窗）
- [ ] **Step 5: Commit**

```bash
git add components/desktop App.tsx components/PhoneShell.tsx
git commit -m "feat(desktop): desktop frame shell with backdrop"
```

注：若 `getBgStyle` 需从 PhoneShell 导出，PhoneShell 的改动仅加 `export` 关键字。

### Task 7: Appearance 设置 UI + 快照埋点 + 文档

**Files:**
- Modify: `apps/Appearance.tsx`（系统主题 tab，Status Bar section 之后加「电脑显示」section：desktopMode 三选项 auto/on/off + desktopBackdrop 两选项 blur/color，复用 L1293-1321 选项卡片模式；`updateTheme` 调用）
- Modify: `utils/analyticsSnapshot.ts`（`collectAppearance` 桌面分组追加 `电脑显示: theme.desktopMode ?? 'auto'`、`电脑背景: theme.desktopBackdrop ?? 'blur'`）
- Modify: `docs/analytics.md`（当前外观清单补两项）
- Test: `utils/analyticsSnapshot.test.ts`（跑通；若有精确键集合断言则同步更新）

**Interfaces:**
- Consumes: Task 1 字段、Task 6 组件
- Produces: 设置 UI；快照新字段（写死枚举，无毒药需求——非用户输入）

- [ ] **Step 1: 加 Appearance section**（选项定义 `{ id, label, hint }`：auto「自动进框/宽屏鼠标生效」、on「强制进框」、off「永不进框」；blur「模糊壁纸」、color「主色纯色」。移动端窄屏下该 section 照常显示但注明仅宽屏生效）
- [ ] **Step 2: 加快照字段 + 文档补行**
- [ ] **Step 3: Run tests**

Run: `corepack pnpm@9.15.9 vitest run utils/analyticsSnapshot.test.ts utils/analytics.test.ts`
Expected: PASS（如有键集合断言失败，按实际补齐后重跑）

- [ ] **Step 4: Commit**

```bash
git add apps/Appearance.tsx utils/analyticsSnapshot.ts docs/analytics.md
git commit -m "feat(desktop): appearance settings and snapshot fields"
```

### Task 8: vw/vh 字面量审计转换

**Files:**
- Modify: 约 40 文件中的外壳内部 `100vw/100vh`（清单：`components/Like520Event.tsx`、`apps/Chat.tsx`、`components/os/CompanionHome.tsx`、`components/novel/NovelWriter.tsx`、`apps/theater/TheaterPanel.tsx`、`apps/ThemeMaker.tsx`、`apps/GuidebookApp.tsx`、`apps/Settings.tsx`、`components/call/Live2DActionSettings.tsx`、`components/chat/ChatModals.tsx`、`components/journal/JournalAppearanceEditor.tsx`、`apps/NovelApp.tsx`、`components/chat/MemoryRepairPortal.tsx`、`components/appearance/ChatAppearanceEditor.tsx`、`components/os/BootSequence.tsx` 等——以实际 grep 为准）
- Test: 全量回归（Task 10）+ 桌面目测

规则：外壳内部（非 portal、非 fixed 逃逸）的 `100vw→w-full/100%`、`100vh→h-full/100%/var(--app-height)`；portal 层与 `document.body` 直挂的保留；`svh/lvh/dvh` 同理。逐文件改完即跑对应单测（若有）。

- [ ] **Step 1: grep 建清单**（`Select-String -Pattern '\d+vw|\d+vh|svh|lvh|dvh'`，逐条判定 portal/内部）
- [ ] **Step 2: 分批转换**（每 5 文件一批，每批后 tsc scoped）
- [ ] **Step 3: Commit**（一批一 commit，message 如 `fix(desktop): container-relative sizing in <area>`）

### Task 9: 触屏手势桌面审计

**Files:**
- 按需 Modify：`onTouchStart` 独占且无 pointer 双线的关键路径（候选：`components/date/DateSession.tsx`、`components/chat/ChatInputArea.tsx`、`apps/pixelHome/PixelRoomEditor.tsx`、`apps/CallApp.tsx` 等，以实际审计为准）
- Test: 手动清单（本仓无手势单测基础设施）

- [ ] **Step 1: 审计**：列出全部 `onTouchStart` 用点，标记已有 pointer/`onContextMenu` 双线的（`LongPressArea` 模式，`apps/Appearance.tsx:55-111` 为范本）vs 触屏独占的
- [ ] **Step 2: 补双线**：触屏独占的关键路径仿 `LongPressArea` 补 pointer 计时（只加不改 touch 路径）；非关键路径记录不修
- [ ] **Step 3: 桌面手动验证**（聊天消息长按、DateSession 手势、输入区、CallApp）+ Commit

```bash
git add <实际文件>
git commit -m "fix(desktop): pointer fallback for touch-only gestures"
```

### Task 10: 回归 + 升版

- [ ] **Step 1: 全量测试**

Run: `corepack pnpm@9.15.9 vitest run`
Expected: 全绿（与基线一致；基线已知 `activeMsgRuntime` 相关曾红过，如红先确认是否本次引入）

- [ ] **Step 2: tsc + 乱码护栏**

Run: `corepack pnpm@9.15.9 exec tsc --noEmit 2>&1 | Select-String -Pattern 'desktop|Desktop|portalHost|hostViewport|dominantHue|Appearance\.tsx|App\.tsx|analyticsSnapshot'`
Expected: 无输出
Run: `corepack pnpm@9.15.9 vitest run utils/mojibakeGuard.test.ts`
Expected: PASS

- [ ] **Step 3: `utils/buildInfo.ts` 升版**（大功能：`APP_VERSION` 升一档，括号代号保留或更新；`BUILD_LABEL` 不动）
- [ ] **Step 4: 桌面手动清单**：1920×1080 进框 / 窄窗回退全屏 / 换壁纸背景跟随 / blur↔color 切换 / auto/on/off 三态 / 刷新后保持
- [ ] **Step 5: Commit + push**

```bash
git add utils/buildInfo.ts
git commit -m "chore: bump APP_VERSION for desktop shell"
git push origin ethernet
```

注：push 后 VPS 不受影响（纯前端，VPS 只跑后端；按分支约定 push 即完成交付）。
