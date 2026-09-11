# 电脑端占位组件缩小 + 全 App 按钮动效 · 执行计划（2026-09-11）

> **执行者须知**：按步骤顺序执行。每步自带文件路径、行号锚点与验收判据；行号来自 2026-09-11 的只读扫描，若工作区被其他窗口改过导致对不上，先用本文件末尾的扫描脚本重新生成清单，再自下而上逐行改。禁止用 shell 重定向写文件；含中文的 oldString 只从 Read 工具输出逐字取。手机端必须零变化。

**Goal:** ①电脑端一些被窗口拉得过大的占位/网格组件（日记角色卡、自习室导入教材卡、相册人物、相册照片、购物商品、日记空白角色页）缩小到合理尺寸；②全 App 按钮在选中/取消/点击时有舒适过渡（外卖分类按钮是典型缺口）。

**Architecture:**
- A 部分：用 `utils/layoutMode.ts:38` 的 `useLayoutMode(theme.desktopMode)`（布局形态唯一事实来源）在 App 内加 `isDesktop` 分支，桌面端网格改 `repeat(auto-fill, minmax(...))` 自适应小卡、日记空白页改限宽限高居中。手机端分支类名与现状逐字节一致。
- B 部分：`index.html` 加两条中央 CSS 规则（所有按钮及其子元素的颜色/描边/阴影状态过渡兜底 + 无 `active:` 档位按钮的轻压兜底），另把 49 个「已声明 transition 但只过渡 transform/opacity、选中变色仍瞬跳」的按钮手工升级为 `transition-all`。

**Tech Stack:** React 18 + TS + Tailwind（CDN 内联配置）+ 纯 CSS；无新增依赖。

**依据:** `docs/design-system.md`（§二/§三/§五）、`notes/ethernet-branch-context.md`（动效硬约定）、`plans/2026-09-11-app-view-motion-coverage.md`（视图级动效已覆盖，本批是按钮级）。

---

## 一、本次会触碰的文件清单

**A 部分：**
- `apps/Gallery.tsx`
- `apps/StudyApp.tsx`
- `apps/ShoppingApp.tsx`
- `apps/JournalApp.tsx`

**B 部分中央规则：**
- `index.html`

**B 部分 49 处手工批（18 文件）：**
`apps/CheckPhone.tsx`、`apps/FAQApp.tsx`、`apps/Gallery.tsx`、`apps/GameApp.tsx`、`apps/GroupChat.tsx`、`apps/JournalApp.tsx`、`apps/RoomApp.tsx`、`apps/ScheduleApp.tsx`、`apps/VRWorldApp.tsx`、`apps/WorldHomeApp.tsx`、`apps/pixelHome/PixelRoomEditor.tsx`、`components/StatusBadge.tsx`、`components/chat/ChatInputArea.tsx`、`components/os/ConfirmDialog.tsx`、`components/os/TamagotchiHome.tsx`、`components/schedule/ScheduleAppearanceButton.tsx`、`components/settings/ActiveMsgGlobalSettingsModal.tsx`、`components/settings/BluetoothPanel.tsx`

**收尾文档：**
- `docs/design-system.md`、`notes/ethernet-branch-context.md`、`utils/buildInfo.ts`

---

## 二、B1 中央规则（`index.html`）

在 `<style>` 里、`input:focus` 规则（约 `:259-261`）之后、`@media (prefers-reduced-motion: reduce)` 块（`:294`）之前插入：

```css
      /* 按钮状态过渡兜底：选中/取消/悬停时的颜色、描边、阴影、按压不再瞬跳。
         已自带 transition-* 工具类的按钮优先级更高（类选择器 > 元素选择器），保留各自时长与属性；
         子元素一并兜底，因为不少按钮的选中样式（分类 chip 的底/圈）挂在按钮内的 span 上。 */
      button, button * {
        transition:
          color 200ms cubic-bezier(0.4, 0, 0.2, 1),
          background-color 200ms cubic-bezier(0.4, 0, 0.2, 1),
          border-color 200ms cubic-bezier(0.4, 0, 0.2, 1),
          box-shadow 200ms cubic-bezier(0.4, 0, 0.2, 1),
          opacity 200ms cubic-bezier(0.4, 0, 0.2, 1),
          filter 200ms cubic-bezier(0.4, 0, 0.2, 1),
          transform 150ms cubic-bezier(0.4, 0, 0.2, 1),
          scale 150ms cubic-bezier(0.4, 0, 0.2, 1);
      }
      /* 没有 active: 档位的按钮补统一轻压反馈。用 scale 属性而非 transform，避免盖掉按钮
         自身用于定位的 transform（如 -translate-x-1/2）；:not([class*="inset-0"]) 跳过整屏遮罩按钮。 */
      button:not(:disabled):not([class*="active:"]):not([class*="inset-0"]):active {
        scale: 0.98;
      }
```

同时在 `@media (prefers-reduced-motion: reduce)` 块内追加一行（与现有 `animation-duration: 0.01ms !important` 同风格）：

```css
        button, button * {
          transition-duration: 0.01ms !important;
        }
```

验收：`index.html` 里能搜到 `button, button *`；无 CSS 语法错误（`vite build` 通过）；不动森/主题下无异常。

---

## 三、B2 手工批 · 49 处清单（行号锚点）

**替换规则（逐行）**：
- 该按钮 className 里的 `transition-transform` 无显式时长 → 换成 `transition-all duration-200`；
- 带 `duration-XXX` 的（仅 `RoomApp.tsx:2012` 的 `transition-transform duration-300`）→ 换成 `transition-all duration-300`；
- `transition-opacity`（`GameApp.tsx:1621`）→ 换成 `transition-all duration-200`；
- 一次只改 transition 那一小段，className 其余部分（条件三元、主题变量）原样不动；
- 同一文件有多处时 **从最大行号往小改**，避免行号漂移。

| # | 文件 | 行号 | 现值 | 改为 |
|---|------|------|------|------|
| 1 | `apps/CheckPhone.tsx` | 243 | 条件类里含 transition-transform（整行拼写较长，用 Read 核对） | `transition-all duration-200` |
| 2 | `apps/CheckPhone.tsx` | 4374 | `active:scale-95 transition-transform ${confirmState?...}` | `active:scale-95 transition-all duration-200 ${...}` |
| 3 | `apps/FAQApp.tsx` | 363 | `active:scale-[0.98] transition-transform` | `active:scale-[0.98] transition-all duration-200` |
| 4 | `apps/Gallery.tsx` | 361 | `active:scale-95 transition-transform border border-white/10 ${...}` | `active:scale-95 transition-all duration-200 border ...` |
| 5 | `apps/GameApp.tsx` | 1523 | `active:scale-95 transition-transform ${showParty ? ...}` | `transition-all duration-200 ${...}` |
| 6 | `apps/GameApp.tsx` | 1621 | `hover:opacity-100 transition-opacity flex ...` | `hover:opacity-100 transition-all duration-200 flex ...` |
| 7 | `apps/GameApp.tsx` | 1802 | `active:scale-95 transition-transform flex ... ${showTools ? ...}` | `transition-all duration-200 flex ...` |
| 8 | `apps/GameApp.tsx` | 1811 | `active:scale-95 transition-transform flex ...` | `transition-all duration-200 flex ...` |
| 9 | `apps/GroupChat.tsx` | 1931 | `active:scale-95 transition-transform ${canReroll ? ...}` | `transition-all duration-200 ${...}` |
| 10 | `apps/JournalApp.tsx` | 1191 | `transition-transform active:scale-90 ${s.css}` | `transition-all duration-200 active:scale-90 ${s.css}` |
| 11 | `apps/JournalApp.tsx` | 1213 | `active:scale-90 transition-transform ${showStickerPanel ? ...}` | `active:scale-90 transition-all duration-200 ${...}` |
| 12 | `apps/RoomApp.tsx` | 2012 | `transition-transform duration-300 z-[300] ${...}` | `transition-all duration-300 z-[300] ${...}` |
| 13 | `apps/ScheduleApp.tsx` | 467 | `active:scale-90 transition-transform ${currentThemeMode === 'minimal' ? ...}` | `transition-all duration-200 ${...}` |
| 14 | `apps/ScheduleApp.tsx` | 481 | 同上 | 同上 |
| 15 | `apps/ScheduleApp.tsx` | 488 | 同上 | 同上 |
| 16 | `apps/ScheduleApp.tsx` | 614 | `p-1.5 rounded-full active:scale-90 transition-transform ${theme.accent}` | `transition-all duration-200 ${theme.accent}` |
| 17 | `apps/ScheduleApp.tsx` | 616 | 同上 | 同上 |
| 18 | `apps/VRWorldApp.tsx` | 1056 | `active:scale-[0.98] transition-transform ${room.implemented ? ...}` | `transition-all duration-200 ${...}` |
| 19 | `apps/WorldHomeApp.tsx` | 1202 | `active:scale-95 transition-transform` | `active:scale-95 transition-all duration-200` |
| 20 | `apps/WorldHomeApp.tsx` | 1207 | 同上 | 同上 |
| 21 | `apps/WorldHomeApp.tsx` | 1714 | `active:scale-[0.99] transition-transform` | `active:scale-[0.99] transition-all duration-200` |
| 22 | `apps/pixelHome/PixelRoomEditor.tsx` | 1085 | `active:scale-95 transition-transform ${color}` | `active:scale-95 transition-all duration-200 ${color}` |
| 23 | `components/StatusBadge.tsx` | 89 | `active:scale-95 transition-transform` | `active:scale-95 transition-all duration-200` |
| 24 | `components/chat/ChatInputArea.tsx` | 428 | `active:scale-95 transition-transform flex items-center just...` | `active:scale-95 transition-all duration-200 flex ...` |
| 25-45 | `components/chat/ChatInputArea.tsx` | 649,657,664,672,678,686,694,705,719,727,747,766,784,801,812,826,836,847,857,868 | 统一片段 `active:scale-95 transition-transform `（766 后面跟 `relative`） | 统一片段 `active:scale-95 transition-all duration-200 ` |
| 46 | `components/os/ConfirmDialog.tsx` | 86 | `shadow-lg transition-transform active:scale-95 ${getBtnColor()}` | `shadow-lg transition-all duration-200 active:scale-95 ${...}` |
| 47 | `components/os/TamagotchiHome.tsx` | 1066 | `${characters.length > 1 ? 'active:scale-90 transition-transform' : ''}` | `'active:scale-90 transition-all duration-200'` |
| 48 | `components/schedule/ScheduleAppearanceButton.tsx` | 205 | `transition-transform active:scale-[.98] ${selected...}` | `transition-all duration-200 active:scale-[.98] ${...}` |
| 49 | `components/settings/ActiveMsgGlobalSettingsModal.tsx` | 543 | `active:scale-95 transition-transform disabled:opacity-40 ${...}` | `transition-all duration-200 disabled:opacity-40 ${...}` |
| 50 | `components/settings/BluetoothPanel.tsx` | 269 | `active:scale-95 transition-transform ${notifying ? ...}` | `transition-all duration-200 ${...}` |

> 表内 25-45 的 ChatInputArea 统一片段可直接对 `flex flex-col items-center gap-2 active:scale-95 transition-transform ` 做 replaceAll（改前先 `rg -c` 确认该片段出现 21 次；766 行的 `relative `${` 也在其中，replaceAll 后逐行抽看 3 处）。其余文件的相同 `active:scale-95 transition-transform` 若在文件内只对应上表行号，可 replaceAll；否则单独 Edit。

验收：`rg -n "transition-transform" apps components` 的剩余命中不再包含上表行；随机抽 5 个按钮点开看样式过渡。

---

## 四、A 部分 · 桌面端 6 处

### A0 通用接法（每 App 顶部）
- `apps/Gallery.tsx:19`：`const { closeApp, characters, apiConfig, addToast } = useOS();` → 增加 `theme`；
- `apps/StudyApp.tsx:345`：同样增加 `theme`；
- `apps/ShoppingApp.tsx:49`：同样增加 `theme`；
- `apps/JournalApp.tsx:70` 已有 `theme`，不动；
- 三个没有 hook 的文件在 import 区加 `import { useLayoutMode } from '../utils/layoutMode';`，并在 useOS 行后加 `const isDesktop = useLayoutMode(theme.desktopMode) === 'desktop';`；Journal 在 `:70` 后同样加一行。**位置必须在任何条件 return 之前**。

### A1 Gallery 相册人物网格（`:283`）
```tsx
<div className={`grid gap-5 p-5 animate-fade-in ${isDesktop ? 'grid-cols-[repeat(auto-fill,minmax(176px,1fr))]' : 'grid-cols-2'}`}>
```
### A2 Gallery 照片网格（`:338`）
```tsx
<div className={`grid gap-1 ${isDesktop ? 'grid-cols-[repeat(auto-fill,minmax(132px,1fr))]' : 'grid-cols-3'}`}>
```
### A3 Gallery 空态（`:326`）
`col-span-2` → `col-span-full`（手机 2 列时视觉不变）。

### A4 StudyApp 书架网格（`:1994`）
```tsx
<div className={`grid gap-4 ${isDesktop ? 'grid-cols-[repeat(auto-fill,minmax(150px,1fr))]' : 'grid-cols-2'}`}>
```
「导入教材」卡与课程卡自动随之变小；卡内 `line-clamp-3` 标题、进度条不动。

### A5 ShoppingApp 商品网格（`:488`）+ 空态（`:502`）
```tsx
<div className={`px-3 pb-24 grid gap-2 ${isDesktop ? 'grid-cols-[repeat(auto-fill,minmax(150px,1fr))]' : 'grid-cols-2'}`}>
```
`:502` 的 `col-span-2` → `col-span-full`。

### A6 JournalApp 选本网格（`:971`）
```tsx
<div className="sully-journal-notebook-grid p-6 grid grid-cols-2 gap-5 overflow-y-auto pb-20 no-scrollbar"
     style={isDesktop ? { maxWidth: 860, marginLeft: 'auto', marginRight: 'auto' } : undefined}>
```
（用内联 style 是因为各主题 CSS 对 `.sully-journal-notebook-grid` 的 `grid-template-columns/margin` 有更高优先级的覆盖，类名改不动；限宽不冲突，列模板保留。）

### A7 JournalApp 空白角色页（`:787`）+ 父容器（`:1161`）
`:788` 根 div：
```tsx
<div className={`sully-journal-empty bg-[#252525] rounded-3xl border border-white/5 flex flex-col items-center justify-center text-white/40 gap-4 p-8 text-center ${isDesktop ? 'w-full h-full max-w-sm max-h-[420px] m-auto' : 'w-full h-full'}`}>
```
`:1161`（非拼贴布局的角色页容器）加 `flex flex-col`：
```tsx
<div key={activeTab} className="h-full flex flex-col animate-fade-soft">
```
让 `m-auto` 能垂直居中；拼贴布局的父级 `.sully-journal-spread-page` 是 grid 项，`m-auto` 天然居中。

验收：桌面 1440×900 下——相册人物约 190px 小卡、照片约 132px 缩略图、书架约 160px 书卡、购物约 158px 商品卡、日记选本网格整体约 860px 居中、写日记切到角色页是小号紧凑占位（≤384×420）且居中；手机 393×852 与改前逐项一致；四套日记主题（邮局/星夜/野外/午夜）与自定义皮肤下不破版。

---

## 五、门禁（每阶段结束统一跑）

```powershell
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
corepack pnpm@9.15.9 vitest run
corepack pnpm@9.15.9 vitest run utils/mojibakeGuard.test.ts
node_modules\.bin\tsc.CMD --noEmit -p tsconfig.json   # 触碰文件零新增命中（存量错误不管）
node_modules\.bin\vite.CMD build
```

FFFD 字节扫（输出只有数字才可信）：
```powershell
@'
import os
bad=0
for root in ['apps','components']:
    for dp,dn,fn in os.walk(root):
        for f in fn:
            if f.endswith(('.tsx','.ts','.css','.html')):
                p=os.path.join(dp,f)
                if b'\xef\xbf\xbd' in open(p,'rb').read(): bad+=1; print('HIT',p)
print('FFFD_FILES',bad)
'@ | python -
```
改动过 `index.html`（含中文注释）后也可对单文件跑同一逻辑：`python -c` 读字节查 `b'\xef\xbf\xbd'`，只打印 ASCII。

---

## 六、收尾

1. `docs/design-system.md` §五（动效）追加：中央按钮状态过渡两条规则 + 按压兜底（`scale:0.98`，用 `scale` 属性避免冲突）；§三/§六 不新增语言。
2. `notes/ethernet-branch-context.md` 仓库现状追加一行（本批改了什么、验收数字、未 push 状态）。
3. `utils/buildInfo.ts:17` `v3.13 (Dock & Motion)` → `v3.14 (Desktop Details)`。
4. 不 commit / 不 push（经用户确认后再做；push 后 Vercel 测试通道才可见）。

## 七、明确不做

- 手机端任何视觉变化；
- 番茄钟（手绘风专区）；
- Chat/GroupChat 双栏、弹窗桌面居中（D6 退场批）；
- 外卖/购物整机限宽；
- 非 `<button>` 元素（div 假按钮、list row）的动效补全；
- 不改 `transition-*` 之外的按钮类名、不动主题 CSS 文件。

---

## 执行状态（2026-09-11）

- ✅ B1：`index.html:262-280` 中央两条规则 + `:321-323` reduced-motion 降级。
- ✅ B2：49 处全部升级（`transition-transform`/`transition-opacity` → `transition-all duration-200`，`RoomApp:2012` 保留 `duration-300`）；复扫「动态类按钮只过渡 transform/opacity」残留 0。
- ✅ A：Gallery `:283/:338/:326`、Study `:1995`、Shopping `:489/:503`、Journal `:972/:789/:1164`（行号为改后近似）+ 三处 `isDesktop` 接线（Gallery/Study/Shopping 补 `theme` 解构与 `useLayoutMode` 导入，Journal 已有 `theme`）。
- ✅ 门禁：全量 425 文件 / 5031 用例全绿；`tsc --noEmit` 45 存量错误、触碰文件零命中；mojibakeGuard 绿；22 个触碰文件 FFFD/BOM 扫描 0；`vite build` 通过。
- ✅ 文档：`docs/design-system.md` §三/§五、`notes/ethernet-branch-context.md`、`utils/buildInfo.ts` `v3.14 (Desktop Details)`。
- ✅ 提交 `a522ec49`，已 push origin/ethernet；待用户在桌面/手机双档实测（外卖分类按钮过渡、各网格尺寸、reduced-motion）。
