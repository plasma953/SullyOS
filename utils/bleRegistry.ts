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
