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
