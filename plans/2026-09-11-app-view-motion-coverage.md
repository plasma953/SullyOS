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
- [ ] **D2 场景类**：RoomApp（含 pixelHome 六视图）、WorldHome（list/edit/world + PhoneModal tabs）、VRWorld（4 tab + RoomScene/ReaderModal/HelpModal）、LifeSim（3 tab + 6 overlay）、ThemeMaker（主/子 tab + 预览全屏 + 底部编辑面板）、PersonaSim/DreamTheater 各 phase 根。
- [ ] **D3 通讯内容类**：CheckPhone 内部 activeAppId 子视图（10+，走共享 SubAppShell）、DateApp（5 mode + StoryTheater 子视图）、CallApp（role-select/history/record-detail + 7 覆盖层）、Terminal（3 tab + 3 抽屉）、Browser（首页↔正文）、Journal（select/calendar/write）、Chat（TheaterPlayer、ThinkingChainSettingsModal、两个 chrome sheet 入场）。
- [ ] **D4 列表工具类**：Novel、Songwriting、GameApp、Guidebook、Handbook、FAQ、Takeout、Shopping、XhsStock、Tarot、Bank、Social、VoiceDesigner、XhsFreeRoam、Worldbook、Gallery（方向升级）。
- [ ] **D5 覆盖层入场批**：按盘点表逐条补（Mcd/Luckin 6、Guidebook 8、StoryTheater 系列 8、Chat 4、Call 7、Terminal 3、CheckPhone 1、Music 1、Shopping/Takeout 2、ScheduleAppearance、JournalAppearance、TheaterPlayer、ChibiStudio、CreatorPartsUploader、handbook 4、bank/call 组件 8 等）。
- [ ] **D6 覆盖层退场批**：`useExitPresence` 接入高频覆盖层（Chat 小剧场/装扮/McD/Luckin、Terminal 抽屉、Call sheets、StoryTheater、XhsFreeRoam、Social 详情/发帖、Bank 情报志等）。
- [ ] **D7 门禁**：全量 vitest + mojibake + tsc 触碰零新增 + FFFD 扫描 + 构建；文档与版本记录。

## 验收口径

- 每个 App：进入子视图有方向过渡、返回有反向过渡；tab 有淡入；覆盖层有入场（补退场的批次另有淡出）。
- 手机 393×852 与电脑桌面档都不回归；reduced-motion 下全部即时。
