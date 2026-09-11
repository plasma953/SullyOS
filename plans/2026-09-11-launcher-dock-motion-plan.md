# 启动器 Dock 互换 + 桌面主页一屏化 + 全机动效补全 · 执行计划（2026-09-11）

> 执行者须知：按阶段执行，每阶段结束跑门禁并独立 commit。步骤自带文件路径、行号锚点与验收命令；行号以开工时 `ethernet`（HEAD `75631744` 之后）为准，编辑前先重新读文件确认。
> 设计依据：`docs/superpowers/specs/2026-09-11-launcher-dock-motion-design.md`；风格契约：`docs/design-system.md`。

## 全局纪律

- 写文件只用 Write/Edit；绝不用 shell 重定向写文件；含中文的 oldString 只从 Read 输出逐字取；bash 命令参数避免中文；commit message 用英文。
- 包管理器 `corepack pnpm@9.15.9`；测试基线以开工时 `vitest run` 实测为准（只增不减）。
- 每阶段门禁：`corepack pnpm@9.15.9 vitest run` → `corepack pnpm@9.15.9 vitest run utils/mojibakeGuard.test.ts` → `corepack pnpm@9.15.9 exec tsc --noEmit`（本次触碰文件零命中）。
- 工作区有大量 CRLF 噪音，commit 只加本计划触碰的文件；push 与否听用户。
- 手机竖屏（含平板竖屏、窗口化手机框）行为/像素不变；桌面档才走新布局。

## 本次触碰文件

**新增**：`utils/launcherLayout.ts(+test)`、`utils/fitGrid.ts(+test)`、`context/LauncherLayoutContext.tsx`、`hooks/useLauncherDrag.ts`、`hooks/useExitPresence.ts`、`components/desktop/DesktopAppGrid.tsx`、本 spec/plan。
**修改**：`apps/Launcher.tsx`、`components/desktop/DesktopDock.tsx`、`components/PhoneShell.tsx`、`index.html`、`components/chat/ChatInputArea.tsx`、`components/appearance/ChatAppearanceEditor.tsx`、`components/user/PerCharAvatarPicker.tsx`、`components/os/Modal.tsx`、`components/ConfirmDialog.tsx`、`components/ErrorDialog.tsx`、`apps/{CheckPhone,Character,Appearance,ScheduleApp,StudyApp,MusicApp,GroupChat,JournalApp}.tsx`、`components/schedule/ScheduleHomeWidget.tsx`（按需）、`utils/buildInfo.ts`、`docs/design-system.md`、`notes/ethernet-branch-context.md`。
**不触碰**：`worker/`、`vps-backend/`、皮肤主屏、番茄钟手绘风、其他未列 App。

---

## 阶段 A：Dock↔主屏互换（三端一致）

### A1. `utils/launcherLayout.ts` + 测试
- 导出：`LauncherKind`、`DOCK_SLOTS = 4`、`normalizeDockOrder`、`normalizeAppOrder`、`reorderIds`、`swapDockAndGrid`、`sameOrder`（签名见 spec 二节）。
- `utils/launcherLayout.test.ts` 用例：Dock 默认补位/去重/坏 id/超 4 截断；网格去 Dock 成员、已存序优先、新 App 补尾；`reorderIds` 前移后移与不存在 id；`swapDockAndGrid` 双向对调 + 单侧缺失原样返回；`sameOrder`。
- 验收：`corepack pnpm@9.15.9 vitest run utils/launcherLayout.test.ts` 全绿。

### A2. `context/LauncherLayoutContext.tsx`
- 状态：`devDebugVisible`（`isDevDebugAvailable` + `subscribeDevDebugAvailability`）、`dockOrder/appOrder`（初值 normalize `theme.*`）、`editing`、`appOrderRef/dockOrderRef`。
- effect：`editing` 为 true 时跳过 theme 同步；dock 以 `theme.launcherDockOrder` 为准 normalize，app 以 `prev`/`theme.launcherAppOrder` normalize（用 `sameOrder` 防抖）。
- 派生：`gridApps/dockApps`（`INSTALLED_APPS` map）。
- `drop(source, target)`：同类 → `reorderIds`；app↔dock → `swapDockAndGrid`；随后 `updateTheme({launcherAppOrder, launcherDockOrder})`。
- 渲染 children + 拖拽四类 `<style>`（从 `apps/Launcher.tsx:1054-1077` 原样搬移）。
- `useLauncherLayout()` 未在 Provider 内时抛错。
- 验收：`tsc` 触碰文件零命中。

### A3. `hooks/useLauncherDrag.ts`
- 从 `apps/Launcher.tsx:795-952` 抽移：长按 520ms、9px 取消、ghost 克隆（`launcher-drag-ghost`）、`elementFromPoint('[data-launcher-item]')` 目标高亮、`suppressClickUntil` ref、`cancelDrag()`。
- 选项：`{ editing, beginEdit, onDrop, canBeginEdit=true, onPageTurn?, onPageTurnEnd? }`；目标合法条件 = 同类 或 app↔dock；widget 只同类。
- 落点记录 `lastTargetKind`，up 时回调 `onDrop(source, target)`；unmount 清理 ghost/定时器。
- 验收：`tsc` 零命中。

### A4. Launcher 手机分支纯重构
- 删除本地 `devDebugVisible/availableGridApps/normalizeOrder/launcherAppOrder/launcherDockOrder/appOrderRef/dockOrderRef` 与两道同步 effect（改由 Provider）；`gridApps/dockAppsConfig` 改读 Provider；`layoutEditing` 别名 Provider `editing`。
- 拖拽：根节点指针 props 换 `{...drag.handlers}`；`reorderByTarget` 换本地路由（widget → 本地 `reorderIds(pinwheelOrderRef.current)` + `updateTheme({launcherPinwheelOrder})`；其余 → Provider `drop`）；`queueLayoutPageTurn` 保留为回调传入 hook（去掉对旧 pointer 的引用，改用 `drag.clearDropTarget()`）。
- 行为/像素不变：Dock 仍 4 格同款、页码点/滚轮/鼠标拖拽分页不动。
- 验收：手机回归手动看（Dock 位置、编辑长按、同类排序、翻页）；`vitest run` 全绿。

### A5. DesktopDock + PhoneShell + 桌面网格接入
- `components/PhoneShell.tsx:888` 起：`<LauncherLayoutProvider>` 包住根 div（须在 `useOS` 之下、所有提前 return 之后）。
- `components/desktop/DesktopDock.tsx`：删 `QUICK_EXTRAS/APP_BY_ID`；`dockApps` 来自 Provider；Home + 4 格渲染；条目加 `data-launcher-item`/`data-launcher-kind="dock"`；接 `useLauncherDrag({ editing: editable && editing, canBeginEdit: editable, ... })`，`editable = activeApp === AppID.Launcher`；编辑态不触发 `openApp`。
- `apps/Launcher.tsx` 桌面分支（当前 `:989-1041`）：网格 `apps` 改 Provider `gridApps`，根挂 `drag.handlers`，编辑态显示提示条（复用手机样式）。
- 验收：手机换 Dock 图标 → 电脑端显示一致；反向互换；Dock 恒 4 格。

### A6. 阶段 A 收尾
- 全量门禁 + mojibake + tsc；英文 commit：`feat(launcher): shared dock/grid layout with cross-container swap`。

---

## 阶段 B：电脑端主页一屏化

### B1. `utils/fitGrid.ts` + 测试
- `computeFitGrid`：签名与算法见 spec 四节；`count<=0` 返回 `{cols:1, rows:0, cell:maxCell, scroll:false}`；`minCell` 兜底时 `cols = floor((width+gapX)/(minCell+gapX))`（至少 1），`scroll=true`。
- 测试：大容器取 maxCell、受限容器选最优列、极小容器 scroll、count=0、宽高为 0。
- 验收：`vitest run utils/fitGrid.test.ts` 绿。

### B2. `components/desktop/DesktopAppGrid.tsx`
- `{ apps, openApp, editing }`；ResizeObserver 测容器 → `computeFitGrid`；`--app-icon-size` = `clamp(cell-42, 40, 56)`；条目保留 `data-launcher-item/kind="app"` 与 `launcher-edit-item`；`scroll` 时容器内部滚动。
- 验收：`tsc` 零命中。

### B3. 桌面主页重写 + compact 小组件
- `apps/Launcher.tsx` 桌面分支：`h-full overflow-hidden` + 两列 flex（左 `clamp(280px,22vw,340px) min-h-0 overflow-y-auto no-scrollbar`，右 `min-w-0 flex-1`）；`DesktopAppGrid` 放右列；编辑提示条 `absolute top`；保留 `ScheduleFullscreenViewer`。
- `DesktopClock`/`CharacterWidget`/`WidgetsPage` 加 `compact?: boolean`（默认 false）；桌面分支传 true；手机分支不传。
- 若 1366×768 实测左列仍溢出，再给 `ScheduleHomeWidget` 加 compact（隐藏 Timeline，`p-3`）；以左列可内部滚动为兜底。
- 验收：1024×768 / 1280×800 / 1366×768 / 1440×900 / 1920×1080 手动看一屏；手机端不传 compact，回归不变。

### B4. 阶段 B 收尾
- 门禁 + commit：`feat(desktop): one-screen home with adaptive app grid`。

---

## 阶段 C：动效补全 + 微交互

### C1. 中央 token（`index.html` 动画块 `:46-117`）
- 新增 `page-in-l` / `page-in-r` / `fade-soft` / `jiggle-edit` 四个 animation + keyframes；`:root` 或单独 `<style>` 加 `@media (prefers-reduced-motion: reduce)` 把 `.animate-*` 四者降级（0.01ms / iteration 1）。
- `components/user/PerCharAvatarPicker.tsx:106-111` 私有 keyframes/类删除，改用中央 `page-in-l/r`（`slideDir` 逻辑不变）。

### C2. 翻页类
- `ChatInputArea.tsx:630-640`：动作面板三块 `hidden` 改 `w-[300%]` track + `translateX(-page*33.333%)` + `transition-transform duration-280`（包一层 `overflow-hidden`，保持各页常驻与内部状态）；触屏/滚轮共用同一状态。
- `ChatInputArea.tsx:565` 表情分页/分组：记 `emojiSlideDir`，keyed 包裹 `animate-page-in-l/r`。
- `ChatAppearanceEditor.tsx:656-670` 六页：记方向，keyed 包裹。
- `CheckPhone.tsx:3896-3941` 选人分页、`Character.tsx:1518-1530` 列表分页：同法。
- 验收：每处在手机上肉眼有滑入过渡（用户手动）。

### C3. tab/view 类（纯淡入）
- 外观 `:936`、日程 `:521`、自习室各 mode 根、音乐各 view 根、群聊 `:1604/1715`、查手机 `:3879` 与 AI 服务 tab、手账 `:1146`：内容外包 `key={activeTab/mode/view}` 的 `animate-fade-soft` 容器；重树禁 transform。
- 验收：切换有 220ms 淡入；无卡顿。

### C4. 弹层类
- `hooks/useExitPresence.ts`：`{ open, duration }` → `{ mounted, phase: 'in'|'out' }`，动画结束（timeout 兜底）后卸载。
- `components/os/Modal.tsx`、`ConfirmDialog.tsx`、`ErrorDialog.tsx` 接 hook：关闭时先播退场再卸载。
- `ChatAppearanceEditor.tsx:628-631` 面板入场 `animate-slide-up`；`GroupChat.tsx:2335/2376` 两个底部弹层对齐 Modal 语言。
- 验收：开/关都有动效，reduced-motion 下即时。

### C5. 微交互
- 列表首屏 stagger：角色列表、图库网格、设置分组卡——按 index 加 20ms `animation-delay`（上限 10 项），只首屏。
- 编辑态图标 `jiggle-edit`（launcher 拖拽 `<style>` 里给 `.launcher-edit-item` 加动画，reduced-motion 关闭）。
- 按压档位审计：本次触碰文件里，图标 95 / 小按钮 90 / 卡片 98，缺则补 `active:scale-* + transition`。
- 验收：手动抽看，不引入新时长/新 easing。

### C6. 阶段 C 收尾
- 门禁 + commit：`feat(motion): unify page/panel transitions and edit jiggle`。

---

## 收尾

- `utils/buildInfo.ts`：`v3.12` → `v3.13`（大功能批次）。
- `docs/design-system.md` 五节补新 token 与动效语言；`notes/ethernet-branch-context.md` 追加一行记录；`CLAUDE.md` 文档地图如需加指向。
- 全量门禁四项 + 字节扫 FFFD（预期 0）；commit `docs: record launcher dock, one-screen home and motion batch`。
- 按用户确认决定是否 `git push origin ethernet`（push 后 Vercel 测试通道才可见）。
