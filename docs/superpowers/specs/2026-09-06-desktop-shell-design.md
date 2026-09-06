# 桌面端显示适配（Desktop Shell + PiP 投屏）· 设计文档

- 日期：2026-09-06
- 分支：`ethernet`
- 目标：在电脑浏览器上把 SullyOS 装进一个仿真手机外框里（灵动岛旗舰风），框外背景用当前壁纸的模糊放大版或主色调纯色；再叠加 Document PiP 置顶投屏，实现「手机投屏到电脑上操作」。
- 总原则：**所有适配只在 PC 端生效，手机端代码路径与行为零改动。**

## 1. 现状勘测（只读结论）

- 入口链：`index.html`（`#root`，L278；根样式 `--app-height/100vw`，L142-160）→ `index.tsx`（L44-54）→ `App.tsx`（52 行，外壳 `h=var(--app-height)`，L24-27）→ `components/PhoneShell.tsx`（L967 根 `relative w-full h-full`；壁纸层 L971-980；内容层 L989-996；常驻 `StatusBar` L1016）。
- 外壳已有 `transform: translateZ(0)`（`App.tsx` L35-38）：transform 祖先是 fixed 后代的包含块，所以手机内部的 `position: fixed` 浮层会被外壳自动框住，这也是现有 portal 逃到 body 的原因。
- 壁纸：`OSTheme.wallpaper / lockWallpaper`（`types.ts` L123-125）；JSON 进 localStorage `os_theme`（`OSContext.tsx` L3099-3100），图片二进制进 IndexedDB `blob_assets`（指针字段，L514-582）。形态有图片（blobref/objectURL/http）和 CSS 渐变串（默认 `DEFAULT_WALLPAPER`，`OSContext.tsx` L457-461）。渲染：`documentElement/body` 背景（`PhoneShell.tsx` L783-799）、桌面壁纸层（L969-980）。
- 主色调提取现成工具：`utils/dominantHue.ts`（`hueFromImage` L65-80、`hueFromGradient` L83-96），但只产出色相，需扩展完整代表色。
- 桌面/宽屏适配基本没有；唯一宽屏先例 `CompanionHome.tsx` L2083 的 `(orientation:landscape) and (min-width:720px)`。
- 设置组织：`apps/Appearance.tsx`（系统主题 tab，外观类：skin/`desktopVariant`/statusBarMode，选项卡片样式见 L1293-1321）+ `apps/Settings.tsx`（系统级开关）。新字段走 `updateTheme`（`OSContext.tsx` L2977 起）即自动持久化。
- 长按已有双线模式：`apps/Appearance.tsx` L55-111 `LongPressArea`（touch 计时 + 非 touch pointer 计时 + `onContextMenu`），鼠标长按在该模式下可用；`onTouchStart` 全仓约 30+ 处，最多的 `DateSession.tsx` 5 处——Phase 1 做审计确认，不预设合成桥。
- `document.body` portal 共 17 处（Chat 小剧场 L3920/4586、GroupChat L2379、Amsg2DebugPanel L415、MemoryRepairPortal L747、McpMemoryModal L151、VoiceFavoritesPortal L484 等）；`window.innerWidth/innerHeight` 约 27 处（拖拽 clamp 6 文件、Live2D 画布 7 处）；全局 keydown 约 11 处；`100vw/vh/svh/lvh/dvh` 字面量约 60 处（40 文件）。PiP 相关 API 全仓 0 处，绿地。

## 2. 架构

新增「桌面外壳」包在现有结构之外，手机内部 UI 不感知：

```
#root
└── DesktopHost（新增：桌面判定 + 背景层 + 居中框 + 投屏按钮）
    ├── DesktopBackdrop（新增：模糊壁纸 / 主色纯色）
    └── DesktopFrame（新增：外框 + 灵动岛 + 侧边键 + 阴影）
        └── sully-viewport（屏幕区：transform translateZ(0)，fixed 自动被框住）
            ├── sully-portal-host（桌面模式 portal 宿主，fixed inset-0）
            └── （现有 App 结构原样：OSProvider > PhoneShell）
```

改动集中在挂载点与三个新组件，`PhoneShell` 及各 App 不动。

## 3. 桌面模式判定与设置

- 判定函数 `isDesktopViewport()`：`innerWidth ≥ 900 && innerHeight ≥ 600 && matchMedia('(pointer: fine)')`；hook 监听 resize 动态切换。真手机永不触发。
- `OSTheme` 新增 `desktopMode: 'auto' | 'on' | 'off'`（默认 `auto`）、`desktopBackdrop: 'blur' | 'color'`（默认 `blur`）。
- 设置 UI 放 `apps/Appearance.tsx` 系统主题 tab，与 statusBarMode 并排，复用现有选项卡片样式（`rounded-2xl border` + active 态 `border-primary bg-primary/10`）。
- 风格硬约定：沿用 ethernet 现有卡片/圆角/动效节奏（见 `Appearance.tsx` L1293-1321），不引入新视觉语言。

## 4. 手机外框 DesktopFrame

- 纯 CSS：黑色金属边框（渐变高光模拟金属）、外圆角 56px / 内屏 44px、顶部灵动岛胶囊（装饰层 `pointer-events-none`，与 StatusBar 预留的 notch 区兼容）、右侧电源键 + 左侧音量键（伪元素）、大范围柔和投影。
- 屏幕区固定纵横比 393:852，高度 `min(92vh, 上限)`，宽度按比例；窄窗口按宽收缩（min 保护）。
- 屏幕区容器 inline 覆写 CSS 变量：`--app-height`（框内像素高）、`--safe-top: 0`、`--chrome-top` 等——内部读变量的代码自动适配，手机路径不变。
- 屏幕区带 `transform: translateZ(0)`（与 `App.tsx` 现有手法一致），内部 fixed 浮层自动被框住。

## 5. 背景层 DesktopBackdrop

- `blur`（默认）：当前壁纸全屏 cover + `blur(60px)` + 压暗 + `scale(1.1)` 防白边；壁纸为渐变串时直接铺渐变再模糊。
- `color`：扩展 `dominantHue.ts` 新增代表色函数（完整 RGB/HSL，由 24×24 采样直方图取众数桶中心），结果缓存；壁纸变化实时跟随（`theme.wallpaper` 驱动）。

## 6. PC 端适配桥（只在桌面模式生效）

- `utils/portalHost.ts`：`getPortalHost()`，桌面模式返回框内 `sully-portal-host`，否则 `document.body`；17 处 portal 调用点机械替换。
- `utils/hostViewport.ts`：`getHostViewport(el)`，沿祖先找 `[data-sully-viewport]` 取 `getBoundingClientRect`，否则回退 window；`innerWidth/innerHeight` 布局读取（拖拽 clamp、Live2D 画布、ThemeMaker、DateApp 等 ~27 处）改走它。
- vw/vh 字面量审计（~40 文件）：外壳内部的 `100vw/100vh` 改容器相对（`w-full/h-full/var(--app-height)`），portal 层的保留；手机上语义等价。
- 触屏手势：审计 `onTouchStart` 用点（重点是 Chat 消息操作、DateSession、`LongPressArea` 覆盖情况），确认鼠标可用性；若发现触屏独占的关键路径，先补 pointer 双线（仿 `LongPressArea`），合成 TouchEvent 桥只作最后备选且需 spike 验证。

## 7. PiP 投屏（Phase 2，Chromium only）

- 入口：外框侧边「投屏悬浮窗」按钮 + Appearance 设置项；`'documentPictureInPicture' in window` 检测，不支持自动隐藏。
- 流程：`requestWindow({width:420, height:900})` → 克隆全部 `<style>/<link rel=stylesheet>` 进 PiP 文档 → **整个 `#root` DOM 节点 move 进 PiP body**（React 18 事件挂根容器，跟节点走，状态零丢失；所有逻辑仍跑在主窗口，不存在双实例竞争）→ PiP 文档重建 CSS 变量并随 resize 更新 → 关闭（`pagehide`）时 move 回主文档。
-  PiP 会话期间的桥（关闭即还原）：keydown/keyup/resize/visibilitychange 从 PiP 文档转发主 window；`document.visibilityState` getter 临时覆写；portal host 切到 PiP body；音频元素跨文档 move 后检测暂停并自动 resume（spike 验证）。
- PiP 期间主窗口显示「投屏中」占位页；PiP 窗内复用同一 `DesktopFrame`（细边框 variant）。

## 8. 埋点（按 docs/analytics.md 规矩）

- 不新增事件；`desktopMode/desktopBackdrop` 当前值进 `utils/analyticsSnapshot.ts`「当前外观」快照（desktopMode 报 `auto/on/off`，backdrop 报 `blur/color`，均为写死枚举）。
- 在 `analyticsSnapshot.test.ts` 给新字段塞毒药串；在 `docs/analytics.md` 事件清单补行。

## 9. 测试计划

- 单测：`isDesktopViewport` 判定、`dominantHue` 代表色、`getPortalHost`；
- 回归：`pnpm vitest run` 全量通过，tsc 判据为本次触碰文件零命中，`mojibakeGuard` 无 FFFD；
- 手动：桌面外框验证清单（缩放/换壁纸/切换 backdrop/开关模式/窄窗回退）、PiP 验证清单（Chrome/Edge：开/关/缩放/输入/音频/portal 浮层）；
- 现有钉住测试（CompanionHome 720px media query 等）不破坏。

## 10. 分期与验收

- **Phase 1**：§3-§6 + §8 + §9 桌面部分。验收：电脑宽屏自动进框、手机端像素级无变化。
- **Phase 2**：§7 + PiP 清单。验收：Chromium 一键投屏置顶，关闭恢复；非 Chromium 无按钮无影响。
- 收尾：`APP_VERSION` 升版（大功能，`utils/buildInfo.ts`），清理临时文件。
