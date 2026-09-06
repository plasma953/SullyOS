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
