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
