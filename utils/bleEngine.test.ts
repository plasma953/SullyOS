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
    expect(decodeValue(dvOf([0xaa, 0x41]))).toEqual({ hex: 'AA 41', text: '�A' });
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
