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
  private disconnectListeners = new Map<string, EventListener>();
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
      const prevDisconnectHandler = this.disconnectListeners.get(deviceId);
      if (prevDisconnectHandler) {
        try { device.removeEventListener('gattserverdisconnected', prevDisconnectHandler); } catch { /* ignore */ }
      }
      const disconnectHandler = () => {
        this.teardownNotify(deviceId);
        this.setState(deviceId, 'disconnected');
        this.log('sys', deviceId, '设备断开连接');
      };
      device.addEventListener('gattserverdisconnected', disconnectHandler);
      this.disconnectListeners.set(deviceId, disconnectHandler as unknown as EventListener);
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
