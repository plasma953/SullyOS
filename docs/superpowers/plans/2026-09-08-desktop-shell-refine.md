# 桌面小手机四项改进 · 执行计划

- 日期：2026-09-08
- 分支：`ethernet`
- 设计背景：桌面外框过窄导致 dock 图标被裁；翻页只有触摸路径；灵动岛装饰压住状态栏；投屏小窗误渲染整套桌面外壳（模糊背景 + 居中框）。
- 总原则：**手机端行为像素级不变**（无滚轮硬件不触发任何新增逻辑；AppIcon 尺寸类有 fallback）。版本号不动（修正批次）。

## 0. 本次会触碰的文件

| 文件 | 动作 |
|------|------|
| `docs/superpowers/plans/2026-09-08-desktop-shell-refine.md` | 新增（本文档） |
| `utils/wheelPager.ts` | 新增 |
| `utils/wheelPager.test.ts` | 新增 |
| `components/desktop/DesktopFrame.tsx` | 修改 |
| `components/desktop/DesktopHost.tsx` | 修改 |
| `utils/pipWindow.ts` | 修改 |
| `components/os/AppIcon.tsx` | 修改 |
| `apps/Launcher.tsx` | 修改 |
| `apps/CheckPhone.tsx` | 修改 |
| `components/chat/ChatInputArea.tsx` | 修改 |
| `components/appearance/ChatAppearanceEditor.tsx` | 修改 |
| `components/user/PerCharAvatarPicker.tsx` | 修改 |
| `apps/DateApp.tsx` | 修改 |
| `notes/ethernet-branch-context.md` | 收尾追加一行记录 |

**不触碰**：worker/、vps-backend/、任何 App 内部视觉（表情键盘不加滚轮翻页）、彼方 `WorldHomeApp.tsx` 自己的灵动岛、`utils/buildInfo.ts` 版本号。

## 1. 全局纪律（每步都适用）

- 写文件只用 Write/Edit 工具；绝不用 shell 重定向 / Set-Content / echo 写文件。
- 含中文的 oldString 只从 Read 工具输出逐字取；bash 命令参数避免中文；commit message 用英文。
- 不加任何注释除非该处已有注释惯例延续（本计划给出的代码块里的注释按原样写入）。
- `useWheelPager` 是 React hook，只能在组件顶层调用，**不得**放进 `renderDesktop` 之类的内联渲染函数里。
- 包管理器一律 `corepack pnpm@9.15.9`。

---

## 2. 执行步骤

### - [ ] Step 1：新增 `utils/wheelPager.ts`

创建文件，内容**逐字**如下：

```ts
import { useCallback, useRef, type WheelEvent } from 'react';

// ─── 滚轮翻页桥 ─────────────────────────────────────────────
// 把鼠标滚轮（纵向）映射为「上一页/下一页」。只服务桌面鼠标场景：
// 手机无滚轮硬件不触发；触控板横向滚动（deltaX 主导）交给原生横滑。
// 纵向滚动优先：向上遍历祖先，若存在纵向可滚容器且未滚到对应边界，
// 让原生滚动消化这次滚轮，到边界才翻页（动作面板/弹窗内容可滚的场景）。

export interface WheelPagerEvent {
    deltaY: number;
    deltaX: number;
    ctrlKey: boolean;
    target: EventTarget | null;
}

export interface WheelPagerController {
    handle(e: WheelPagerEvent): void;
}

const VERTICAL_OVERFLOW = 8;   // 容器纵向可滚动判定余量(px)
const EDGE_SLACK = 2;          // 滚动边界判定余量(px)
const ACCUM_THRESHOLD = 48;    // 累积位移达到该值才翻页
const IDLE_RESET_MS = 160;     // 停滚多久后累积归零
const DEFAULT_LOCK_MS = 550;   // 翻页后锁这段时间（覆盖 smooth 滚动/过渡动画）

const findVerticalScroller = (start: EventTarget | null): HTMLElement | null => {
    let el = start instanceof Element ? (start as HTMLElement) : null;
    while (el && el !== document.body) {
        if (el.scrollHeight - el.clientHeight > VERTICAL_OVERFLOW) return el;
        el = el.parentElement;
    }
    return null;
};

export const createWheelPager = (
    goPage: (delta: 1 | -1) => void,
    lockMs: number = DEFAULT_LOCK_MS,
): WheelPagerController => {
    let accum = 0;
    let lockUntil = 0;
    let idleTimer: number | null = null;
    return {
        handle(e) {
            if (e.ctrlKey) return; // 捏合缩放
            const { deltaX: dx, deltaY: dy } = e;
            if (Math.abs(dx) > Math.abs(dy)) return; // 横向触控板 → 原生横滑
            if (Math.abs(dy) < 4) return;
            const scroller = findVerticalScroller(e.target);
            if (scroller) {
                const atTop = scroller.scrollTop <= EDGE_SLACK;
                const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - EDGE_SLACK;
                if (dy > 0 && !atBottom) return; // 还能往下滚，交给原生
                if (dy < 0 && !atTop) return;
            }
            const now = Date.now();
            if (now < lockUntil) return;
            if (idleTimer !== null) window.clearTimeout(idleTimer);
            idleTimer = window.setTimeout(() => { accum = 0; idleTimer = null; }, IDLE_RESET_MS);
            accum += dy;
            if (Math.abs(accum) >= ACCUM_THRESHOLD) {
                const delta: 1 | -1 = accum > 0 ? 1 : -1;
                accum = 0;
                lockUntil = now + lockMs;
                goPage(delta);
            }
        },
    };
};

// hook 封装：handler 身份稳定（不受父组件重渲染影响），goPage 每次渲染换新闭包。
export const useWheelPager = (
    goPage: (delta: 1 | -1) => void,
    lockMs: number = DEFAULT_LOCK_MS,
): (e: WheelEvent) => void => {
    const goRef = useRef(goPage);
    goRef.current = goPage;
    const ctrlRef = useRef<WheelPagerController | null>(null);
    if (!ctrlRef.current) ctrlRef.current = createWheelPager((d) => goRef.current(d), lockMs);
    return useCallback((e: WheelEvent) => { ctrlRef.current?.handle(e); }, []);
};
```

**验收**：`corepack pnpm@9.15.9 exec tsc --noEmit 2>&1 | Select-String wheelPager` → 零命中。

### - [ ] Step 2：新增 `utils/wheelPager.test.ts`

创建文件，内容**逐字**如下（纯逻辑测试，不依赖 DOM；`target: null` 时守卫直接放行）：

```ts
import { describe, expect, it, vi } from 'vitest';
import { createWheelPager, type WheelPagerEvent } from './wheelPager';

const evt = (deltaY: number, extra: Partial<WheelPagerEvent> = {}): WheelPagerEvent =>
    ({ deltaY, deltaX: 0, ctrlKey: false, target: null, ...extra });

describe('wheelPager', () => {
    it('累积达到阈值才翻页，方向取累积符号', () => {
        const goPage = vi.fn();
        const pager = createWheelPager(goPage);
        pager.handle(evt(20));
        pager.handle(evt(20));
        expect(goPage).not.toHaveBeenCalled();
        pager.handle(evt(20));
        expect(goPage).toHaveBeenCalledTimes(1);
        expect(goPage).toHaveBeenCalledWith(1);
    });

    it('负向累积翻上一页', () => {
        const goPage = vi.fn();
        const pager = createWheelPager(goPage);
        pager.handle(evt(-60));
        expect(goPage).toHaveBeenCalledWith(-1);
    });

    it('翻页后进入锁定期，期间滚轮被忽略', () => {
        vi.useFakeTimers();
        const goPage = vi.fn();
        const pager = createWheelPager(goPage);
        pager.handle(evt(60));
        pager.handle(evt(60));
        expect(goPage).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(600);
        pager.handle(evt(60));
        expect(goPage).toHaveBeenCalledTimes(2);
        vi.useRealTimers();
    });

    it('停滚 160ms 后累积归零', () => {
        vi.useFakeTimers();
        const goPage = vi.fn();
        const pager = createWheelPager(goPage);
        pager.handle(evt(30));
        vi.advanceTimersByTime(200);
        pager.handle(evt(30));
        expect(goPage).not.toHaveBeenCalled();
        vi.useRealTimers();
    });

    it('横向主导（触控板）与 ctrlKey（捏合）不翻页', () => {
        const goPage = vi.fn();
        const pager = createWheelPager(goPage);
        pager.handle(evt(0, { deltaX: 80 }));
        pager.handle(evt(80, { ctrlKey: true }));
        expect(goPage).not.toHaveBeenCalled();
    });
});
```

**验收**：`corepack pnpm@9.15.9 vitest run utils/wheelPager.test.ts` → 5 passed。

### - [ ] Step 3：改 `components/desktop/DesktopFrame.tsx`

用 Write 全量替换为：

```tsx
import React, { useEffect, useRef } from 'react';
import { setPortalHost } from '../../utils/portalHost';

/**
 * 仿真手机外框。屏幕区即 sully-viewport：
 * 自带 translateZ(0) 让内部 fixed 浮层以框为包含块（与 App.tsx 现有手法一致），
 * portal 宿主 div 只做挂载点（零尺寸、不定位），portal 自身定位。
 * variant="pip" 用于投屏悬浮窗：尺寸随 PiP 窗口（100vw/100vh）撑满。
 * ResizeObserver 把屏幕区尺寸写进 --vp-width/--vp-height，供 dock 等按框宽缩放。
 */
export const DesktopFrame: React.FC<{ children: React.ReactNode; variant?: 'default' | 'pip' }> = ({ children, variant = 'default' }) => {
    const portalHostRef = useRef<HTMLDivElement | null>(null);
    const frameRef = useRef<HTMLDivElement | null>(null);
    const screenRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
        setPortalHost(portalHostRef.current);
        return () => setPortalHost(null);
    }, []);
    useEffect(() => {
        const screen = screenRef.current;
        const frame = frameRef.current;
        if (!screen || !frame) return;
        const write = () => {
            const rect = screen.getBoundingClientRect();
            frame.style.setProperty('--vp-width', `${Math.round(rect.width)}px`);
            frame.style.setProperty('--vp-height', `${Math.round(rect.height)}px`);
        };
        write();
        const ro = new ResizeObserver(write);
        ro.observe(screen);
        return () => ro.disconnect();
    }, []);
    const sizeStyle: React.CSSProperties = variant === 'pip'
        ? { width: 'min(100vw, calc(100vh * 393 / 852))', aspectRatio: '393 / 852' }
        : { width: 'min(460px, 94vw, calc(min(92vh, 940px) * 393 / 852))', aspectRatio: '393 / 852' };
    return (
        <div ref={frameRef} className="relative select-none" style={sizeStyle} data-desktop-frame>
            {/* 金属边框 */}
            <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-[56px] bg-gradient-to-br from-zinc-600 via-zinc-900 to-black shadow-[0_40px_120px_rgba(0,0,0,0.55),inset_0_1px_1px_rgba(255,255,255,0.35),inset_0_-1px_1px_rgba(0,0,0,0.6)]"
            />
            {/* 侧边键：左音量 ×2，右电源 */}
            <div aria-hidden="true" className="pointer-events-none absolute -left-[2.5px] top-[150px] h-14 w-[3px] rounded-full bg-zinc-700" />
            <div aria-hidden="true" className="pointer-events-none absolute -left-[2.5px] top-[220px] h-20 w-[3px] rounded-full bg-zinc-700" />
            <div aria-hidden="true" className="pointer-events-none absolute -right-[2.5px] top-[190px] h-24 w-[3px] rounded-full bg-zinc-700" />
            {/* 屏幕 */}
            <div
                ref={screenRef}
                className="absolute overflow-hidden bg-black"
                style={{ inset: 12, borderRadius: 44, transform: 'translateZ(0)' }}
                data-sully-viewport
            >
                {children}
                <div ref={portalHostRef} data-sully-portal-host />
            </div>
        </div>
    );
};
```

要点核对：灵动岛整段删除（原 L38-43）；比例 `393/920` → `393/852`；高度驱动改宽度驱动（上限 460px）；新增 `variant` prop 与 ResizeObserver。

### - [ ] Step 4：改 `components/desktop/DesktopHost.tsx`

两处：

1. import 行（L6）不变（DesktopFrame 已在导入里）。
2. 把 L18 的提前返回之前插入 pipActive 分支。改后的组件主体开头（L13-22 一带）：

```tsx
    const { theme } = useOS();
    const vp = useDesktopViewport();
    const [pipActive, setPipActive] = useState(false);
    useEffect(() => onPipChange(setPipActive), []);
    if (pipActive) {
        // 投屏悬浮窗：只显示一台撑满小窗的带框手机，无背景层。
        return (
            <div className="fixed inset-0 z-0 flex items-center justify-center overflow-hidden bg-black">
                <DesktopFrame variant="pip">{children}</DesktopFrame>
            </div>
        );
    }
    if (!resolveDesktopMode(theme.desktopMode, vp)) return <>{children}</>;
```

其余（DesktopBackdrop、居中框、投屏按钮）保持原样。

### - [ ] Step 5：改 `utils/pipWindow.ts`

1. L18：`export const PIP_WINDOW_FALLBACK_SIZE = { width: 420, height: 900 };` → `export const PIP_WINDOW_FALLBACK_SIZE = { width: 408, height: 884 };`（贴合 393:852 + 12px 边框）。
2. `openPipShell` 内、`activePip = pipWin;`（L161）之后插入：

```ts
    try {
        pipWin.document.documentElement.style.background = '#000';
        pipWin.document.body.style.background = '#000';
    } catch { /* ignore */ }
```

**验收**：`corepack pnpm@9.15.9 vitest run utils/pipWindow.test.ts utils/desktopShell.test.ts` → 全绿（现有断言只要求 ≥200/≥100）。

### - [ ] Step 6：改 `components/os/AppIcon.tsx`

L40 `sizeClasses` 的 md 分支：

```ts
    'w-[var(--app-icon-size,3.5rem)] h-[var(--app-icon-size,3.5rem)]';
```

（原为 `'w-[3.5rem] h-[3.5rem]'`。lg/sm 分支不动。变量缺省回退 3.5rem，手机端像素级不变。）

### - [ ] Step 7：改 `apps/Launcher.tsx`

1. import 区加：`import { useWheelPager } from '../utils/wheelPager';`
2. `handleScroll`（L698）之前加：

```tsx
  // 滚轮翻页（桌面鼠标）：纵向滚轮 → 上一页/下一页；触控板横滑走原生 snap。
  const onWheelPage = useWheelPager((delta: 1 | -1) => {
      const scroller = scrollContainerRef.current;
      if (!scroller || layoutEditing) return;
      const next = Math.max(0, Math.min(totalPages - 1, activePageIndexRef.current + delta));
      if (next === activePageIndexRef.current) return;
      activePageIndexRef.current = next;
      setActivePageIndex(next);
      _lastPageIndex = next;
      scroller.scrollTo({ left: scroller.clientWidth * next, behavior: 'smooth' });
  });
```

注意：翻页上限用 `totalPages`（L627，含最后一页 WidgetsPage），与 `handleScroll` 的 index 口径一致；布局编辑模式的 `maxAppPage` 逻辑（L831）**不要动**。

3. 横向滚动容器（L1027-1046）的 props 里、`onScroll={handleScroll}` 旁边加 `onWheel={onWheelPage}`。
4. dock 内层容器（L1210-1216）：`className` 里 `gap-3 sm:gap-6` 改为 `gap-3`；`style` 改为合并写法：

```tsx
            <div
              className={`rounded-[1.75rem] px-4 py-3 flex gap-3 items-center mx-auto max-w-full justify-between overflow-x-auto no-scrollbar transform-gpu ${acnh || paper ? '' : 'bg-white/30 border border-white/25 shadow-[0_8px_40px_rgba(0,0,0,0.22),inset_0_1px_0_rgba(255,255,255,0.08)]'}`}
              style={{
                  '--app-icon-size': 'clamp(2.75rem, calc((var(--vp-width, 100vw) - 6.5rem) / 4), 3.5rem)',
                  ...(acnh ? { background: 'transparent' } as React.CSSProperties : paper ? {
                      background: 'rgba(224,221,215,0.42)',
                      border: '1px solid rgba(91,72,51,0.07)',
                      boxShadow: '0 6px 18px rgba(91,72,51,0.065)',
                  } as React.CSSProperties : {}),
              } as React.CSSProperties}
            >
```

（若该文件未 import React 默认导出，确认文件头部已有 `import React`——Launcher 现有代码使用了 JSX，应有；没有则加。）

### - [ ] Step 8：改 `apps/CheckPhone.tsx`

1. import 区加：`import { useWheelPager } from '../utils/wheelPager';`
2. 组件顶层、`const customApps = targetChar?.phoneState?.customApps || [];`（L371）之后加：

```tsx
    // 滚轮翻页（桌面鼠标）：查手机桌面横向翻页；手机端无滚轮硬件不触发。
    const onPagerWheel = useWheelPager((delta: 1 | -1) => {
        const maxPage = customApps.length > 0 ? 2 : 1;
        setPage(p => Math.max(0, Math.min(maxPage - 1, p + delta)));
    });
```

（`page` state 在 L270。renderDesktop 里 L3787 的局部 `totalPages` 保留原样，不改名。）

3. Pager 容器 div（L3821）：`onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}` 旁边加 `onWheel={onPagerWheel}`。

### - [ ] Step 9：改 `components/chat/ChatInputArea.tsx`

1. import 区加：`import { useWheelPager } from '../../utils/wheelPager';`
2. 组件顶层：先 grep `actionsPage` 的 useState 声明行，在其后加：

```tsx
    const onActionsPanelWheel = useWheelPager((delta: 1 | -1) => {
        setActionsPage(prev => Math.max(0, Math.min(2, prev + delta)) as 0 | 1 | 2);
    });
```

（若 state 类型不是 `0 | 1 | 2` 就按实际类型写 cast；`setActionsPage` 的既有用法见 L216/218。）

3. Actions Panel 分页容器（L627-633）：`onTouchStart={handleActionsSwipeStart}` 等旁边加 `onWheel={onActionsPanelWheel}`。
4. **禁止**给表情键盘区（emoji picker，L571 一带）接滚轮——它自身可滚且有翻页按钮。

### - [ ] Step 10：改 `components/appearance/ChatAppearanceEditor.tsx`

1. import 区加：`import { useWheelPager } from '../../utils/wheelPager';`
2. `goPage`（L456）之后加：

```tsx
    const onWheelPage = useWheelPager((delta: 1 | -1) => goPage(page + delta));
```

（`goPage` 自带 clamp，L456。）

3. 页面内容包裹 div（L654，已有 onTouchStart/onTouchEnd 的那个）：加 `onWheel={onWheelPage}`。
4. **禁止**在 L657 的 `closest('input')` 防误触逻辑里加滚轮条件——滚轮不经过触摸起点，天然不冲突。

### - [ ] Step 11：改 `components/user/PerCharAvatarPicker.tsx`

1. import 区加：`import { useWheelPager } from '../../utils/wheelPager';`
2. `goPage`（L49-52）之后、`safePage`（L46）已在作用域内的位置加：

```tsx
    const onWheelPage = useWheelPager((delta: 1 | -1) => goPage(safePage + delta));
```

3. 分页网格外层 div（L135-144，已有 onTouchStart/onTouchEnd 的那个）：加 `onWheel={onWheelPage}`。

### - [ ] Step 12：改 `apps/DateApp.tsx`

1. import 区加：`import { useWheelPager } from '../utils/wheelPager';`
2. `goSelectPage`（L92-96）之后加：

```tsx
    // 滚轮翻页（桌面鼠标）：选择页 6 角色一页横向翻页；页内卡片列表可先纵向滚动，到底再翻。
    const onPagerWheel = useWheelPager((delta: 1 | -1) => {
        const el = pagerRef.current;
        if (!el || el.clientWidth === 0) return;
        const maxPage = Math.max(0, Math.round(el.scrollWidth / el.clientWidth) - 1);
        const current = Math.round(el.scrollLeft / el.clientWidth);
        const next = Math.max(0, Math.min(maxPage, current + delta));
        if (next !== current) el.scrollTo({ left: next * el.clientWidth, behavior: 'smooth' });
    });
```

3. Pager 容器（L777，`ref={pagerRef} onScroll={onPagerScroll}` 的 div）：加 `onWheel={onPagerWheel}`。

### - [ ] Step 13：黑栏复现定位（投屏）

改完 Step 3-5 后，起 dev（`corepack pnpm@9.15.9 dev`，后台跑）+ 用户配合点一次投屏，确认小窗顶部那条黑栏：

- 若黑栏已消失（大概率：原来是误渲染的桌面壳顶部区域）→ 完成。
- 若黑栏仍在且贴窗口最顶端、在金属边框之外 → 是浏览器给 Document PiP 窗画的标题栏，网页无法移除；缓解：`openPipShell` 里 `pipWin.document.title` 保持复制主文档 title（L163 现状），并向用户说明该条为浏览器绘制、无法去除。
- 若黑栏在外框内部 → 用 DevTools 定位是哪个 DOM（疑点：手机 StatusBar），截图回报后对症，不在本计划内擅自改。

### - [ ] Step 14：全量门禁

依次跑，全绿才算过：

1. `corepack pnpm@9.15.9 vitest run utils/wheelPager.test.ts utils/pipWindow.test.ts utils/desktopShell.test.ts` → 全过。
2. `corepack pnpm@9.15.9 vitest run` → 全量绿（基线 2026-09-06 为 407 文件 / 4922 用例全绿；若有失败，`git stash` 后复跑对比，确认是存量还是本次引入；存量则还原继续）。
3. `corepack pnpm@9.15.9 exec tsc --noEmit 2>&1 | Select-String "wheelPager|DesktopFrame|DesktopHost|pipWindow|AppIcon|Launcher|CheckPhone|ChatInputArea|ChatAppearanceEditor|PerCharAvatarPicker|DateApp"` → **零命中**（全量 tsc 有 48 个存量错误，判据是本次触碰文件零命中）。
4. `corepack pnpm@9.15.9 vitest run utils/mojibakeGuard.test.ts` → 绿（本批动了大量中文注释文件）。
5. 字节扫 FFFD（诊断输出纯 ASCII）：

```powershell
python -c "import pathlib; bad=[str(p) for p in pathlib.Path('.').rglob('*') if p.suffix in {'.ts','.tsx','.css','.html','.md'} and b'\xef\xbf\xbd' in p.read_bytes()]; print('FFFD files:', len(bad)); [print(x) for x in bad]"
```

预期 `FFFD files: 0`。

不跑 `pnpm build:workers`（本批未动 worker/）。

### - [ ] Step 15：手动验证清单（需真机浏览器，可请用户配合）

- 桌面外框：1080p 最大化下 dock 四图标完整、比例明显比原来宽；拉矮窗口到 ~750px 高，图标等比缩小仍完整。
- 状态栏：灵动岛消失，时间/电量不再被盖。
- 滚轮翻页 ×6：主屏左右翻页（含最后一页小组件页）；查手机桌面；聊天「+」动作面板（内容超长时先滚动、到边再翻页）；聊天外观编辑器；逐角色头像选择；见面选择页。
- 触控板横滑在主屏仍能原生滚动（snap 生效）。
- 投屏：小窗 = 一台撑满的带框手机，无模糊壁纸背景；主窗口占位卡不变；关闭投屏正常还原。
- 手机端回归：真机打开，dock、翻页、头像选择等与改前一致（无滚轮硬件不触发新逻辑）。

### - [ ] Step 16：文档与提交

1. `notes/ethernet-branch-context.md` 「仓库现状与坑」节末尾追加一行（2026-09-08 桌面外壳四项修正的简记，含本计划路径）。
2. `git diff --stat` 逐 hunk 确认归属（工作区有大量 CRLF 噪音，只 add 上表真实触碰的文件）。
3. 单条提交，英文 message：`desktop: widen phone frame, add wheel paging, drop dynamic island, phone-only PiP view`。
4. push `origin/ethernet`（纯前端改动，VPS 无需同步；用户叫停就不 push）。

---

## 3. 已知边界与取舍

- 窗口高 < ~650px 时框宽 < ~300px，dock 固定内边距占比过大仍可能轻微裁切——极端场景，接受。
- 浏览器为 Document PiP 窗绘制的标题栏（若用户浏览器有）网页无法移除，只能调标题文案。
- 翻页后 550ms 锁定期内的滚轮被丢弃（防 smooth 滚动期间连翻抖动，有意取舍）。
- 弹窗类翻页面（外观编辑器/头像选择/动作面板）内容超长时，滚轮先滚内容、到边界才翻页——有意行为。
- 手机端零影响：滚轮事件仅滚轮硬件触发；AppIcon 变量有 fallback；dock 结构未变。
