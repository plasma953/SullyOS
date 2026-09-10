# APK 构建指南

SullyOS 的 Android APK 有两种出包方式。web bundle 必须用 **capacitor 模式**构建（`--mode capacitor` 读取 `.env.capacitor`，把原生推送初始线打包进 App：Android 走 `utils/unifiedPushRuntime.ts`、其余原生平台走 `utils/nativeAmsgPush.ts`，见下「推送现状」）；普通 `pnpm build` 出的是纯 Web 版，不含这些原生线。

## 方式一：GitHub Actions（推荐）

仓库 → **Actions** → **Build APK** → **Run workflow**。构建成功后在 run 页面下载 artifact `sullyos-apk`，传到手机安装（允许未知来源）。

流程：`pnpm install` → `vite build --mode capacitor` → `npx cap sync android` → `gradlew assembleDebug` → 上传 artifact。

## 方式二：本地脚本（上游 TIAO 流程，需 wrapper 仓）

```powershell
powershell -ExecutionPolicy Bypass -File scripts\sync-tiao-capacitor.ps1
```

该脚本依赖本地 Capacitor Android 壳工程（上游路径 `D:\CHICK\CHICK2`，含图标与本地配置，不在本仓库）。只同步不打包加 `-SkipAndroidBuild`。本仓库的 `android/` 目录是 2026-09 按上游 `capacitor.config.json` 重新生成的壳，供 CI 与本地构建共用。

## 推送现状（2026-09-10 审计后改真）

当前 `android/` 壳工程**不含任何原生推送实现**（无 FCM gradle 依赖，也无 UnifiedPush connector），因此：

- `index.tsx` 在 Android 上会尝试初始化 UnifiedPush 运行时（`utils/unifiedPushRuntime.ts`），
  但 `AmsgUnifiedPush` 插件没有 Java 侧实现，注册会安静失败（console.warn），不影响启动。
- **实际推送形态 = 打开 App 补收**（amsg2 outbox 机制）：消息到达设备时不弹系统通知，
  用户下次打开 App 时补进聊天。主动消息的到达语义完好，只是没有离屏提醒。
- 上面的行为是 spec §7.1 C2 的降级版：原规划 FCM/UnifiedPush 二选一恢复离屏推送，
  两条线都需要给 `android/` 壳补原生实现（FCM：gradle 插件 + google-services.json；
  UnifiedPush：org.unifiedpush.android-connector 依赖 + Java 插件 + ntfy 无 Firebase 版），
  目前都没做。`capacitor-fcm-tiao.md` 是上游遗留文档，其流程在本仓库壳上不生效。

**结论：想要离屏推送，需要单独的「原生推送实现」工程（改 android/ 壳 + CI），不在日常出包流程内。**

## 注意事项

- **签名**：CI 产物是 debug 签名。若手机上装有上游签名的 APK，先卸载再安装（签名不一致 Android 拒绝覆盖安装）。
- **OTA 更新清单**：`.env.capacitor` 的 `VITE_APK_UPDATE_MANIFEST_URL` 已置空（2026-09-10，fork 自用不检查上游更新）。要恢复 OTA 检查，填自己的 Pages 清单地址。
- 包名 `com.aetheros.simulator` 与上游/FCM 绑定，**不要改**；`appName`（手抓糯米机）是桌面显示名，可随意改。
