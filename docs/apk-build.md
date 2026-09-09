# APK 构建指南

SullyOS 的 Android APK 有两种出包方式。web bundle 必须用 **capacitor 模式**构建（`--mode capacitor` 读取 `.env.capacitor`，把 `utils/nativeAmsgPush.ts` 原生推送桥打进包）；普通 `pnpm build` 出的是纯 Web 版，不含原生桥。

## 方式一：GitHub Actions（推荐）

仓库 → **Actions** → **Build APK** → **Run workflow**。构建成功后在 run 页面下载 artifact `sullyos-apk`，传到手机安装（允许未知来源）。

流程：`pnpm install` → `vite build --mode capacitor` → `npx cap sync android` → `gradlew assembleDebug` → 上传 artifact。

## 方式二：本地脚本（上游 TIAO 流程，需 wrapper 仓）

```powershell
powershell -ExecutionPolicy Bypass -File scripts\sync-tiao-capacitor.ps1
```

该脚本依赖本地 Capacitor Android 壳工程（上游路径 `D:\CHICK\CHICK2`，含图标与本地配置，不在本仓库）。只同步不打包加 `-SkipAndroidBuild`。本仓库的 `android/` 目录是 2026-09 按上游 `capacitor.config.json` 重新生成的壳，供 CI 与本地构建共用。

## FCM 原生推送（可选）

按 [`capacitor-fcm-tiao.md`](./capacitor-fcm-tiao.md) 配置：Firebase 建 Android App（包名 `com.aetheros.simulator`）→ `google-services.json` 放 `android/app/` → AMSG Worker 配三个 FCM Secrets。不配则 APK 内推送降级为打开 App 补收（amsg2 outbox 机制）。

## 注意事项

- **签名**：CI 产物是 debug 签名。若手机上装有上游签名的 APK，先卸载再安装（签名不一致 Android 拒绝覆盖安装）。
- **OTA 更新清单**：`.env.capacitor` 的 `VITE_APK_UPDATE_MANIFEST_URL` 当前指向上游 `qegj567-cloud.github.io/SullyOS/sullyos-update.json`。fork 自用应改成自己的 Pages 地址或留空（否则更新检查打到上游）。
- 包名 `com.aetheros.simulator` 与上游/FCM 绑定，**不要改**；`appName`（手抓糯米机）是桌面显示名，可随意改。
