# 全 App 视图进入/退出动效覆盖 · 执行计划（2026-09-11 · 阶段 D）

- 前置：`plans/2026-09-11-launcher-dock-motion-plan.md`（阶段 C 已把翻页/tab/共享弹层做进统一语言）
- 盘点结论：4 份只读盘点覆盖 ~40 个 App：
  - 整屏视图切换全硬切的高频 App：MemoryPalace（9 个早 return 零动画 + 3 处内联 `fade-in` 关键帧名错误导致动画失效）、RoomApp、WorldHome、VRWorld、LifeSim、ThemeMaker、CheckPhone 内部子视图、DateApp、CallApp、Terminal、Browser、Journal、Guidebook、Novel、Songwriting、GameApp、Takeout、Shopping、XhsStock、Handbook、FAQ、Tarot、Bank、Social、VoiceDesigner、XhsFreeRoam、Worldbook。
  - 覆盖层缺入场约 65 处（含 Mcd/Luckin、Chat 两个 chrome sheet、CheckPhone 酒馆皮肤、Terminal 三抽屉、Guidebook 8 个弹层、StoryTheater 系列等）；缺退场约 50 处（只有共享 Modal/ConfirmDialog/ErrorDialog 有）。

## 动效策略（本阶段统一口径）

1. **整屏导航**：前进/钻入（list→detail、picker→palace、tab→全屏场景）= 目标页 `animate-page-in-l`；返回 = `animate-page-in-r`；用 `navDir` 状态记录方向，视图根加 `key={view}` 强制重挂载以重放动画（同类型 div 不重挂载则动画不重播）。
2. **平级 tab/分区**：`animate-fade-soft`（keyed）。
3. **覆盖层入场**：遮罩 `animate-fade-in`、底部面板 `animate-slide-up`。
4. **覆盖层退场**：接 `useExitPresence`（保持挂载至退场动画结束）——先做高频覆盖层，逐批推进。
5. 手绘风（番茄钟专注态）、`prefers-reduced-motion` 禁区不动。

## 批次与状态

- [x] **D1 记忆宫殿**（本次）：`navDir` + `navTo` + `key={view}`；picker/palace/all/boxes/room/memory/settings/globalSettings 全方向化；停用提示/性格检测/分析结果改 `fade-soft`；修 3 处 `animation:'fade-in'` 失效（改 `animate-fade-in` 类）；角色切换面板补 `fade-soft`。
- [x] **D2 场景类**（已完成）：RoomApp（select/room/pixelHome 方向化 + 梦境外层）、PixelHomeView（map/room/各工具方向化）、WorldHome（list/edit/world + PhoneModal 入场 + tab 淡入）、VRWorld（App 根/4 tab/RoomScene/ReaderModal/HelpModal/各类 sheet）、ThemeMaker（tab 升级 fade-soft + 预览全屏 + 底部面板）、LifeSim（加载/tab/6 覆盖层）、PersonaSim 与 DreamTheater 各 phase 根。
- [x] **D3 通讯内容类**（已完成）：CheckPhone 全部子视图（SubAppShell 统一入场 + key 重挂载）、DateApp（select/history/peek/settings/session/StoryTheater + StoryTheater 子视图）、CallApp（4 视图 + 可改的覆盖层）、Terminal（3 tab + 3 抽屉）、Browser（WebRenderer）、Journal（select/calendar/write）、Chat（装扮面板/chrome 两 sheet/McD/Luckin/小剧场/心象弹窗）。
- [x] **D4 列表工具类**（已完成）：Novel、Songwriting、GameApp、Guidebook、Handbook（组件根承载动画）、FAQ、Takeout、Shopping、XhsStock、Tarot、Bank、Social、VoiceDesigner、XhsFreeRoam、Worldbook；Gallery 原本各 view 已有 fade-in，未重复加。
- [ ] **D5 覆盖层入场批**：剩余盘点表中未覆盖的组件型覆盖层（ChibiStudio、CreatorPartsUploader、handbook 选择/录入/编辑、BankDollhouse、CallSetupGuide/UserCameraModePicker/VRoidBetaWarning/Live2DActionSettings、FilesTab、ScheduleAppearance、JournalAppearance、MessageItem 上下文、ObserveHUD、LifeRecordPanel、PerCharAvatarPicker、CompanionHome/Tamagotchi/MobileGame 抽屉、节日事件弹层等）。
- [ ] **D6 覆盖层退场批**：`useExitPresence` 接入高频覆盖层（Chat 小剧场/装扮/McD/Luckin、Terminal 抽屉、Call sheets、StoryTheater、XhsFreeRoam、Social 详情/发帖、Bank 情报志等）。
- [x] **D5 覆盖层入场批**（已完成）：Call/Chat/Handbook/Bank/Date story/ChibiStudio/CreatorPartsUploader/ImpressionPanel/LifeRecordPanel/ScheduleAppearance/JournalAppearance/FilesTab/MessageItem/VoiceFavoriteActionSheet/WorldHome 弹层、MusicApp 歌词对轴、CheckPhone 酒馆皮肤等 40+ 处补「遮罩 fade-in + 面板 slide-up/pop-in」；皮肤主屏与 VRWorld 此前多数已有动画，跳过。
- [ ] **D6 覆盖层退场批**（下一步）：`useExitPresence` 接入高频覆盖层——Chat 小剧场/装扮/chrome 两 sheet/McD/Luckin、Terminal 三抽屉、Call sheets、StoryTheater 系列、XhsFreeRoam、Social 详情/发帖、Bank 情报志等。页面级「退出」已由返回目标的入场动画覆盖；本批只处理浮层关闭时的淡出。
- [ ] **D7 门禁**：全量 vitest + mojibake + tsc 触碰零新增 + FFFD 扫描 + 构建；文档与版本记录。

## 验收口径

- 每个 App：进入子视图有方向过渡、返回有反向过渡；tab 有淡入；覆盖层有入场（补退场的批次另有淡出）。
- 手机 393×852 与电脑桌面档都不回归；reduced-motion 下全部即时。
