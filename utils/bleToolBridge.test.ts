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
  it('does not fingerprint failed resolves', async () => {
    const first = await executeBleSendCommand({ device: '不存在的设备', command: '开灯' });
    const second = await executeBleSendCommand({ device: '不存在的设备', command: '开灯' });
    expect(first).toContain('找不到');
    expect(second).toContain('找不到');
  });
});
