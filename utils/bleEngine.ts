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
  return `
### 蓝牙外设
你的手机正通过蓝牙连着这些真实设备（用户授权配对的）：
${lines.join('\n')}
要控制某个设备时，调用 ble_send_command 工具，device 填设备名、command 填上面的指令名；只能发送这些已保存的具名指令，不要编造指令。
`;
}
