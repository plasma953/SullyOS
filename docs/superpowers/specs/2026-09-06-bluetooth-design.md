# 蓝牙外设（Web Bluetooth）设计规格

日期：2026-09-06　|　分支：ethernet　|　状态：已批准

## 目标

给小手机的系统设置加一个「蓝牙」板块：配对/管理真实 BLE 外设（蓝牙家具、遥控玩具等），提供设备控制台读写 GATT 特征；AI 角色可感知已连接设备，并通过 `ble_send_command` 工具发送用户预先保存的具名指令。

## 已拍板的决策

1. **真实连接**：Web Bluetooth API（BLE/GATT）。运行环境为网页版 PWA（Chrome/Edge 桌面 + 安卓 Chrome/PWA 可用）；iOS Safari、安卓 WebView 显示不支持灰态，不做降级。不支持蓝牙音频等经典蓝牙。
2. **形态**：设置页卡片 + Modal（用户明确要求：综合性泛用设置一律进系统设置）。
3. **角色参与**：感知 + 操控。感知 = volatile 状态注入 + 实时感知宫格开关；操控 = 前台聊天内置工具循环。
4. **安全边界**：角色只能发送用户已保存的具名指令（按名字匹配），不能写原始字节，防止写坏设备。

## 架构

- `utils/bleRegistry.ts`：数据模型 + 字段清洗 + IndexedDB 持久化（`DB.saveAsset('ble_registry_v1')`，进现有 asset 备份体系）。
- `utils/bleEngine.ts`：纯函数（payload 编解码、UUID 归一化、名字模糊匹配、prompt 块拼装）+ Web Bluetooth 适配单例（配对/连接/GATT 枚举/读写/notify/事件日志），Settings 与聊天工具共享同一份连接；`useSyncExternalStore` 快照驱动 UI。
- `utils/bleToolBridge.ts`：`BT_TOOLS`（OpenAI function-calling 定义，照 `amsg2ToolBridge` 形态）+ 目标解析 + `executeBleSendCommand`（60 秒指纹防打转）。
- `components/settings/BluetoothPanel.tsx`：Modal 内容（设备列表 / 设备控制台两视图）；卡片挂载在 `apps/Settings.tsx`。

## 数据模型

```ts
interface BleSavedCommand {
  id: string; name: string;
  serviceUuid: string; characteristicUuid: string;
  format: 'hex' | 'text'; payload: string;
  writeMode: 'withResponse' | 'withoutResponse';
  note?: string;   // 给角色看的用途说明
}
interface BleSavedDevice {
  id: string;      // 浏览器 device.id（重连凭据）
  name: string;
  services: string[];        // optionalServices 白名单（GATT 访问权限的关键）
  commands: BleSavedCommand[];
  addedAt: number; lastConnectedAt?: number;
}
```

## 关键机制

- **配对**：`requestDevice({ acceptAllDevices: true, optionalServices })`；optionalServices = 预设常用服务（battery_service / device_information / current_time_service）+ 用户输入的 UUID + 通配符 `'*'` 运行时探测（同步 TypeError 即回落列表模式，结果缓存）。
- **重连**：`navigator.bluetooth.getDevices()` 能力检测恢复已授权设备，免选择器重连；不可用时引导从选择器重选（浏览器会标记原设备）。
- **GATT 访问权限**：只有配对时列进 optionalServices 的服务可访问；`SecurityError` 时 UI 提示补 UUID 重新配对。
- **写**：优先 `writeValueWithResponse/WithoutResponse`，特性检测回落 `writeValue`。
- **断连**：监听 `gattserverdisconnected` → 状态回落、清 notify、写日志；感知块随之为空。

## 角色集成

- **感知（volatile）**：`chatPrompts.ts` 在彼方块之后追加蓝牙块（照 756 行彼方样板）：只列已连接设备及其指令名 + note，附带一句工具用法说明；无已连设备时整块为空，零 token。
- **操控（工具循环）**：`useChatAI.ts` 里 `bleEngine.hasConnectedDevice()` 时注入 `BT_TOOLS`；工具循环加 `BT_TOOL_NAMES.has(fname)` 分支，结果用 `buildToolResultMessage` 回填散文文本；thinking 门（`utils/thinkingGate.ts`）把 `btToolsInjected` 与 amsg2 同等对待（仅对 Gemini 系让步）；1602 行循环总闸加 `|| btToolsInjected`。
- **宫格开关**：`perceptionRegistry.ts` 登记 `bluetooth` 能力；`RealtimeConfig` 加 `bluetoothEnabled?: boolean`（缺省视为开启）。字段名以 Settings 感知宫格 toggle 的既有键约定为准（实现时核对）。

## 边界与错误

- 选择器取消（NotFoundError / 用户取消）→ 静默。
- 参数/名字歧义 → 错误文本列出候选，让模型自行纠正。
- 发送失败 → 失败原因回填给模型；60 秒指纹窗口内同参数重复调用直接拦（防打转）。
- 事件日志环形 100 条，控制台按设备过滤显示最近 20 条。

## 测试

- vitest：payload 编解码、UUID 归一化、名字匹配、prompt 块、registry 清洗与幂等、工具目标解析、指纹拦截、BT_TOOLS 形态。
- 引擎本体是浏览器适配层，不写单测（薄层），真机手动验证：桌面 Chrome 配对真实 BLE 设备 → 枚举 → 写值 → 订阅 → 保存指令 → 一键发送 → 角色对话触发指令。
