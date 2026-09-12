# 半屏手机形态恢复滚轮翻页 · 执行计划（2026-09-11）

> **执行者须知**：小修复，三个文件。行号来自 2026-09-11 扫描；若工作区被其他窗口改过导致对不上，先 Read 核对再改。手机端行为必须零变化。

**Goal:** 电脑上窗口缩小（<1024 宽或 <600 高）进入手机形态后，主页滚轮只能单方向翻页（另一方向被误判拦截）。修复 `wheelPager` 的「纵向滚动容器」误判，恢复双向翻页。

**根因（已核对）:** `utils/wheelPager.ts:26-33` 的 `findVerticalScroller` 只看 `scrollHeight - clientHeight > 8`。主页页面容器（`apps/Launcher.tsx:926-927`，`h-full` + `contain: layout paint`）在窗口/手机框变矮时内容溢出：溢出被裁剪，但 `scrollHeight` 仍大于 `clientHeight` → 被当成可纵向滚动容器 → 滚轮翻页被「让给」一个根本滚不动的元素。往回翻时 `atTop` 成立仍能翻页，向前翻被拦住，于是表现为单方向失效。与桌面/手机形态无关，`apps/Launcher.tsx:904` 的 `onWheel` 一直挂着。

---

## 一、会触碰的文件

- `utils/wheelPager.ts`
- `utils/wheelPager.test.ts`
- `apps/Launcher.tsx`

## 二、步骤

### Task 1 `utils/wheelPager.ts`：只认真滚动容器

`findVerticalScroller` 改为尺寸判断通过后，再查计算样式：

```ts
const isVerticallyScrollable = (el: HTMLElement): boolean => {
    if (el.scrollHeight - el.clientHeight <= VERTICAL_OVERFLOW) return false;
    const overflowY = window.getComputedStyle(el).overflowY;
    return overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
};

const findVerticalScroller = (start: EventTarget | null): HTMLElement | null => {
    let el = start instanceof Element ? (start as HTMLElement) : null;
    while (el && el !== document.body) {
        if (isVerticallyScrollable(el)) return el;
        el = el.parentElement;
    }
    return null;
};
```

要点：
- 先尺寸、后计算样式：`getComputedStyle` 只对通过尺寸判断的元素调用，避免每次滚轮全链路强制样式计算。
- `visible` / `hidden` / `clip` 一律不算滚动容器；弹窗里的 `overflow-y-auto` 列表行为不变。
- 注释保留原有「纵向滚动优先」的说明，补充「必须是真的能滚」。

### Task 2 `apps/Launcher.tsx:910`：翻页容器显式禁竖滚

横向翻页容器 className 末尾加 `overflow-y-hidden`：

```
className="flex-1 flex overflow-x-auto overflow-y-hidden snap-x snap-mandatory no-scrollbar cursor-grab active:cursor-grabbing"
```

（`overflow-x: auto` 会让 `overflow-y` 计算值变 auto；显式写 hidden 后该容器永远不会被当成纵向滚动容器，防御以后皮肤/内容变化。页面子元素带 `contain: paint`，竖滚本来就无内容可滚，行为无变化。）

### Task 3 `utils/wheelPager.test.ts`：补 3 组 jsdom 用例

文件头部已有 `// @vitest-environment jsdom`。在既有 5 条纯逻辑用例后追加一组 DOM 用例，公共手法：把树挂到 `document.body`，对元素 `Object.defineProperty` 桩 `scrollHeight` / `clientHeight` / `scrollTop`，滚动容器用内联 `style="overflow-y:auto"`（jsdom 的 `getComputedStyle` 能读到，已实测）。

1. **回归：溢出但不可滚的祖先不拦截** —— wrapper（可见溢出：scrollHeight 500 / clientHeight 400，无 overflow 样式）内放 target；`pager.handle({ deltaY: 120, target })` → 期望 `goPage(1)` 被调用（修复前不会调用）。
2. **真滚动容器：未到底不翻页，到底翻页** —— scroller（inline overflow-y:auto，scrollHeight 500 / clientHeight 400）内放 target；`scrollTop=0` 时 `deltaY=120` 不翻页；`scrollTop=100`（到底）时再滚 → 翻页。
3. **真滚动容器：未到顶不翻页，到顶翻上一页** —— 同上，`scrollTop=100` 时 `deltaY=-120` 不翻页；`scrollTop=0` 时 → `goPage(-1)`。

注意：每次 `handle` 前若要跨用例复用元素，重开 pager 实例（锁定期 550ms）；用 `vi.useFakeTimers()` 或新建实例隔离。

## 三、验收

```powershell
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
corepack pnpm@9.15.9 vitest run utils/wheelPager.test.ts
corepack pnpm@9.15.9 vitest run
corepack pnpm@9.15.9 vitest run utils/mojibakeGuard.test.ts
node_modules\.bin\tsc.CMD --noEmit -p tsconfig.json   # 触碰文件零新增
```

手动（用户）：窗口缩到手机形态（无框/半屏）→ 主页滚轮**上下双向**翻页；弹窗内可滚列表仍是先滚到底再翻页；手机触屏不变；约会/查手机横向翻页页不受影响。

## 四、边界

- 不动 `layoutMode` / `DesktopFrame` / 桌面布局；不改「纵向滚动优先」语义；不做电脑端专属开关。
- 窗口高度小于手机设计高度时主页内容被裁的部分仍看不到（现状如此），本单只恢复翻页。
- 小修复，不 bump 版本号。

---

## 执行状态（2026-09-11）

- ✅ Task 1 `utils/wheelPager.ts`：新增 `isVerticallyScrollable`（尺寸 + computed `overflow-y` ∈ auto/scroll/overlay），`findVerticalScroller` 改走它；文件头注释同步说明。
- ✅ Task 2 `apps/Launcher.tsx:910`：翻页容器加 `overflow-y-hidden`。
- ✅ Task 3 `utils/wheelPager.test.ts`：+3 条 DOM 用例（不可滚溢出祖先不拦截 / 真容器未到底不翻页、到底翻页 / 未到顶不翻页、到顶翻上一页），共 8 用例全过。
- ✅ 门禁：全量 429 文件 / 5091 用例全绿；`tsc --noEmit` 45 存量错误、触碰文件零命中；mojibakeGuard 绿；触碰文件 FFFD/BOM 0。
- 提交与 push 见仓库记录（供 Vercel 实测）。
