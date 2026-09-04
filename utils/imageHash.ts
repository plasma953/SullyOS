import { hashBlob } from '@rei-standard/blob-store';

export async function sha256Hex(blob: Blob): Promise<string> {
  return hashBlob(blob);
}

export function isSha256Hex(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
}
