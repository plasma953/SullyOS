# SullyOS 回归 Vercel 纯 Web + 三端 UI 适配 · 实施计划（2026-09-11）

> **执行者须知**：按阶段执行，每阶段结束产出一个可在 Vercel 验收的版本。步骤用 checkbox 追踪。这是弱执行模型指引：每步自带文件路径、行号锚点、结构意图与验收命令，不要自行推断。

**Goal:** 主线回归 Vercel 浏览器版，删除 APK 出包线与投屏；手机/平板竖屏保持现有 UI，平板横屏与电脑全屏使用桌面 UI（左侧 Dock + 单 App 全尺寸内容区，延续玻璃风），全部 App 完成桌面适配。

**Architecture:** 单一 App 树不变，通过 `useLayoutMode()` 判定形态，在既有 App 根容器**外层**包桌面布局壳，业务组件与内层布局零复制。`DesktopHost` 升级为三态呈现器；`PhoneShell` 注入 `data-shell-layout`；`DesktopFrame`（手机框）仅用于电脑窗口化；`portalHost`/`hostViewport`/`wheelPager` 三桥复用不动。

**Tech Stack:** React 18 + TS + Vite + Tailwind（CDN 内联配置）+ IndexedDB；无新增依赖。

**Spec/依据:** 两份只读勘察报告；`docs/superpowers/specs/2026-09-09-multiplatform-sync-design.md` §5；`docs/design-system.md`。

---

## 一、用户已拍板决策

1. **APK**：归档（打 tag/分支）后**正向删除** Capacitor/Android 出包代码；保留对 Web 有益的修复（umami 清理、localhost 守卫等），不逐个 revert。
2. **投屏**：彻底删除 PiP。
3. **手机**：现有 UI 像素级不动。
4. **平板**：竖屏用手机版；横屏用桌面版。
5. **电脑**：全屏进入桌面 UI（左侧 Dock + 单 App 全屏，**不做多窗口**），窗口化保留现有手机框；**所有 App 全适配**。
6. **视觉**：延续现有玻璃风、壁纸、圆角、动效，只改信息密度与布局。

## 二、Global Constraints

- 手机竖屏（含平板竖屏、手机横屏）**行为与现状完全一致**，桌面档才走新布局。
- **不复制三套 App**：桌面布局只加壳，不改业务逻辑、不搬 state、不合并 effect。
- `renderApp` switch（PhoneShell.tsx:874-922）与 `APP_BY_ID`（PhoneShell.tsx:80-99）保持单一映射。
- 用户聊天自定义 CSS（`Chat.tsx:3628-3671` 守护样式 + `.sully-chat-*` 类）必须继续生效：桌面壳必须包在 `sully-chat-root` 内部或同级包裹，不能破坏类选择器命中。
- 番茄钟专注态（`PomodoroApp` SketchKit 手绘风）禁入桌面重排（`notes/ethernet-branch-context.md:28-32`）。
- 含中文文件每次改动后跑 `utils/mojibakeGuard.test.ts`；触碰文件 `tsc` 零新增命中（存量 48 错）。
- 提交信息用英文；每阶段一个或多个独立提交。

## 三、现状事实基线（执行时以这些行号为锚）

| 事实 | 位置 |
|------|------|
| 挂载链 `OSProvider > DesktopHost > MusicProvider > PhoneShell` | `App.tsx:40-51` |
| App 渲染分发 `renderApp` / `APP_BY_ID` | `PhoneShell.tsx:874-922` / `:80-99` |
| 懒加载预热 | `PhoneShell.tsx:19-72,474-549` |
| 桌面模式判定（900×600+pointer:fine） | `utils/desktopShell.ts:5-9` |
| 设置项 `desktopMode` / `desktopBackdrop` | `types.ts:295-297`；`apps/Appearance.tsx:1316-1364` |
| 手机框 `DesktopFrame`（393:852，`--vp-width`，portal host） | `DesktopFrame.tsx:19-55` |
| `DesktopHost` 现二态（框 / 投屏） | `DesktopHost.tsx:13-53` |
| 三桥 | `utils/portalHost.ts`、`utils/hostViewport.ts:17-29`、`utils/wheelPager.ts` |
| App 注册表 / Dock | `constants.tsx:93-144` / `:146` |
| 安全区与高度变量 | `index.html:129-133`，`--app-height:100lvh` `:133` |
| 风格契约 | `docs/design-system.md:13-65` |

## 四、响应式模型（唯一判定）

新增 `utils/layoutMode.ts`，**替换 900×600+pointer:fine** 作为布局判定（保留 `desktopMode` 用户覆盖）：

```
形态只有两种：'phone' | 'desktop'
判定： window.innerWidth >= 1024 && window.innerHeight >= 600  → 'desktop'
      （pointer:fine / hover 只决定桌面档的交互细腻度，不影响是否进入桌面布局）
覆盖： theme.desktopMode === 'on'  → 强制 'desktop'
      theme.desktopMode === 'off' → 强制 'phone'
```

覆盖矩阵：

| 设备 | 尺寸 | 形态 |
|------|------|------|
| 手机竖屏 | 393×852 | phone（铺满） |
| 手机横屏 | 852×393 | phone |
| 平板竖屏 | 768×1024 | phone |
| 平板横屏 | 1024×768 | desktop |
| 电脑窗口化 | 900×700 / 900×600 | phone-frame（保留手机框） |
| 电脑全屏 | 1440×900 / 1920×1080 | desktop |

`DesktopHost` 三态：

1. `desktop` → 渲染 `DesktopShell`（全屏桌面，无金属框）。
2. `phone` 且命中"窗口化框选"（`innerWidth>=900 && innerHeight>=600 && pointer:fine`）→ 现有 `DesktopFrame`。
3. 其余 → 透传（手机/平板铺满）。

## 五、本次会触碰的文件清单（按阶段）

**阶段 0（清理）**：`utils/pipWindow.ts`+test、`components/desktop/DesktopHost.tsx`、`components/desktop/DesktopFrame.tsx`、`apps/Appearance.tsx`、`android/**`、`capacitor.config.json`、`.env.capacitor`、`.github/workflows/build-apk.yml`、`scripts/sync-tiao-capacitor.ps1`、`docs/apk-build.md`、`docs/apk-smoke-checklist.md`、`docs/capacitor-fcm-tiao.md`、`plans/apk-audit-fixes-2026-09-10.md`、`index.tsx`、`components/PhoneShell.tsx`、`context/OSContext.tsx`、`utils/{chatParser,geo,speechToText,androidAppUpdate,platform,pushSubscribeShared,proactivePushConfig,keepAlive,activeMsgStore,activeMsgClient,nativeAmsgPush,nativeAmsgInbox,unifiedPushPlugin,unifiedPushRuntime,webdavClient,githubClient,shareExport,elevenLabsTts,fishAudioTts,minimaxEndpoint}.ts`(+tests)、`components/settings/AndroidUpdateControl.tsx`、`components/settings/VersionInfo.tsx`、`package.json`、`.gitignore`、`README.md`、`vite.config.ts`

**阶段 1（基础设施）**：`utils/layoutMode.ts`(新)+test、`utils/desktopShell.ts`、`components/desktop/DesktopHost.tsx`、`components/desktop/DesktopShell.tsx`(新)、`components/layout/AppScaffold.tsx`(新)、`components/layout/TwoPaneShell.tsx`(新)、`components/layout/MediaStageShell.tsx`(新)、`components/layout/CanvasShell.tsx`(新)、`components/layout/PhoneCenterShell.tsx`(新)、`components/Modal.tsx`、`components/PhoneShell.tsx`、`types.ts`、`index.html`

**阶段 2-6（App 适配）**：见第七节，各自 App 文件 + 必要时新增 `components/<domain>/*DesktopShell.tsx`

**阶段 7（收尾）**：`utils/buildInfo.ts`、`docs/design-system.md`、`CLAUDE.md`、`notes/ethernet-branch-context.md`

---

## 阶段 0：归档与清理（产出：功能回归、体积下降的 Web 版）

### Task 0.1 归档 APK 线
- [ ] `git branch apk-archive`（留存 android/ 与全部 APK 配置）；提交 `chore: archive apk line on branch apk-archive`
- 验收：`git branch --list apk-archive` 有输出。

### Task 0.2 删除投屏 PiP
- [ ] `apps/Appearance.tsx`：删 import `:18`、`pipActive` `:535`、按钮 `:1365-1374`
- [ ] `components/desktop/DesktopHost.tsx`：删 import `:4`、`pipActive` `:16-17`、PiP 分支 `:18-25`、`toggleCast` `:27-30`、按钮 `:37-50`
- [ ] `components/desktop/DesktopFrame.tsx`：删 `variant="pip"` prop（`:8,:11,:33-34`）
- [ ] 删 `utils/pipWindow.ts`、`utils/pipWindow.test.ts`（**保留 `portalHost.ts`**）
- 验收：`rg "pipWindow|toggleCast" apps components utils` 零命中；`vitest run` 全绿；提交 `refactor: remove pip cast feature`

### Task 0.3 删除 APK 出包链
- [ ] 删 `android/**`、`capacitor.config.json`、`.env.capacitor`、`.github/workflows/build-apk.yml`、`scripts/sync-tiao-capacitor.ps1`、`docs/apk-build.md`、`docs/apk-smoke-checklist.md`、`docs/capacitor-fcm-tiao.md`、`plans/apk-audit-fixes-2026-09-10.md`
- [ ] `package.json`：删 scripts `build:capacitor/cap:sync/cap:android`（`:9,11,12`）；删 12 个 `@capacitor*` 依赖与 devDeps
- [ ] `.gitignore:61-70` 删 android 段；`README.md:71,103-116` 删打包章节
- [ ] `vite.config.ts:182-184` 删 `vendor-capacitor` chunk 规则
- [ ] `pnpm install` 刷新 lockfile
- 验收：`node scripts/build-workers.mjs && node_modules/.bin/vite build` 成功；提交 `chore: remove capacitor android build pipeline`

### Task 0.4 删除原生引导与消费点
- [ ] `index.tsx:11-25` 删 `VITE_AMSG_NATIVE_PUSH` 分支与 `Capacitor` import；`:31-33` KeepAlive 守卫改回无条件 `KeepAlive.init()`
- [ ] `components/PhoneShell.tsx:111-114,696-738` 删原生 import 与 initNative/返回键 effect
- [ ] `context/OSContext.tsx:76-77,1009-1013` 删 LocalNotifications；简化 `!Capacitor.isNativePlatform()` 守卫（`:1859,:1932`）
- [ ] 删 `utils/{androidAppUpdate.ts(+test),nativeAmsgPush.ts(+test),unifiedPushPlugin.ts,unifiedPushRuntime.ts,platform.ts}`、`components/settings/AndroidUpdateControl.tsx`、`utils/keepAlive.capacitor.test.ts`
- [ ] 清 `utils/chatParser.ts:2,549-551`、`geo.ts:1,33-52`（保留 geolocation）、`speechToText.ts:13,110-139`、`pushSubscribeShared.ts:167,212,263`、`proactivePushConfig.ts:569-600`、`activeMsgStore.ts:33`、`activeMsgClient.ts:110,113`、`VersionInfo.tsx:5,112`
- 验收：`vitest run` 全绿；`rg "@capacitor|Capacitor\.|VITE_AMSG_NATIVE_PUSH" --glob '!node_modules' --glob '!dist'` 仅剩 Task 0.5 待清文件；提交 `refactor: drop native capacitor runtime hooks`

### Task 0.5 删除 CapacitorHttp 回退（单独提交，最高回归风险）
- [ ] `utils/{webdavClient,githubClient,shareExport,elevenLabsTts,fishAudioTts,minimaxEndpoint}.ts`：删 `@capacitor/core` 的 `CapacitorHttp` 原生分支，**保留 fetch 路径**
- 验收：备份导出、WebDAV 读写、GitHub 客户端、三家 TTS 各手动走一遍 Web 路径；提交 `refactor: remove capacitor http fallbacks`

### Task 0.6 push 到测试通道（需用户确认）
- [ ] 经用户确认后 `git push origin ethernet`（含未 push 的 umami 修复与本次删除）
- 验收：Vercel 部署成功，线上手机版全功能可用。

---

## 阶段 1：布局基础设施（产出：桌面全屏空壳 + 手机零变化）

### Task 1.1 `utils/layoutMode.ts`（新）+ 测试
- [ ] 导出：`type LayoutMode = 'phone' | 'desktop'`；`resolveLayoutMode(theme, viewport, env): LayoutMode`；`useLayoutMode(theme)` hook（resize + `matchMedia` 监听）
- [ ] 保留 `utils/desktopShell.ts` 的 `isDesktopViewport` 作为"窗口化框选"判定（`:5-9` 不变），`desktopShell.test.ts` 不动
- 验收：`vitest run utils/layoutMode.test.ts` 覆盖第四节全矩阵；提交 `feat(layout): add unified layout mode resolver`

### Task 1.2 `components/desktop/DesktopShell.tsx`（新）
- [ ] 左侧 Dock：复用 `DOCK_APPS`（constants.tsx:146）+ 可展开全部 `INSTALLED_APPS`；顶部状态/时钟条；内容区 `data-sully-viewport` + `data-sully-portal-host`（调 `setPortalHost`）；背景复用 `DesktopBackdrop`
- [ ] 单 App 全屏：内容区渲染同一个 App 分发结果（把 `renderApp` 提取为可共享模块或经 props 传入）
- 验收：桌面全屏看不到手机框，左 Dock 可切 App；提交 `feat(desktop): add fullscreen desktop shell with left dock`

### Task 1.3 `DesktopHost` 三态化
- [ ] `DesktopHost.tsx`：按 `useLayoutMode` 渲染 `DesktopShell` / `DesktopFrame` / 透传
- 验收：矩阵四档切换正确；提交 `feat(desktop): three-state host (desktop / phone-frame / passthrough)`

### Task 1.4 PhoneShell 注入与 portal 归属
- [ ] `PhoneShell.tsx`：根加 `data-shell-layout={mode}`；桌面档下 portal host 指向 DesktopShell 内容根
- [ ] `index.html`：桌面档基础样式（内容区最小宽度、滚动容器）用内联 `<style>`（无构建 purge）
- 验收：手机/平板竖屏截图与改前逐像素一致；提交 `feat(layout): expose shell layout to css`

### Task 1.5 共享布局壳组件
- [ ] `components/layout/AppScaffold.tsx`：props `{ title?, sidebar?, maxWidth?, children }`（吸顶头→桌面浮动条 + 限宽 + 空态插槽）
- [ ] `components/layout/TwoPaneShell.tsx`：`{ nav, children, navWidth=320 }`
- [ ] `components/layout/MediaStageShell.tsx`：`{ stage, side }`
- [ ] `components/layout/CanvasShell.tsx`：`{ toolbar, canvas, inspector }`
- [ ] `components/layout/PhoneCenterShell.tsx`：`{ children }`（居中 `max-w-[430px]`）
- [ ] `components/Modal.tsx`：桌面档底弹改居中卡（`max-w-[520px]`）
- 验收：各壳有浅渲染测试；提交 `feat(layout): add shared desktop shell primitives`

---

## 阶段 2：Launcher 桌面网格
- [ ] `apps/Launcher.tsx`：根 `:986` 按 mode 分叉——桌面档渲染「左时钟/角色卡列 + 右 4 列网格 `max-w-5xl` 居中 + 底部居中 dock」；复用现有拖拽 `:723-950`、wheelPager `:699-709`、页码 `:1201-1217`；三套皮肤 `:968-983` 桌面档保持整页自渲染
- 验收：桌面档网格/拖拽/切页正常；手机与平板竖屏不变；提交 `feat(launcher): desktop grid layout`

## 阶段 3：B 组 · 聊天系（最大文件，只动外层）

| App | 桌面壳 | 锚点 | 严禁 |
|-----|--------|------|------|
| GroupChat | 双栏：list `:1604` 作左栏，chat `:1715` 作右栏 | 包住两个顶层 return | 动 Modal `:1656`、portal `:2355,2370` |
| Chat | 中央列 `max-w-3xl` 居中 + 浮动玻璃 header + 输入栏限宽 | 在 `sully-chat-root:3620` **内部**包壳 | 动 `:3628-3671` 守护 CSS、`:4534` FAB、`:4618` portal、props 链 `:3614-3618,4204` |
| TerminalApp | 会话列表左栏 + 主区 | 根 `:610-611` | 动 opencode 代理链 |

- [ ] 新增 `components/chat/ChatDesktopShell.tsx`（slot 接收 header/滚动区/输入栏）
- [ ] 逐个提交；验收该 App 既有测试 + 双档截图；`feat(chat): desktop layout for group chat`、`feat(chat): desktop centered column`、`feat(terminal): desktop two-pane`

## 阶段 4：A/G 组 · 列表与表单（TwoPaneShell）

Settings、Appearance、Character、Gallery、Journal、Worldbook、Guidebook、Handbook、Preset、UserApp、HotNews、FAQ、Novel、XhsStock、Bank、Social、Schedule、StudyApp(书架)

- [ ] Settings：零 DOM 移动，根 `:1995` 内加左锚点导航（由 `SettingsSection` 标题数组驱动 `:147`），滚动区 `:2026` 变右栏；`sysOperation` 遮罩 `:1998-2010` 保持全屏
- [ ] Appearance：同 Settings 结构（含移除投屏后的桌面设置区 `:1316-1364`）
- [ ] 其余按表加 `TwoPaneShell` 或在 `AppScaffold` 内限宽
- 每个 App 独立提交；验收既有测试 + 双档截图

## 阶段 5：C/D 组 · 媒体与画布

| 组 | App | 壳 |
|----|-----|-----|
| C 媒体 | Music、Songwriting、VoiceDesigner、CallApp | MediaStageShell（CallApp 只在 `:3429` 根内 `:3466` 层分叉，保留 `.sully-call-hero` 与视频三档选择器） |
| D 画布 | ThemeMaker、CharCreatorDev、MemoryPalace(仅外包壳，禁改 inline style)、LifeSim、RoomApp/WorldHome | CanvasShell / AppScaffold |

- MemoryPalace：只在 `:5686`/palace 主视图外包限宽；该文件在存量 tsc 错误名单，以零新增为验收
- 每个 App 独立提交

## 阶段 6：E/F 组 · 沉浸与竖屏小程序

| 组 | App | 壳 |
|----|-----|-----|
| E 沉浸 | VRWorld、DateApp(剧情)、DreamTheater、GameApp(play)、Pomodoro(仅设置/结束态) | ImmersiveShell（`fixed z-[300]` 覆盖层改居中卡；番茄钟专注态禁入） |
| F 竖屏小程序 | Shopping、Takeout、XhsFreeRoam、Tarot、CheckPhone(一期仅外包壳) | PhoneCenterShell（居中 `max-w-[430px]`） |

- 每个 App 独立提交

## 阶段 7：收尾
- [ ] `utils/buildInfo.ts:17` 版本号 bump（现 `v3.11 (Remote Terminal)`）
- [ ] `docs/design-system.md` 增加桌面布局语言；`CLAUDE.md` 文档地图；`notes/ethernet-branch-context.md` 更新 APK 已归档
- 提交 `docs: document desktop layout language`

---

## 六、验收命令（每阶段统一）

```powershell
node scripts/build-workers.mjs
node_modules\.bin\vite.CMD build
node_modules\.bin\vitest.CMD run                      # 基线 427 文件 / 5025 用例，只增不减
node_modules\.bin\vitest.CMD run utils/mojibakeGuard.test.ts
node_modules\.bin\tsc.CMD --noEmit -p tsconfig.json   # 触碰文件零新增命中
```

截图矩阵（手动）：393×852、852×393、768×1024、1024×768、1180×820、900×600、1280×800、1440×900、1920×1080。

## 七、风险
1. **CapacitorHttp 删除**（0.5）波及备份/WebDAV/TTS，必须真机冒烟后再删依赖。
2. **断点 900→1024** 改变窗口化临界，需同步更新 `desktopShell.test.ts`，保留 `desktopMode` 逃生口。
3. **Chat 用户自定义 CSS** 在桌面双栏可能错位，验收含"坏 CSS 注入仍可退出"用例。
4. **tailwind CDN 无 purge**，桌面样式只能用既有 utility + 内联 style。
5. **嵌入式双重头**（WorldHome embedded / RoomApp 全屏态）需核对，避免双返回键。
6. 所有阶段必须 push 才被 Vercel 测试通道看到（`notes:69`）。

## 八、明确不做
- 电脑端多窗口/窗口管理（用户选单 App 全屏）。
- 平板第三套双栏布局（复用 phone / desktop 两档）。
- 番茄钟专注态桌面重排。
- MemoryPalace inline style 体系重构、CheckPhone 内部双栏（二期）。
- worker/、VPS、Caddy 任何改动。
