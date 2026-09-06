# 蓝牙外设（Web Bluetooth）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在系统设置新增「蓝牙」板块——配对/管理真实 BLE 外设、控制台读写 GATT 特征；角色感知已连接设备并通过 `ble_send_command` 工具发送已保存的具名指令。

**Architecture:** 三层：`utils/bleRegistry.ts`（数据模型+清洗+持久化）→ `utils/bleEngine.ts`（纯函数+Web Bluetooth 适配单例，Settings 与聊天工具共享连接）→ `utils/bleToolBridge.ts`（function-calling 定义+执行器）；UI 为 `components/settings/BluetoothPanel.tsx`（Modal 内容），`apps/Settings.tsx` 只加卡片与挂载。

**Tech Stack:** Web Bluetooth API（Chrome/Edge，PWA 网页版），React 18 + TypeScript，Tailwind glassmorphism，IndexedDB（现有 `DB` 封装），vitest。

**Spec:** `docs/superpowers/specs/2026-09-06-bluetooth-design.md`

## Global Constraints

- 浏览器兼容基线：Chrome/Edge 桌面 + 安卓 Chrome/PWA；iOS Safari 与安卓 WebView 显示不支持灰态，不做降级。
- 新增文件全部 UTF-8 无 BOM；含中文的 oldString 只从 Read 工具输出逐字取；bash 输出里的中文只看行号定位，不复制文字。
- git commit message 用英文；绝不在工具参数里放 U+FFFD 字符本身。
- UI 遵循现有 Tailwind + glassmorphism 风格（ethernet 分支硬约定）。
- 测试命令 `pnpm test:run <filter>`；类型检查 `pnpm exec tsc --noEmit`。
- 角色只能发「已保存的具名指令」，禁止原始字节写入（安全边界）。

---

### Task 1: 注册表类型 + 引擎纯函数（TDD）

**Files:**
- Modify: `utils/bleRegistry.ts`（不存在则创建）——**只写类型定义**
- Modify: `utils/bleEngine.ts`（不存在则创建）——**只写纯函数部分**
- Create: `utils/bleEngine.test.ts`

**Interfaces:**
- Consumes: 无（首个任务）
- Produces（Task 2/3/4 依赖，签名冻结）:
  - `encodePayload(format: BlePayloadFormat, payload: string): Uint8Array`
  - `decodeValue(dv: DataView): { hex: string; text: string }`
  - `normalizeUuidInput(raw: string): string | null`
  - `matchByName<T extends { name: string }>(list: T[], query: string): T[] | 'none'`
  - `buildBlePromptBlock(devices: BleSavedDevice[], connectedIds: string[]): string`
  - 类型：`BlePayloadFormat = 'hex' | 'text'`；`BleWriteMode = 'withResponse' | 'withoutResponse'`；`BleSavedCommand`；`BleSavedDevice`

- [ ] **Step 1: Write the failing test** — 创建 `utils/bleEngine.test.ts`，内容如下（逐字使用；`import type` 会被擦除，不引入运行时循环）：

```ts
import { describe, expect, it } from 'vitest';
import {
  buildBlePromptBlock,
  decodeValue,
  encodePayload,
  matchByName,
  normalizeUuidInput,
} from './bleEngine';
import type { BleSavedDevice } from './bleRegistry';

const dvOf = (bytes: number[]) => new DataView(new Uint8Array(bytes).buffer);

describe('encodePayload', () => {
  it('hex accepts spaced pairs', () => {
    expect(Array.from(encodePayload('hex', 'AA FF 01'))).toEqual([0xaa, 0xff, 0x01]);
  });
  it('hex accepts lowercase without spaces', () => {
    expect(Array.from(encodePayload('hex', 'aaff'))).toEqual([0xaa, 0xff]);
  });
  it('hex rejects odd length', () => {
    expect(() => encodePayload('hex', 'ABC')).toThrow();
  });
  it('hex rejects non-hex chars', () => {
    expect(() => encodePayload('hex', 'ZZ')).toThrow();
  });
  it('hex rejects empty', () => {
    expect(() => encodePayload('hex', '   ')).toThrow();
  });
  it('text encodes utf8', () => {
    expect(Array.from(encodePayload('text', 'A'))).toEqual([0x41]);
    expect(encodePayload('text', '开').length).toBe(3);
  });
});

describe('decodeValue', () => {
  it('returns uppercase hex and utf8 text', () => {
    expect(decodeValue(dvOf([0xaa, 0x41]))).toEqual({ hex: 'AA 41', text: '\uFFFDA' });
  });
  it('handles empty buffer', () => {
    expect(decodeValue(dvOf([]))).toEqual({ hex: '', text: '' });
  });
});

describe('normalizeUuidInput', () => {
  it('accepts standard names', () => {
    expect(normalizeUuidInput('battery_service')).toBe('battery_service');
  });
  it('normalizes 16-bit to 0x form', () => {
    expect(normalizeUuidInput('180F')).toBe('0x180f');
    expect(normalizeUuidInput('0x180f')).toBe('0x180f');
  });
  it('accepts full 128-bit lowercase uuid', () => {
    expect(normalizeUuidInput('0000180F-0000-1000-8000-00805F9B34FB')).toBe(
      '0000180f-0000-1000-8000-00805f9b34fb',
    );
  });
  it('rejects junk and 32-bit short forms', () => {
    expect(normalizeUuidInput('hello')).toBeNull();
    expect(normalizeUuidInput('12345678')).toBeNull();
    expect(normalizeUuidInput('')).toBeNull();
  });
});

describe('matchByName', () => {
  const list = [{ name: '卧室灯' }, { name: '卧室风扇' }, { name: '玩具' }];
  it('exact match wins', () => {
    expect(matchByName(list, '玩具')).toEqual([{ name: '玩具' }]);
  });
  it('partial match returns all hits', () => {
    expect(matchByName(list, '卧室')).toEqual([{ name: '卧室灯' }, { name: '卧室风扇' }]);
  });
  it('is case/space tolerant', () => {
    expect(matchByName([{ name: 'Bed Lamp' }], 'bed lamp')).toEqual([{ name: 'Bed Lamp' }]);
  });
  it('returns none on no hit or empty query', () => {
    expect(matchByName(list, '厨房')).toBe('none');
    expect(matchByName(list, '  ')).toBe('none');
  });
});

describe('buildBlePromptBlock', () => {
  const mk = (over: Partial<BleSavedDevice>): BleSavedDevice => ({
    id: 'x', name: '灯', services: [], commands: [], addedAt: 1, ...over,
  });
  it('returns empty when nothing connected', () => {
    expect(buildBlePromptBlock([mk({ id: 'a' })], [])).toBe('');
    expect(buildBlePromptBlock([], [])).toBe('');
  });
  it('lists only connected devices with commands and notes', () => {
    const block = buildBlePromptBlock(
      [
        mk({
          id: 'a', name: '卧室灯',
          commands: [
            { id: 'c1', name: '开灯', serviceUuid: 'battery_service', characteristicUuid: '0x2a19', format: 'hex', payload: '01', writeMode: 'withResponse', note: '把灯打开' },
            { id: 'c2', name: '夜灯', serviceUuid: 'battery_service', characteristicUuid: '0x2a19', format: 'hex', payload: '02', writeMode: 'withResponse' },
          ],
        }),
        mk({ id: 'b', name: '玩具' }),
      ],
      ['a'],
    );
    expect(block).toContain('卧室灯');
    expect(block).toContain('开灯');
    expect(block).toContain('把灯打开');
    expect(block).toContain('ble_send_command');
    expect(block).not.toContain('玩具');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:run bleEngine`
Expected: FAIL（`utils/bleEngine.ts` 与 `utils/bleRegistry.ts` 不存在，import 失败）

- [ ] **Step 3: Write minimal implementation**

创建 `utils/bleRegistry.ts`，**只含类型，不含任何运行时逻辑**（运行时逻辑是 Task 2）：

```ts
export type BlePayloadFormat = 'hex' | 'text';
export type BleWriteMode = 'withResponse' | 'withoutResponse';

export interface BleSavedCommand {
  id: string;
  name: string;
  serviceUuid: string;
  characteristicUuid: string;
  format: BlePayloadFormat;
  payload: string;
  writeMode: BleWriteMode;
  note?: string;
}

export interface BleSavedDevice {
  id: string;
  name: string;
  services: string[];
  commands: BleSavedCommand[];
  addedAt: number;
  lastConnectedAt?: number;
}
```

创建 `utils/bleEngine.ts`，**只写纯函数**（引擎类是 Task 3，绝对不要在本任务写任何 `navigator.bluetooth` 代码）：

```ts
import type { BleSavedDevice } from './bleRegistry';

export type BleConnState = 'disconnected' | 'connecting' | 'connected';

const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: false });

export function encodePayload(format: 'hex' | 'text', payload: string): Uint8Array {
  const p = (payload || '').trim();
  if (format === 'text') return UTF8_ENCODER.encode(p);
  const cleaned = p.replace(/0x/gi, '').replace(/[\s,]+/g, '');
  if (!cleaned) throw new Error('payload 为空');
  if (cleaned.length % 2 !== 0) throw new Error(`hex 长度必须为偶数（收到 ${cleaned.length} 位）`);
  if (!/^[0-9a-fA-F]+$/.test(cleaned)) throw new Error('hex 只能包含 0-9 A-F');
  const bytes = new Uint8Array(cleaned.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(cleaned.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function decodeValue(dv: DataView): { hex: string; text: string } {
  const bytes = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
  return { hex, text: UTF8_DECODER.decode(bytes) };
}

const STANDARD_SERVICE_NAMES = new Set([
  'battery_service', 'device_information', 'current_time_service',
  'generic_access', 'generic_attribute', 'human_interface_device',
]);

export function normalizeUuidInput(raw: string): string | null {
  const s = (raw || '').trim().toLowerCase();
  if (!s) return null;
  if (STANDARD_SERVICE_NAMES.has(s)) return s;
  const m = s.match(/^(?:0x)?([0-9a-f]{4})$/);
  if (m) return `0x${m[1]}`;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s)) return s;
  return null;
}

const normName = (s: string) => (s || '').trim().toLowerCase();

export function matchByName<T extends { name: string }>(list: T[], query: string): T[] | 'none' {
  const q = normName(query);
  if (!q) return 'none';
  const exact = list.filter((d) => normName(d.name) === q);
  if (exact.length) return exact;
  const partial = list.filter((d) => normName(d.name).includes(q));
  return partial.length ? partial : 'none';
}

export function buildBlePromptBlock(devices: BleSavedDevice[], connectedIds: string[]): string {
  const connected = devices.filter((d) => connectedIds.includes(d.id));
  if (!connected.length) return '';
  const lines = connected.map((d) => {
    const cmds = d.commands.length
      ? d.commands.map((c) => `${c.name}${c.note ? `(${c.note})` : ''}`).join('、')
      : '（该设备还没有保存任何指令）';
    return `- 「${d.name}」可用指令：${cmds}`;
  });
  return `\n### 蓝牙外设
你的手机正通过蓝牙连着这些真实设备（用户授权配对的）：
${lines.join('\n')}
要控制某个设备时，调用 ble_send_command 工具，device 填设备名、command 填上面的指令名；只能发送这些已保存的具名指令，不要编造指令。
`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:run bleEngine`
Expected: PASS（17 tests）

- [ ] **Step 5: Commit**

```bash
git add utils/bleEngine.ts utils/bleRegistry.ts utils/bleEngine.test.ts
git commit -m "feat(ble): pure helpers for payload codec, uuid normalize, name match, prompt block"
```

---

### Task 2: 注册表持久化与清洗（TDD）

**Files:**
- Modify: `utils/bleRegistry.ts`（Task 1 已建类型；本任务只追加运行时函数）
- Create: `utils/bleRegistry.test.ts`

**Interfaces:**
- Consumes: `normalizeUuidInput`（Task 1，`utils/bleEngine.ts`）；`DB.getAsset/saveAsset`（`utils/db.ts`：`getAsset(id): Promise<string|null>`、`saveAsset(id, data: string)`，JSON 字符串自己 `stringify/parse`）
- Produces（Task 4/8 依赖，签名冻结）:
  - `BLE_REGISTRY_ASSET_KEY = 'ble_registry_v1'`
  - `normalizeSavedCommand(raw: unknown): BleSavedCommand | null`
  - `normalizeSavedDevice(raw: unknown): BleSavedDevice | null`
  - `loadBleDevices(): Promise<BleSavedDevice[]>`
  - `saveBleDevices(devices: BleSavedDevice[]): Promise<void>`
  - `upsertBleDevice(id: string, name: string, services?: string[]): Promise<BleSavedDevice[]>`
  - `touchBleDeviceConnected(id: string): Promise<void>`
  - `removeBleDevice(id: string): Promise<void>`
  - `saveCommandToDevice(deviceId: string, cmd: BleSavedCommand): Promise<void>`
  - `removeCommandFromDevice(deviceId: string, cmdId: string): Promise<void>`

- [ ] **Step 1: Write the failing test** — 创建 `utils/bleRegistry.test.ts`（用真实 DB：`test-setup.ts` 已全局挂 `fake-indexeddb/auto`，`DB.getAsset/saveAsset` 在测试里直接可用；每个测试文件是隔离环境，不会污染其它文件。**禁止** `vi.mock('./db')` 方案）：

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { DB } from './db';
import {
  BLE_REGISTRY_ASSET_KEY,
  loadBleDevices,
  normalizeSavedCommand,
  normalizeSavedDevice,
  removeCommandFromDevice,
  removeBleDevice,
  saveBleDevices,
  saveCommandToDevice,
  touchBleDeviceConnected,
  upsertBleDevice,
} from './bleRegistry';

beforeEach(async () => { await saveBleDevices([]); });

describe('normalizeSavedCommand', () => {
  it('passes through a valid command', () => {
    const cmd = {
      id: 'c1', name: '开灯', serviceUuid: 'battery_service', characteristicUuid: '0x2a19',
      format: 'hex', payload: '01', writeMode: 'withResponse', note: '把灯打开',
    };
    expect(normalizeSavedCommand(cmd)).toEqual(cmd);
  });
  it('drops junk (missing ids, bad uuids, empty payload)', () => {
    expect(normalizeSavedCommand(null)).toBeNull();
    expect(normalizeSavedCommand({ id: 'c1' })).toBeNull();
    expect(normalizeSavedCommand({ id: 'c1', name: 'x', serviceUuid: 'nope', characteristicUuid: '0x2a19', format: 'hex', payload: '01', writeMode: 'withResponse' })).toBeNull();
    expect(normalizeSavedCommand({ id: 'c1', name: 'x', serviceUuid: 'battery_service', characteristicUuid: '0x2a19', format: 'hex', payload: '  ', writeMode: 'withResponse' })).toBeNull();
  });
  it('defaults unknown format/writeMode to hex/withResponse', () => {
    const cmd = normalizeSavedCommand({ id: 'c1', name: 'x', serviceUuid: 'battery_service', characteristicUuid: '0x2a19', format: 'base64', payload: '01', writeMode: 'lazy' });
    expect(cmd?.format).toBe('hex');
    expect(cmd?.writeMode).toBe('withResponse');
  });
});

describe('normalizeSavedDevice', () => {
  it('filters invalid commands and services', () => {
    const d = normalizeSavedDevice({
      id: 'd1', name: '灯', services: ['battery_service', 'nope'], addedAt: 'junk',
      commands: [{ id: 'c1', name: '开', serviceUuid: 'battery_service', characteristicUuid: '0x2a19', format: 'hex', payload: '01', writeMode: 'withResponse' }, null],
    });
    expect(d?.services).toEqual(['battery_service']);
    expect(d?.commands).toHaveLength(1);
    expect(typeof d?.addedAt).toBe('number');
  });
  it('rejects missing id/name', () => {
    expect(normalizeSavedDevice({})).toBeNull();
    expect(normalizeSavedDevice({ id: 'd1' })).toBeNull();
  });
});

describe('persistence', () => {
  it('loadBleDevices returns [] on empty store', async () => {
    await expect(loadBleDevices()).resolves.toEqual([]);
  });
  it('upsert creates then updates name and merges services', async () => {
    await upsertBleDevice('d1', '灯', ['battery_service']);
    await upsertBleDevice('d1', '卧室灯', ['device_information']);
    const list = await loadBleDevices();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('卧室灯');
    expect(list[0].services.sort()).toEqual(['battery_service', 'device_information']);
  });
  it('saveCommandToDevice / removeCommandFromDevice roundtrip', async () => {
    await upsertBleDevice('d1', '灯');
    await saveCommandToDevice('d1', { id: 'c1', name: '开', serviceUuid: 'battery_service', characteristicUuid: '0x2a19', format: 'hex', payload: '01', writeMode: 'withResponse' });
    expect((await loadBleDevices())[0].commands).toHaveLength(1);
    await saveCommandToDevice('d1', { id: 'c1', name: '开灯', serviceUuid: 'battery_service', characteristicUuid: '0x2a19', format: 'hex', payload: '01', writeMode: 'withResponse' });
    expect((await loadBleDevices())[0].commands[0].name).toBe('开灯');
    await removeCommandFromDevice('d1', 'c1');
    expect((await loadBleDevices())[0].commands).toHaveLength(0);
  });
  it('touchBleDeviceConnected stamps lastConnectedAt; removeBleDevice deletes', async () => {
    await upsertBleDevice('d1', '灯');
    await touchBleDeviceConnected('d1');
    expect(typeof (await loadBleDevices())[0].lastConnectedAt).toBe('number');
    await removeBleDevice('d1');
    expect(await loadBleDevices()).toEqual([]);
  });
  it('writes to the ble_registry_v1 asset key', async () => {
    await upsertBleDevice('d1', '灯');
    expect(await DB.getAsset(BLE_REGISTRY_ASSET_KEY)).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:run bleRegistry`
Expected: FAIL（函数未定义）

- [ ] **Step 3: Write minimal implementation** — 在 `utils/bleRegistry.ts` 末尾追加（保留 Task 1 的类型）：

```ts
import { DB } from './db';
import { normalizeUuidInput } from './bleEngine';

export const BLE_REGISTRY_ASSET_KEY = 'ble_registry_v1';

export function normalizeSavedCommand(raw: unknown): BleSavedCommand | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' && r.id ? r.id : null;
  const name = typeof r.name === 'string' ? r.name.trim() : '';
  if (!id || !name) return null;
  const serviceUuid = normalizeUuidInput(typeof r.serviceUuid === 'string' ? r.serviceUuid : '');
  const characteristicUuid = normalizeUuidInput(
    typeof r.characteristicUuid === 'string' ? r.characteristicUuid : '',
  );
  if (!serviceUuid || !characteristicUuid) return null;
  const payload = typeof r.payload === 'string' ? r.payload.trim() : '';
  if (!payload) return null;
  const format: BlePayloadFormat = r.format === 'text' ? 'text' : 'hex';
  const writeMode: BleWriteMode = r.writeMode === 'withoutResponse' ? 'withoutResponse' : 'withResponse';
  const note = typeof r.note === 'string' && r.note.trim() ? r.note.trim() : undefined;
  return { id, name, serviceUuid, characteristicUuid, format, writeMode, payload, note };
}

export function normalizeSavedDevice(raw: unknown): BleSavedDevice | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' && r.id ? r.id : null;
  const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim() : null;
  if (!id || !name) return null;
  const services = Array.isArray(r.services)
    ? [...new Set(
        r.services
          .map((s) => normalizeUuidInput(String(s ?? '')))
          .filter((s): s is string => !!s),
      )]
    : [];
  const commands = Array.isArray(r.commands)
    ? r.commands.map(normalizeSavedCommand).filter((c): c is BleSavedCommand => !!c)
    : [];
  const addedAt = typeof r.addedAt === 'number' && Number.isFinite(r.addedAt) ? r.addedAt : Date.now();
  const lastConnectedAt =
    typeof r.lastConnectedAt === 'number' && Number.isFinite(r.lastConnectedAt)
      ? r.lastConnectedAt
      : undefined;
  return { id, name, services, commands, addedAt, lastConnectedAt };
}

export async function loadBleDevices(): Promise<BleSavedDevice[]> {
  try {
    const raw = await DB.getAsset(BLE_REGISTRY_ASSET_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeSavedDevice).filter((d): d is BleSavedDevice => !!d);
  } catch (e) {
    console.warn('[ble] 蓝牙注册表读取失败，按空表处理', e);
    return [];
  }
}

export async function saveBleDevices(devices: BleSavedDevice[]): Promise<void> {
  await DB.saveAsset(BLE_REGISTRY_ASSET_KEY, JSON.stringify(devices));
}

export async function upsertBleDevice(
  id: string, name: string, services: string[] = [],
): Promise<BleSavedDevice[]> {
  const list = await loadBleDevices();
  const prev = list.find((d) => d.id === id);
  const merged = [...new Set([...(prev?.services || []), ...services])];
  const next: BleSavedDevice = {
    id,
    name: name || prev?.name || id,
    services: merged,
    commands: prev?.commands || [],
    addedAt: prev?.addedAt ?? Date.now(),
    lastConnectedAt: prev?.lastConnectedAt,
  };
  const out = [...list.filter((d) => d.id !== id), next];
  await saveBleDevices(out);
  return out;
}

export async function touchBleDeviceConnected(id: string): Promise<void> {
  const list = await loadBleDevices();
  const d = list.find((x) => x.id === id);
  if (!d) return;
  d.lastConnectedAt = Date.now();
  await saveBleDevices(list);
}

export async function removeBleDevice(id: string): Promise<void> {
  await saveBleDevices((await loadBleDevices()).filter((d) => d.id !== id));
}

export async function saveCommandToDevice(deviceId: string, cmd: BleSavedCommand): Promise<void> {
  const list = await loadBleDevices();
  const d = list.find((x) => x.id === deviceId);
  if (!d) return;
  const clean = normalizeSavedCommand(cmd);
  if (!clean) return;
  d.commands = [...d.commands.filter((c) => c.id !== clean.id), clean];
  await saveBleDevices(list);
}

export async function removeCommandFromDevice(deviceId: string, cmdId: string): Promise<void> {
  const list = await loadBleDevices();
  const d = list.find((x) => x.id === deviceId);
  if (!d) return;
  d.commands = d.commands.filter((c) => c.id !== cmdId);
  await saveBleDevices(list);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:run bleRegistry`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add utils/bleRegistry.ts utils/bleRegistry.test.ts
git commit -m "feat(ble): device/command registry with normalize and asset persistence"
```

---

### Task 3: 引擎单例（浏览器适配层，无单测）

**Files:**
- Modify: `utils/bleEngine.ts`（在 Task 1 纯函数之后追加引擎类；不改动纯函数）

**Interfaces:**
- Consumes: Task 1 的纯函数与类型
- Produces（Task 4/5/8 依赖，签名冻结）:
  - `BleLogEntry { ts: number; deviceId: string | null; dir: 'tx' | 'rx' | 'sys'; text: string }`
  - `BleEngineSnapshot { version: number; states: Record<string, BleConnState>; logs: BleLogEntry[] }`
  - `BleGattCharInfo { uuid: string; props: string[] }`
  - `BleGattServiceInfo { uuid: string; characteristics: BleGattCharInfo[] }`
  - `bleEngine.isSupported(): boolean`
  - `bleEngine.hasConnectedDevice(): boolean`
  - `bleEngine.connectedDeviceIds(): string[]`
  - `bleEngine.getSnapshot(): BleEngineSnapshot`
  - `bleEngine.subscribe(l: () => void): () => void`
  - `bleEngine.log(dir, deviceId, text): void`
  - `bleEngine.requestPair(extraServices?: string[]): Promise<{ id: string; name: string } | null>`（用户取消返回 `null`；不支持时抛错）
  - `bleEngine.restoreKnown(): Promise<string[]>`（已授权设备的 id；不支持/被拒返回 `[]`）
  - `bleEngine.connect(deviceId: string): Promise<void>`
  - `bleEngine.disconnect(deviceId: string): void`
  - `bleEngine.listGatt(deviceId: string): Promise<BleGattServiceInfo[]>`
  - `bleEngine.readValue(deviceId, serviceUuid, charUuid): Promise<{ hex: string; text: string }>`
  - `bleEngine.writeValue(deviceId, serviceUuid, charUuid, format, payload, mode): Promise<void>`
  - `bleEngine.startNotify(deviceId, serviceUuid, charUuid, onValue): Promise<() => void>`（返回退订函数）

- [ ] **Step 1: Implement** — 在文件末尾追加以下引擎代码（逐字实现；**顶层不许出现任何 `navigator`/`window` 引用**，全部放进方法里，否则 vitest/node 导入即炸。Web Bluetooth 的 TS 类型定义不全，`BluetoothDevice` 等一律用 `any` + 运行时鸭子类型）：

```ts
export interface BleLogEntry {
  ts: number;
  deviceId: string | null;
  dir: 'tx' | 'rx' | 'sys';
  text: string;
}

export interface BleEngineSnapshot {
  version: number;
  states: Record<string, BleConnState>;
  logs: BleLogEntry[];
}

export interface BleGattCharInfo {
  uuid: string;
  props: string[];
}

export interface BleGattServiceInfo {
  uuid: string;
  characteristics: BleGattCharInfo[];
}

const PAIR_PRESET_SERVICES = ['battery_service', 'device_information', 'current_time_service'];
const BLE_LOG_LIMIT = 100;

type BluetoothLike = any;

class BleEngine {
  private devices = new Map<string, any>();
  private states = new Map<string, BleConnState>();
  private notifyCleanups = new Map<string, Array<() => void>>();
  private logs: BleLogEntry[] = [];
  private version = 0;
  private listeners = new Set<() => void>();
  private wildcardOk: boolean | null = null;

  isSupported(): boolean {
    return (
      typeof navigator !== 'undefined' &&
      !!(navigator as any).bluetooth &&
      typeof window !== 'undefined' &&
      window.isSecureContext
    );
  }

  hasConnectedDevice(): boolean {
    for (const s of this.states.values()) if (s === 'connected') return true;
    return false;
  }

  connectedDeviceIds(): string[] {
    return [...this.states.entries()].filter(([, s]) => s === 'connected').map(([id]) => id);
  }

  getSnapshot(): BleEngineSnapshot {
    return { version: this.version, states: Object.fromEntries(this.states), logs: [...this.logs] };
  }

  subscribe(l: () => void): () => void {
    this.listeners.add(l);
    return () => { this.listeners.delete(l); };
  }

  private emit(): void {
    this.version += 1;
    this.listeners.forEach((l) => { try { l(); } catch { /* ignore */ } });
  }

  log(dir: BleLogEntry['dir'], deviceId: string | null, text: string): void {
    this.logs.push({ ts: Date.now(), deviceId, dir, text });
    if (this.logs.length > BLE_LOG_LIMIT) this.logs.splice(0, this.logs.length - BLE_LOG_LIMIT);
    this.emit();
  }

  private setState(id: string, s: BleConnState): void {
    if (this.states.get(id) !== s) {
      this.states.set(id, s);
      this.emit();
    }
  }

  private requireDevice(deviceId: string): any {
    const d = this.devices.get(deviceId);
    if (!d) throw new Error('此设备需要重新配对：请在列表里重新添加一次（浏览器授权变更）');
    return d;
  }

  async requestPair(extraServices: string[] = []): Promise<{ id: string; name: string } | null> {
    if (!this.isSupported()) {
      throw new Error('当前浏览器不支持 Web Bluetooth（需要 Chrome/Edge 且 HTTPS 环境）');
    }
    const optionalServices = [...new Set([...PAIR_PRESET_SERVICES, ...extraServices])];
    const bt: BluetoothLike = (navigator as any).bluetooth;
    const plain = () => bt.requestDevice({ acceptAllDevices: true, optionalServices });
    let device: any;
    try {
      device =
        this.wildcardOk === false
          ? await plain()
          : await bt.requestDevice({ acceptAllDevices: true, optionalServices: ['*', ...optionalServices] });
      this.wildcardOk = true;
    } catch (e: any) {
      if (this.wildcardOk === null && (e?.name === 'TypeError' || /optionalServices/i.test(e?.message || ''))) {
        this.wildcardOk = false;
        try {
          device = await plain();
        } catch (e2: any) {
          if (e2?.name === 'NotFoundError' || /cancel/i.test(e2?.message || '')) return null;
          throw e2;
        }
      } else if (e?.name === 'NotFoundError' || /cancel/i.test(e?.message || '')) {
        return null;
      } else {
        throw e;
      }
    }
    this.devices.set(device.id, device);
    this.setState(device.id, 'disconnected');
    this.log('sys', device.id, `已配对「${device.name || device.id}」`);
    return { id: device.id, name: device.name || device.id };
  }

  async restoreKnown(): Promise<string[]> {
    if (!this.isSupported()) return [];
    try {
      const bt: BluetoothLike = (navigator as any).bluetooth;
      if (typeof bt.getDevices !== 'function') return [];
      const known: any[] = await bt.getDevices();
      for (const d of known) this.devices.set(d.id, d);
      return known.map((d) => d.id);
    } catch {
      return [];
    }
  }

  async connect(deviceId: string): Promise<void> {
    const device = this.requireDevice(deviceId);
    if (device.gatt?.connected) {
      this.setState(deviceId, 'connected');
      return;
    }
    this.setState(deviceId, 'connecting');
    try {
      await device.gatt.connect();
      device.addEventListener('gattserverdisconnected', () => {
        this.teardownNotify(deviceId);
        this.setState(deviceId, 'disconnected');
        this.log('sys', deviceId, '设备断开连接');
      });
      this.setState(deviceId, 'connected');
      this.log('sys', deviceId, '已连接');
    } catch (e) {
      this.setState(deviceId, 'disconnected');
      throw e;
    }
  }

  disconnect(deviceId: string): void {
    this.teardownNotify(deviceId);
    try {
      this.requireDevice(deviceId)?.gatt?.disconnect();
    } catch { /* ignore */ }
    this.setState(deviceId, 'disconnected');
    this.log('sys', deviceId, '已手动断开');
  }

  async listGatt(deviceId: string): Promise<BleGattServiceInfo[]> {
    const device = this.requireDevice(deviceId);
    const services: any[] = await device.gatt.getPrimaryServices();
    const out: BleGattServiceInfo[] = [];
    for (const svc of services) {
      const chars: any[] = await svc.getCharacteristics();
      out.push({
        uuid: svc.uuid,
        characteristics: chars.map((c) => ({
          uuid: c.uuid,
          props: Object.keys(c.properties || {}).filter((k) => (c.properties as any)[k]),
        })),
      });
    }
    return out;
  }

  private async getChar(deviceId: string, serviceUuid: string, charUuid: string): Promise<any> {
    const device = this.requireDevice(deviceId);
    if (this.states.get(deviceId) !== 'connected') throw new Error('设备未连接');
    const svc = await device.gatt.getPrimaryService(serviceUuid);
    return svc.getCharacteristic(charUuid);
  }

  async readValue(
    deviceId: string, serviceUuid: string, charUuid: string,
  ): Promise<{ hex: string; text: string }> {
    const c = await this.getChar(deviceId, serviceUuid, charUuid);
    const v = decodeValue(await c.readValue());
    this.log('rx', deviceId, `读 ${charUuid}: ${v.hex}`);
    return v;
  }

  async writeValue(
    deviceId: string, serviceUuid: string, charUuid: string,
    format: 'hex' | 'text', payload: string, mode: 'withResponse' | 'withoutResponse',
  ): Promise<void> {
    const c = await this.getChar(deviceId, serviceUuid, charUuid);
    const bytes = encodePayload(format, payload);
    if (typeof c.writeValueWithResponse === 'function' || typeof c.writeValueWithoutResponse === 'function') {
      if (mode === 'withoutResponse' && typeof c.writeValueWithoutResponse === 'function') {
        await c.writeValueWithoutResponse(bytes);
      } else {
        await c.writeValueWithResponse(bytes);
      }
    } else {
      await c.writeValue(bytes);
    }
    this.log('tx', deviceId, `写 ${charUuid} (${mode}): ${format === 'hex' ? payload : `文本「${payload}」`}`);
  }

  async startNotify(
    deviceId: string, serviceUuid: string, charUuid: string,
    onValue: (v: { hex: string; text: string }) => void,
  ): Promise<() => void> {
    const c = await this.getChar(deviceId, serviceUuid, charUuid);
    try { await c.stopNotifications?.(); } catch { /* ignore 幂等 */ }
    await c.startNotifications();
    const handler = (e: any) => {
      const raw = e?.target?.value;
      if (!raw) return;
      const v = decodeValue(raw);
      this.log('rx', deviceId, `notify ${charUuid}: ${v.hex}${v.text ? ` /「${v.text}」` : ''}`);
      onValue(v);
    };
    c.addEventListener('characteristicvaluechanged', handler);
    const cleanup = () => {
      try {
        c.removeEventListener('characteristicvaluechanged', handler);
        c.stopNotifications?.().catch(() => {});
      } catch { /* ignore */ }
    };
    const key = `${deviceId}|${serviceUuid}|${charUuid}`;
    const arr = this.notifyCleanups.get(key) || [];
    arr.push(cleanup);
    this.notifyCleanups.set(key, arr);
    return () => {
      cleanup();
      const rest = (this.notifyCleanups.get(key) || []).filter((f) => f !== cleanup);
      if (rest.length) this.notifyCleanups.set(key, rest);
      else this.notifyCleanups.delete(key);
    };
  }

  private teardownNotify(deviceId: string): void {
    for (const [k, arr] of [...this.notifyCleanups]) {
      if (k.startsWith(`${deviceId}|`)) {
        arr.forEach((f) => { try { f(); } catch { /* ignore */ } });
        this.notifyCleanups.delete(k);
      }
    }
  }
}

export const bleEngine = new BleEngine();
```

- [ ] **Step 2: Verify typecheck（本任务不写单测，薄层走真机验证，见 Task 8）**

Run: `pnpm exec tsc --noEmit`
Expected: 无 `utils/bleEngine.ts` 相关的新报错。仓库基线（imageGen 半成品）可能有其它报错，只确认本文件干净。

- [ ] **Step 3: Commit**

```bash
git add utils/bleEngine.ts
git commit -m "feat(ble): Web Bluetooth engine singleton (pair/connect/GATT/notify)"
```

---

### Task 4: 工具桥（TDD）

**Files:**
- Create: `utils/bleToolBridge.ts`
- Create: `utils/bleToolBridge.test.ts`

**Interfaces:**
- Consumes: Task 1（`matchByName`）、Task 2（`loadBleDevices` + 类型）、Task 3（`bleEngine`）
- Produces（Task 5/6 依赖，签名冻结）:
  - `BLE_SEND_TOOL_NAME = 'ble_send_command'`
  - `BT_TOOLS`（`{ type: 'function', function: { name, description, parameters } }[]`，形态照 `utils/amsg2ToolBridge.ts:42-130`）
  - `BT_TOOL_NAMES: Set<string>`
  - `resolveBleSendTarget(devices, connectedIds, deviceQuery, commandQuery): { ok: true; device; command } | { ok: false; errorText: string }`
  - `executeBleSendCommand(args: { device?: string; command?: string }): Promise<string>`（散文结果文本；60 秒指纹防打转）
  - `buildBleDevicesLiveBlock(): Promise<string>`

- [ ] **Step 1: Write the failing test** — 创建 `utils/bleToolBridge.test.ts`：

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./bleEngine', () => ({
  bleEngine: {
    connectedDeviceIds: vi.fn(() => ['d1']),
    writeValue: vi.fn(async () => {}),
  },
  matchByName: (list: Array<{ name: string }>, q: string) => {
    const norm = (s: string) => (s || '').trim().toLowerCase();
    const query = norm(q);
    if (!query) return 'none';
    const exact = list.filter((d) => norm(d.name) === query);
    if (exact.length) return exact;
    const partial = list.filter((d) => norm(d.name).includes(query));
    return partial.length ? partial : 'none';
  },
}));

const FIXTURE = [
  {
    id: 'd1', name: '卧室灯', services: ['battery_service'], addedAt: 1,
    commands: [
      { id: 'c1', name: '开灯', serviceUuid: 'battery_service', characteristicUuid: '0x2a19', format: 'hex', payload: '01', writeMode: 'withResponse', note: '把灯打开' },
      { id: 'c2', name: '夜灯', serviceUuid: 'battery_service', characteristicUuid: '0x2a19', format: 'hex', payload: '02', writeMode: 'withResponse' },
    ],
  },
  { id: 'd2', name: '玩具', services: [], addedAt: 2, commands: [] },
];

vi.mock('./bleRegistry', () => ({
  loadBleDevices: vi.fn(async () => FIXTURE),
}));

import { bleEngine } from './bleEngine';
import {
  BLE_SEND_TOOL_NAME,
  BT_TOOL_NAMES,
  BT_TOOLS,
  executeBleSendCommand,
  resolveBleSendTarget,
} from './bleToolBridge';

beforeEach(() => { vi.clearAllMocks(); });

describe('BT_TOOLS shape', () => {
  it('exposes one function tool named ble_send_command in AMSG2 shape', () => {
    expect(BLE_SEND_TOOL_NAME).toBe('ble_send_command');
    expect(BT_TOOLS).toHaveLength(1);
    expect(BT_TOOLS[0].type).toBe('function');
    expect(BT_TOOLS[0].function.name).toBe('ble_send_command');
    expect(BT_TOOLS[0].function.parameters.required).toEqual(
      expect.arrayContaining(['device', 'command']),
    );
    expect(BT_TOOL_NAMES.has('ble_send_command')).toBe(true);
  });
});

describe('resolveBleSendTarget', () => {
  it('resolves fuzzy names on connected devices', () => {
    const r = resolveBleSendTarget(FIXTURE as any, ['d1'], '卧室', '夜灯');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.device.name).toBe('卧室灯');
      expect(r.command.name).toBe('夜灯');
    }
  });
  it('rejects disconnected devices', () => {
    const r = resolveBleSendTarget(FIXTURE as any, [], '灯', '开灯');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errorText).toMatch(/没有已连接/);
  });
  it('reports unknown device with candidates', () => {
    const r = resolveBleSendTarget(FIXTURE as any, ['d1'], '厨房', '开灯');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errorText).toContain('卧室灯');
  });
  it('reports ambiguous match with candidates', () => {
    const two = [
      { ...FIXTURE[0], name: '灯A' },
      { ...FIXTURE[0], id: 'd9', name: '灯B' },
    ];
    const r = resolveBleSendTarget(two as any, ['d1', 'd9'], '灯', '开灯');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errorText).toContain('灯A');
      expect(r.errorText).toContain('灯B');
    }
  });
  it('reports missing command with available list', () => {
    const r = resolveBleSendTarget(FIXTURE as any, ['d1'], '卧室灯', '关灯');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errorText).toContain('开灯');
      expect(r.errorText).toContain('夜灯');
    }
  });
});

describe('executeBleSendCommand', () => {
  it('sends and returns prose result', async () => {
    const text = await executeBleSendCommand({ device: '卧室灯', command: '开灯' });
    expect(text).toContain('卧室灯');
    expect(text).toContain('开灯');
    expect(bleEngine.writeValue).toHaveBeenCalledTimes(1);
    expect(bleEngine.writeValue).toHaveBeenCalledWith(
      'd1', 'battery_service', '0x2a19', 'hex', '01', 'withResponse',
    );
  });
  it('blocks identical repeat within the window', async () => {
    await executeBleSendCommand({ device: '卧室灯', command: '夜灯' });
    const text = await executeBleSendCommand({ device: '卧室灯', command: '夜灯' });
    expect(text).toMatch(/已经发送过|重复/);
    expect(bleEngine.writeValue).toHaveBeenCalledTimes(1);
  });
  it('rejects incomplete args', async () => {
    const text = await executeBleSendCommand({ device: '卧室灯' });
    expect(text).toMatch(/不完整|需要/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:run bleToolBridge`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation** — 创建 `utils/bleToolBridge.ts`：

```ts
import { bleEngine, matchByName } from './bleEngine';
import { loadBleDevices } from './bleRegistry';
import type { BleSavedCommand, BleSavedDevice } from './bleRegistry';

export const BLE_SEND_TOOL_NAME = 'ble_send_command';

export const BT_TOOLS = [
  {
    type: 'function',
    function: {
      name: BLE_SEND_TOOL_NAME,
      description: [
        '控制你手机通过蓝牙连接的真实外设（灯、风扇、玩具等）。',
        '只能发送用户在蓝牙设置里预先保存好的具名指令（如"开灯"），不能发原始数据；',
        'device 用设备名、command 用指令名，都可以只写一部分，系统会自动匹配；',
        '没列出在蓝牙外设状态里的设备/指令不能调用。',
      ].join('\n'),
      parameters: {
        type: 'object',
        properties: {
          device: { type: 'string', description: '目标设备名，如「卧室灯」；可写部分名字。' },
          command: { type: 'string', description: '要发送的指令名，如「开灯」；可写部分名字。' },
        },
        required: ['device', 'command'],
      },
    },
  },
] as const;

export const BT_TOOL_NAMES = new Set<string>([BLE_SEND_TOOL_NAME]);

export type BleSendResult =
  | { ok: true; device: BleSavedDevice; command: BleSavedCommand }
  | { ok: false; errorText: string };

export function resolveBleSendTarget(
  devices: BleSavedDevice[],
  connectedIds: string[],
  deviceQuery: string,
  commandQuery: string,
): BleSendResult {
  const connected = devices.filter((d) => connectedIds.includes(d.id));
  if (!connected.length) {
    return { ok: false, errorText: '当前没有已连接的蓝牙设备，无法发送指令。' };
  }
  const dm = matchByName(connected, deviceQuery);
  if (dm === 'none') {
    return {
      ok: false,
      errorText: `找不到已连接设备「${deviceQuery}」。当前已连接：${connected.map((d) => d.name).join('、')}`,
    };
  }
  if (dm.length > 1) {
    return {
      ok: false,
      errorText: `「${deviceQuery}」匹配到多个已连接设备：${dm.map((d) => d.name).join('、')}。请用更完整的名字重试。`,
    };
  }
  const device = dm[0];
  if (!device.commands.length) {
    return { ok: false, errorText: `设备「${device.name}」还没有保存任何指令。` };
  }
  const cm = matchByName(device.commands, commandQuery);
  if (cm === 'none') {
    return {
      ok: false,
      errorText: `设备「${device.name}」没有指令「${commandQuery}」。可用指令：${device.commands.map((c) => c.name).join('、')}`,
    };
  }
  if (cm.length > 1) {
    return {
      ok: false,
      errorText: `「${commandQuery}」在「${device.name}」上匹配到多条指令：${cm.map((c) => c.name).join('、')}。请用更完整的名字重试。`,
    };
  }
  return { ok: true, device, command: cm[0] };
}

const FINGERPRINT_WINDOW_MS = 60_000;
let lastSent: { key: string; ts: number } | null = null;

export async function executeBleSendCommand(args: {
  device?: string;
  command?: string;
}): Promise<string> {
  const dq = (args?.device || '').trim();
  const cq = (args?.command || '').trim();
  if (!dq || !cq) return '参数不完整：需要 device（设备名）和 command（指令名）。';
  const key = `${dq}|${cq}`;
  const now = Date.now();
  if (lastSent && lastSent.key === key && now - lastSent.ts < FINGERPRINT_WINDOW_MS) {
    return `指令「${cq}」刚刚已经发送过了（60 秒内不重复执行）。如果设备没有反应，请告知用户检查设备，而不是重复发送。`;
  }
  const devices = await loadBleDevices();
  const target = resolveBleSendTarget(devices, bleEngine.connectedDeviceIds(), dq, cq);
  if (!target.ok) {
    lastSent = { key, ts: now };
    return target.errorText;
  }
  const { device, command } = target;
  try {
    await bleEngine.writeValue(
      device.id, command.serviceUuid, command.characteristicUuid,
      command.format, command.payload, command.writeMode,
    );
    lastSent = { key, ts: now };
    return `已向蓝牙设备「${device.name}」发送指令「${command.name}」。`;
  } catch (e: any) {
    return `向「${device.name}」发送指令「${command.name}」失败：${e?.message || String(e)}。`;
  }
}

export async function buildBleDevicesLiveBlock(): Promise<string> {
  const { buildBlePromptBlock } = await import('./bleEngine');
  return buildBlePromptBlock(await loadBleDevices(), bleEngine.connectedDeviceIds());
}
```

**注意**：`buildBleDevicesLiveBlock` 用动态 `import('./bleEngine')` 而不是顶层 import——这是为了让 Task 6 的调用方（chatPrompts）在极端懒加载场景下不会把引擎类提前拉进首屏包。如果构建工具对动态 import 报 lint，改成顶层 import 也可以（功能等价），但必须在报告里说明。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:run bleToolBridge`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add utils/bleToolBridge.ts utils/bleToolBridge.test.ts
git commit -m "feat(ble): send_command tool bridge with resolve and anti-loop fingerprint"
```

---

### Task 5: `hooks/useChatAI.ts` 接线

**Files:**
- Modify: `hooks/useChatAI.ts`
- Modify: `utils/thinkingGate.ts`

**Interfaces:**
- Consumes: Task 4（`BT_TOOLS`、`BT_TOOL_NAMES`、`executeBleSendCommand`）、Task 3（`bleEngine.hasConnectedDevice`）
- Produces: 前台聊天在有已连接设备时注入 `ble_send_command` 并可执行

以下行号是 `ethernet@ca9817c0` 基线实测值，动手前先用 grep 复核（中间任务可能漂移几行），以代码内容为准定位。

- [ ] **Step 1: Add imports** — 在 `hooks/useChatAI.ts` 第 53 行 AMSG2 import 旁边加两行：

```ts
import { bleEngine } from '../utils/bleEngine';
import { BT_TOOL_NAMES, BT_TOOLS, executeBleSendCommand } from '../utils/bleToolBridge';
```

- [ ] **Step 2: Compute injection flag early + thinking gate**

在 thinking 门附近（基线 974 行 `const amsg2ToolsInjected = ...`）之后加一行：

```ts
const btToolsInjected = bleEngine.hasConnectedDevice();
```

在 `utils/thinkingGate.ts` 的 `shouldSendThinkingParams` input 类型里加 `btToolsInjected: boolean` 字段，并在函数体内加一行：

```ts
if (input.btToolsInjected && modelRejectsThinkingWithTools(input.model)) return false;
```

同时更新该文件顶部的注释块：把「主动消息 2.0：配了 worker 就常驻…」那段改成「主动消息 2.0 / 蓝牙工具：常驻型工具…」，如实反映两类。

在 `useChatAI.ts` 的 `shouldSendThinkingParams({...})` 调用处（基线 975-980 行）补 `btToolsInjected,` 参数。

- [ ] **Step 3: Inject tools** — 在 AMSG2 注入块（基线 1050-1064 行，`if (amsg2ToolsInjected) { baseReqBody.tools = ...`）之后追加：

```ts
// 蓝牙工具：真有已连接的 BLE 设备时才注入，零成本保持沉默。
if (btToolsInjected) {
    baseReqBody.tools = [...(baseReqBody.tools || []), ...BT_TOOLS];
    if (!baseReqBody.tool_choice) baseReqBody.tool_choice = 'auto';
}
```

**禁止**覆盖 `baseReqBody.tools`（必须追加，与 MCP/瑞幸/麦当劳共存）。

- [ ] **Step 4: Loop gate + execution branch**

循环总闸（基线 1602 行）条件追加 `|| btToolsInjected`：

```ts
if ((payload.flags.luckinChatActive || mcpToolResolve || amsg2ToolsInjected || btToolsInjected) && data.choices?.[0]?.message?.tool_calls?.length) {
```

AMSG2 分支（基线 1754-1758 行）之后追加蓝牙分支（直接毗邻）：

```ts
// 蓝牙外设工具
if (BT_TOOL_NAMES.has(fname)) {
    const btText = await executeBleSendCommand(args as { device?: string; command?: string });
    loopMessages.push(buildToolResultMessage(tc, btText) as any);
    continue;
}
```

参数解析复用循环已有的 `args` 变量（基线 1630-1636 行已有安全 JSON.parse，不用自己再 parse）。

- [ ] **Step 5: Verify**

Run: `pnpm exec tsc --noEmit`（确认无本任务相关报错）+ `pnpm test:run` 全量（本任务不应破坏任何已有测试）

- [ ] **Step 6: Commit**

```bash
git add hooks/useChatAI.ts utils/thinkingGate.ts
git commit -m "feat(ble): wire ble_send_command into foreground chat tool loop"
```

---

### Task 6: `utils/chatPrompts.ts` volatile 蓝牙块

**Files:**
- Modify: `utils/chatPrompts.ts`

**Interfaces:**
- Consumes: Task 4 的 `buildBleDevicesLiveBlock`
- Produces: 有已连设备时 volatileState 末尾出现蓝牙块；零设备时零注入

- [ ] **Step 1: Import** — 在 `utils/chatPrompts.ts` 顶部 import 区加：

```ts
import { buildBleDevicesLiveBlock } from './bleToolBridge';
```

先 grep 确认该文件没有同名符号冲突。

- [ ] **Step 2: Append volatile block** — 在彼方在场块结束处之后（基线 760 行 `}` 闭合之后、`const emojiContextStr` 之前）追加：

```ts
// 蓝牙外设：真有已连接的 BLE 设备时才注入（易变状态）。零设备时整块为空，零 token 开销。
try {
    const bleBlock = await buildBleDevicesLiveBlock();
    if (bleBlock) volatileState += bleBlock;
} catch (e) {
    console.warn('[ble] 蓝牙状态块注入失败（忽略）', e);
}
```

确认该位置处于 async 函数体内（彼方块里已有 `await resolveManagedPrompt`，必然是 async 上下文；若不是，找 volatileState 组装所在的最近 async 函数）。

- [ ] **Step 3: Verify**

Run: `pnpm exec tsc --noEmit` + `pnpm test:run chatPrompts`
Expected: 无本任务相关报错，现有 chatPrompts 测试全过

- [ ] **Step 4: Commit**

```bash
git add utils/chatPrompts.ts
git commit -m "feat(ble): inject connected BLE devices into volatile prompt state"
```

---

### Task 7: 感知登记 + 配置开关

**Files:**
- Modify: `types.ts`（RealtimeConfig，基线 627-666 行）
- Modify: `utils/perceptionRegistry.ts`

**Interfaces:**
- Consumes: Task 3（`bleEngine.hasConnectedDevice`）
- Produces: 设置页实时感知宫格出现「蓝牙设备」项，随 `bluetoothEnabled` 开关显示 on/off/pending

- [ ] **Step 1: RealtimeConfig field** — 先在 `apps/Settings.tsx` 里 grep `PERCEPTION_CAPABILITIES` 的宫格渲染代码，确认 toggle 写入的键名约定（是不是 `` `${cap.id}Enabled` ``）。**字段名必须与宫格 toggle 的写入键一致**：
  - 如果约定是 `${cap.id}Enabled` 且登记 id 为 `bluetooth`，字段就是 `bluetoothEnabled?: boolean`；
  - 在 `types.ts` 的 `RealtimeConfig`（透视窗字段之后）加该字段，注释写明「缺省视为开启；只有真有已连接设备时才实际注入 prompt」。
  - 若 `Settings.tsx` 里 realtimeConfig 有归一化/默认值函数（基线 1714-1757 行附近是保存样板），同步补字段默认值。

- [ ] **Step 2: Registry entry** — 在 `utils/perceptionRegistry.ts` 的 `PERCEPTION_CAPABILITIES` 数组末尾（透视窗条目之后）追加：

```ts
{
    id: 'bluetooth',
    label: '蓝牙设备',
    description: '手机蓝牙连接的外设与可用指令（Web Bluetooth）',
    tint: 'bg-sky-50 text-sky-600',
    tintIdle: 'bg-slate-50 text-slate-400',
    enabled: (rc) => rc.bluetoothEnabled !== false,
    configured: () => bleEngine.hasConnectedDevice(),
},
```

并在文件顶部加 `import { bleEngine } from './bleEngine';`。**注意**：`enabled` 里的字段名必须与 Step 1 的实际字段名一致；`tintIdle` 必须灰态（仓库规则：不得给停用项留彩色底）。

- [ ] **Step 3: Verify**

Run: `pnpm exec tsc --noEmit` + `pnpm test:run perception`（若有相关测试）
Expected: 无本任务相关报错

- [ ] **Step 4: Commit**

```bash
git add types.ts utils/perceptionRegistry.ts apps/Settings.tsx
git commit -m "feat(ble): register bluetooth perception capability with toggle"
```

（`apps/Settings.tsx` 只有在归一化函数里动了才需要 add；没动就只 add 前两个文件，commit message 不变。）

---

### Task 8: 蓝牙管理界面（设置卡片 + Modal）

**Files:**
- Create: `components/settings/BluetoothPanel.tsx`
- Modify: `apps/Settings.tsx`（只加卡片 + Modal 挂载，不碰其它卡片）

**Interfaces:**
- Consumes: Task 2（registry 全套）、Task 3（引擎全套）
- Produces: 用户可在设置里配对/连接/控制台操作/保存指令

**UI 规范**：照仓库惯例——Tailwind 工具类 + glassmorphism；Modal 用 `components/os/Modal`（参考 `apps/Settings.tsx:8` 的 import 与其它 Modal 用法：`<Modal isOpen title onClose footer>`）；删除操作必须二次确认（参考其它删除确认做法）；报错一律 `useOS()` 的 `addToast`/`showError`（参考 Settings 现有用法），不要 `alert`。

- [ ] **Step 1: Settings card + modal mount** — 在 `apps/Settings.tsx` 里：
  1. 先读 MCP 卡片（基线 3322 行 `title="MCP 工具服务器"` 附近）的 Card 写法，照抄结构新增一张 `title="蓝牙"` 的卡片，位置放在 MCP 卡片之后、推送订阅卡片之前。卡片内容三行以内：状态行（`bleEngine.isSupported()` 为 false 显示「当前浏览器不支持 Web Bluetooth（需要 Chrome/Edge）」；否则显示「已保存 N 台 · 已连接 M 台」，数字从 registry + 引擎快照取）、说明行（一句：配对 BLE 外设，保存指令后角色也能控制）、右侧「管理」按钮（`setShowBleModal(true)`）。
  2. 文件顶部加 `import BluetoothPanel from '../components/settings/BluetoothPanel';`（路径按实际目录层级核对：`apps/Settings.tsx` → `components/settings/BluetoothPanel.tsx` 是 `../components/settings/BluetoothPanel`）。
  3. `const [showBleModal, setShowBleModal] = useState(false);`（放在其它 `showXxxModal` state 旁边）。
  4. 在其它 Modal 旁边追加：`<Modal isOpen={showBleModal} title="蓝牙" onClose={() => setShowBleModal(false)}><BluetoothPanel /></Modal>`。

- [ ] **Step 2: BluetoothPanel list view** — `components/settings/BluetoothPanel.tsx` 实现设备列表视图：
  - 用 `useSyncExternalStore(bleEngine.subscribe.bind(bleEngine), bleEngine.getSnapshot.bind(bleEngine))` 订阅引擎快照（注意 bind，否则 this 丢失）。
  - `loadBleDevices()` 读注册表（useState + useEffect；每次 Modal 打开时重读一次，打开状态由父组件控制，面板 mount 即视为打开）。
  - mount 时静默尝试 `bleEngine.restoreKnown()`（try/catch 包住，失败不打扰用户）。
  - 行：名称 / 连接态圆点（connected=绿、connecting=黄闪、disconnected=灰）/ 指令数 / 上次连接时间；操作按钮：连接（`bleEngine.connect(id)` 成功后 `touchBleDeviceConnected(id)`；catch 到「需要重新配对」错误时 toast 提示重新添加）、断开（`bleEngine.disconnect(id)`）、详情（切视图）、删除（二次确认 → `removeBleDevice(id)` + 本地 state 剔除）。
  - 「添加设备」区：一个文本框「服务 UUID（逗号分隔，可选，高级）」+ 按钮。点击：用 `normalizeUuidInput` 逐个清洗输入（非法条目 toast 报错并中止）；`bleEngine.requestPair(services)` → 返回 `null` 表示用户取消（静默）；成功则 `upsertBleDevice(id, name, [...PAIR 预设, services])`——注意：requestPair 内部已经带了预设服务，upsert 时把用户输入的 services 也存进去即可，**不要重复存预设**（用 `upsertBleDevice(id, name, userServices)`）。
  - 不支持的浏览器：整面板只显示灰态说明（为什么不支持：需要 Chrome/Edge + HTTPS；iOS Safari 不支持；安卓 App 壳的 WebView 不支持），不渲染添加按钮。

- [ ] **Step 3: BluetoothPanel device view** — 设备详情视图（`selectedId` state 控制）：
  - 顶部：设备名 + 连接态 + 连接/断开按钮；指令芯片区：每条已保存指令一个芯片（名 + 发送按钮 + 删除按钮），发送 = `bleEngine.writeValue(id, cmd.serviceUuid, cmd.characteristicUuid, cmd.format, cmd.payload, cmd.writeMode)`，catch 到错
...[truncated 3881 chars]


