# 启动器 Dock 互换 + 桌面主页一屏化 + 全机动效补全 · 设计

- 日期：2026-09-11
- 分支：`ethernet`
- 前置：`plans/web-desktop-adaptation-2026-09-11.md`（三端布局壳）
- 执行计划：`plans/2026-09-11-launcher-dock-motion-plan.md`

## 一、目标

1. **Dock↔主屏图标互换（三端一致）**：Dock 固定 4 格；手机端与电脑端都能长按约 520ms 进编辑模式后拖动，网格图标拖到 Dock 图标上两者对调，Dock 图标拖回网格同理。手机竖屏、平板竖屏、电脑/平板横屏（桌面 UI）读取同一份 `launcherAppOrder` / `launcherDockOrder`，互换结果处处生效。
2. **电脑端主页一屏化**：桌面主页改为固定一屏布局；左列小组件压缩显示，右侧应用网格按容器实时计算列数/单元格并自适应缩放，全部应用默认一屏放下，整页永不滚动；窗口小到极限时只允许应用网格区/组件列内部滚动。
3. **全机动效补全**：消除盘点出的 17 处页面/面板硬切换（4 类模式），并补 4 项微交互，使操作过渡细腻一致。

三端定义沿用布局壳计划：手机竖屏与平板竖屏 = 手机 UI（底部 Dock）；平板横屏与电脑全屏 = 桌面 UI（左侧 Dock + 桌面主页）；电脑窗口化 = 手机框（手机 UI）。

不覆盖：皮肤主屏（手游/电子宠物/伴侣）自渲染网格；番茄钟手绘风区域；Dock 容量自由增减。

## 二、Dock 互换的数据模型

Dock 恒 4 格。顺序状态仍存 `theme.launcherDockOrder`（Dock 成员与顺序）与 `theme.launcherAppOrder`（网格成员与顺序），两者成员互斥、并集为全部可用 App。无需新字段、无需迁移。

新纯函数模块 `utils/launcherLayout.ts`：

- `normalizeDockOrder(saved, availableIds, defaults)`：合法化已存顺序 → 去重 → 不足 4 格按 defaults（`DOCK_APPS`）补 → 再不足从可用 App 补 → 截断 4 格。
- `normalizeAppOrder(saved, allIds, dockIds)`：网格 = 全部可用 App − Dock 成员；已存顺序优先，缺的新 App 按 `INSTALLED_APPS` 原序补尾。
- `reorderIds(items, source, target)`：同类拖动 = 插入排序（沿用现语义）。
- `swapDockAndGrid(appOrder, dockOrder, source, target)`：跨类拖动 = 对调。网格→Dock：source 落 target 的 Dock 位，target 回 source 的网格位；Dock→网格对称。任一侧找不到 id 则原样返回。
- `sameOrder(a, b)`：数组顺序比较，供 state 同步去抖。

## 三、组件架构

跨容器拖拽要求电脑端 Dock 与桌面网格同属一个拖拽域，因此把布局状态提升到 `PhoneShell` 层的 Provider：

```
PhoneShell
└─ LauncherLayoutProvider        ← 新增：顺序状态 + editing + drop + 拖拽样式
   ├─ DesktopDock               ← 消费 dockApps，接拖拽（仅主页可编辑）
   └─ 内容区
      └─ Launcher               ← 消费 gridApps/dockApps，接拖拽
```

- `context/LauncherLayoutContext.tsx`（新）：持有 `appOrder/dockOrder/editing`、顺序 refs、`devDebug` 订阅；暴露 `gridApps/dockApps/beginEdit/finishEdit/drop`；非编辑态与 `theme` 同步，`drop` 即写 `updateTheme`。拖拽的四个 CSS 类（edit-item/dragging/drag-ghost/drop-target）移入 Provider 渲染的一份 `<style>`。
- `hooks/useLauncherDrag.ts`（新）：从 `apps/Launcher.tsx` 现有拖拽逻辑（长按 520ms、9px 取消、ghost 克隆、`elementFromPoint` 落点、边缘翻页回调）抽出；两个渲染入口（手机/桌面根、DesktopDock）各持一个实例，靠 `setPointerCapture` + `elementFromPoint` 跨容器。目标判定从「同类」放宽为「同类 或 app↔dock」。
- `apps/Launcher.tsx`：
  - 手机分支：顺序状态改读 Provider，渲染与像素不变；拖拽改用 hook；widget（风车）仍本地排序并持久化。
  - 桌面分支：网格改用 Provider 的 `gridApps`（修掉当前忽略用户排序的问题），接 hook 与编辑提示条。
- `components/desktop/DesktopDock.tsx`：删 `QUICK_EXTRAS`；渲染 Home 按钮 + Provider 的 `dockApps`；条目加 `data-launcher-item/kind="dock"`；仅 `activeApp === AppID.Launcher` 时可长按编辑。

## 四、桌面主页一屏化

- `utils/fitGrid.ts`（新）：`computeFitGrid({width, height, count, gapX, gapY, minCell, maxCell})` → `{cols, rows, cell, scroll}`。在 1..12 列中选「单元格边长最大」的方案（`cell = min(cellW, cellH, maxCell)`）；最优值低于 `minCell` 时降级为 `minCell` 定宽并置 `scroll=true`。
- `components/desktop/DesktopAppGrid.tsx`（新）：`ResizeObserver` 测容器，调用 `computeFitGrid`；网格用 `gridTemplateColumns: repeat(cols, minmax(0,1fr))` + `gridAutoRows: minmax(cell,1fr)`，通过 `--app-icon-size` 把图标限制在 40~56px；`scroll=true` 时容器 `overflow-y-auto no-scrollbar`。
- `apps/Launcher.tsx` 桌面分支重写：根 `h-full overflow-hidden`；左列宽 `clamp(280px,22vw,340px)`、`min-h-0 overflow-y-auto`，右列 `flex-1 min-w-0`。
- 小组件紧凑模式（默认 false，手机端零影响）：
  - `DesktopClock` 加 `compact`：时间字号 6.25rem→4.25rem，外边距收紧。
  - `CharacterWidget` 加 `compact`：卡片 96→80px、头像 68→56px。
  - `WidgetsPage` 加 `compact`：根 `pt-24 px-6`→`pt-0 px-0`，卡片 `p-6`→`p-4`，日期格 32→28px，事件卡去 `min-h`、每页 4→3 条。
  - `ScheduleHomeWidget` 视实测决定是否加 compact（隐藏时间线条）；不加也有左列内部滚动兜底。

验收视口：1024×768 / 1280×800 / 1366×768 / 1440×900 / 1920×1080 下主页整页无滚动、网格 App 全部可见；<640px 高允许内部滚动。

## 五、动效语言

中央 token 只放 `index.html` 动画块（沿用现有 CDN Tailwind `animate-*` 定义方式），不引动画库、不新增时长档位：

| token | 规格 | 用途 |
|---|---|---|
| `page-in-l` / `page-in-r` | opacity .35→1 + translateX ∓24px，280ms，`cubic-bezier(0.25,1,0.5,1)` | 有方向的翻页（keyed 挂新页） |
| `fade-soft` | 仅 opacity，220ms | 整页/tab 切换（重树 App 专用，禁 transform） |
| `jiggle-edit` | rotate ±0.8°，1.2s 循环 | 长按编辑态图标轻摆 |

全部配 `prefers-reduced-motion: reduce` 降级（动画/过渡 0.01ms）。`PerCharAvatarPicker.tsx` 的私有 `pcaSlide*` 迁移到中央 token。

硬切修复按四类模式：

1. **翻页类**：动作面板（常驻三页、`hidden` 切换）改 translateX track 保留内部状态；表情分组/分页、聊天壳设置 6 页、查手机选人分页、角色列表分页改 keyed 方向滑入（同 `PerCharAvatarPicker` 范式，需记录方向 state）。
2. **tab/view 类**：外观、日程、自习室、音乐、群聊列表↔聊天、查手机选人↔手机与 AI 服务 tab、手账 tab 改 keyed `fade-soft`。
3. **弹层类**：聊天壳面板入对齐 `slide-up`；群聊两个自定义底部弹层对齐 `Modal`（fade 遮罩 + slide-up 面板）；`Modal`/`ConfirmDialog`/`ErrorDialog` 用新 `hooks/useExitPresence.ts` 补关闭退场（保持挂载至动画结束，内部状态在退场期间冻结）。
4. **微交互**：列表首屏 stagger（角色/图库/设置分组，20ms/项、上限 10）；长按编辑态图标轻摆；弹层退场；按压/悬浮档位按 design-system 三档只补本次触碰文件。

## 六、验收

- 单测：`utils/launcherLayout.test.ts`、`utils/fitGrid.test.ts` 全绿；全量 `vitest run` 只增不减。
- 静态：触碰文件 `tsc --noEmit` 零命中（存量 48 错不算）；`mojibakeGuard` 绿；扫不到 U+FFFD。
- 手动：手机 393×852 像素级回归；三端互换同步；桌面 5 档视口一屏；新动效开/关 reduced-motion 检查；风车/滚轮翻页/鼠标拖拽分页不回退。

## 七、风险

- Launcher 状态提升是最高回归风险：先做「纯重构 commit」（手机行为不变），再做跨类互换。
- 重树 App 的切换动画禁 transform，避免整树栅格化卡顿（见 `PhoneShell.tsx:925-928` 既有教训）。
- 动作面板改 track 后容器高度取三页最大者（面板有 max-height + 滚动，可接受）。
- Dock 跨类拖动依赖 `elementFromPoint`，桌面 Dock 与内容区不能有 pointer-events 遮挡层。
