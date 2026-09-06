# Desktop Shell Phase 2（PiP 投屏悬浮窗）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chromium 上一键把手机界面搬进系统级置顶小窗（Document Picture-in-Picture），可操作、可缩放；关闭恢复原状；非 Chromium 无按钮无影响。

**Architecture:** `utils/pipWindow.ts` 封装 open/move/bridge/restore 全生命周期；`#root` 整节点 move（React 状态零丢失，逻辑仍跑主窗口）；PiP 会话期间的桥全部可逆，关闭即还原。

**Tech Stack:** Document Picture-in-Picture API（Chrome 116+/Edge）；React 18 root 容器事件跟节点走；测试同 Phase 1。

**Spec:** `docs/superpowers/specs/2026-09-06-desktop-shell-design.md`（§7 + §9 PiP 部分）

**Depends on:** Phase 1 全部完成（`getPortalHost`、`data-sully-viewport`、`DesktopFrame`、`desktopMode` 字段）。

## Global Constraints

- 与 Phase 1 相同（ethernet 分支、英文 commit、只加真实文件、UTF-8 无 BOM、中文只从 Read 取、tsc 触碰文件零命中、护栏测试）。
- PiP 相关代码必须 Chromium 鉴权：`'documentPictureInPicture' in window`，不支持则不渲染按钮、不执行任何逻辑。
- 所有 PiP 会话态（portal host 切换、visibility 覆写、事件桥、占位页）必须在 restore 时完整还原；二次打开不残留监听。

---

### Task 1: utils/pipWindow.ts 核心（open/move/restore + 样式/变量迁移）

**Files:**
- Create: `utils/pipWindow.ts`
- Create: `utils/pipWindow.test.ts`（首行 `// @vitest-environment jsdom`；只测纯 helper + mock 行为）
- Test: `utils/pipWindow.test.ts`

**Interfaces:**
- Consumes: Phase 1 的 `setPortalHost`
- Produces:
  - `isPipSupported(): boolean`
  - `openPipShell(opts: { width: number; height: number }): Promise<Window | null>`
  - `closePipShell(): void`
  - `isPipActive(): boolean`
  - 内部：`cloneStylesTo(pipDoc)`（克隆全部 `style` + `link[rel=stylesheet]` 节点）、`syncPipVars(pipWin)`（复制 `documentElement` 的 `data-*`/class + 内联 CSS 变量，设 `--app-height = pipWin.innerHeight + 'px'`）、`moveRootTo(pipDoc)` / `restoreRoot()`（记录原父节点 + 占位符 + nextSibling）

TS 类型：文件内 `declare global` 补 `documentPictureInPicture` 最小形状（`requestWindow(opts): Promise<Window>`），不污染全局 d.ts。

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { isPipSupported, PIP_WINDOW_FALLBACK_SIZE } from './pipWindow';

describe('pipWindow basics', () => {
    it('无 API 时不支持', () => {
        expect(isPipSupported()).toBe(false);
    });
    it('默认窗口尺寸在 PiP 合法范围内', () => {
        expect(PIP_WINDOW_FALLBACK_SIZE.width).toBeGreaterThanOrEqual(200);
        expect(PIP_WINDOW_FALLBACK_SIZE.height).toBeGreaterThanOrEqual(100);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm@9.15.9 vitest run utils/pipWindow.test.ts`
Expected: FAIL

- [ ] **Step 3: Write implementation**（核心流程）：

```ts
export const PIP_WINDOW_FALLBACK_SIZE = { width: 420, height: 900 };

export const isPipSupported = (): boolean =>
    typeof window !== 'undefined' && 'documentPictureInPicture' in window;

// open: requestWindow → cloneStyles → syncVars(+dataset/class) → 插占位 → move #root →
//       setPortalHost(pipDoc.body) → 装事件桥（Task 2）→ 监听 pip pagehide 自动 restore。
// restore: root 移回占位处 → 删占位 → setPortalHost(null) → 拆桥（Task 2）→ 关窗（若还开着）。
```

细节：`requestWindow` 前把尺寸 clamp 到 `window.screen.availWidth/availHeight`；`cloneStylesTo` 只 clone 节点不读 cssRules（避 CORS）；`syncPipVars` 复制项：`--app-height`、`--safe-top`、`--safe-bottom`、`--chrome-top`、`--standalone-safe-area-top/bottom`、`--visual-viewport-height`、`--keyboard-inset`、`--primary-hue/sat/lightness`、`--sully-emoji-size` + `dataset.skin` + `className`；PiP `resize` 监听更新 `--app-height`。

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm@9.15.9 vitest run utils/pipWindow.test.ts`
Expected: PASS

- [ ] **Step 5: tsc scoped + Commit**

```bash
git add utils/pipWindow.ts utils/pipWindow.test.ts
git commit -m "feat(pip): core move/restore lifecycle"
```

### Task 2: 事件桥 + visibility 覆写 + 音频 resume

**Files:**
- Modify: `utils/pipWindow.ts`（追加 bridge 模块；Task 1 的 open/restore 钩入 install/uninstall）
- Test: 手动清单为主；单测覆盖可纯测部分（如 bridge 转发表）

**Interfaces:**
- Consumes: Task 1 的 open/restore 钩子
- Produces: `installPipBridge(pipWin): () => void`（返回卸载函数；转发 `keydown/keyup`（`new KeyboardEvent(type, e)` 重放主 window）、`resize`（只更新 vars，不调主 `setViewportVars`）、`visibilitychange`（主 document 重派 + PiP 期间 `document.visibilityState` getter 覆写为 pip 值，卸载时 `delete` 恢复）；音频 resume：move 前记录 `root.querySelectorAll('audio,video')` 中 `!paused && !ended` 者，move 后逐个 `.play().catch(()=>{})`）

- [ ] **Step 1: 实现 bridge + 音频 resume**（全部包在 try/catch，桥失败不阻断开窗）
- [ ] **Step 2: Chrome 手动验证**：开窗 → 主窗口敲键盘（协同窗口快捷键）→ 切 PiP 前后台（visibility 日志）→ 播音乐后开窗（不断流或自动恢复）→ 关窗还原
- [ ] **Step 3: Commit**

```bash
git add utils/pipWindow.ts
git commit -m "feat(pip): event bridge and media resume"
```

### Task 3: 投屏按钮 + 占位页 + Appearance 入口

**Files:**
- Modify: `components/desktop/DesktopFrame.tsx`（外框侧边悬浮「投屏」按钮；`isPipSupported()` 为 false 不渲染；PiP 激活态按钮变「收回」调 `closePipShell`）
- Modify: `apps/Appearance.tsx`（电脑显示 section 加一行投屏按钮，同 fate；不支持则整行隐藏）
- Modify: `components/desktop/DesktopHost.tsx`（PiP 期间主窗口渲染「投屏中」占位：沿用 Appearance 卡片风，提示去悬浮窗操作 + 收回按钮）
- Test: tsc scoped + 手动

- [ ] **Step 1: 按钮 + 占位 + 入口**
- [ ] **Step 2: tsc scoped check**（`pipWindow|Desktop|Appearance` 零命中）
- [ ] **Step 3: Commit**

```bash
git add components/desktop/DesktopFrame.tsx components/desktop/DesktopHost.tsx apps/Appearance.tsx
git commit -m "feat(pip): cast button and placeholder"
```

### Task 4: PiP 验证 + 回归 + 收尾

- [ ] **Step 1: PiP 手动清单（Chrome/Edge）**：开/关/二次开 / 缩放窗口框自适应 / 输入框打字 / 聊天收发 / portal 浮层（小剧场/Applook）出现在 PiP 内 / 拖拽面板不飞出 / 长按手势 / 通话音频 / 关闭后主窗口完整恢复无残留监听（Performance 面板确认）
- [ ] **Step 2: Firefox/Safari 确认**：无投屏按钮，其他功能正常
- [ ] **Step 3: 全量回归**

Run: `corepack pnpm@9.15.9 vitest run`
Expected: 全绿（与 Phase 1 收尾基线一致）
Run: `corepack pnpm@9.15.9 vitest run utils/mojibakeGuard.test.ts`
Expected: PASS

- [ ] **Step 4: Commit + push**

```bash
git push origin ethernet
```

（各 Task 已随做随 commit；本 Task 无新文件则只 push。纯前端变更，VPS 不动。）
