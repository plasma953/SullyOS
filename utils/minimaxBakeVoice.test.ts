/**
 * postBakeVoice / resolveBakeVoiceUrls：worker 优先、相对路径回退。
 * fetch 全 mock，无真请求。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  BAKE_VOICE_RELATIVE_PATH,
  isBakeVoiceRouteMissing,
  postBakeVoice,
  resolveBakeVoiceUrls,
} from './minimaxBakeVoice';

const PRIMARY = 'https://worker.test/minimax/bake-voice';
const PAYLOAD = { apiKey: 'k', voiceId: 'vcabc123', model: 'speech-2.8-hd', ttsPayload: {} };

const jsonRes = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('resolveBakeVoiceUrls', () => {
  it('worker 优先拼接、回退走相对路径（去尾斜杠）', () => {
    expect(resolveBakeVoiceUrls('https://my-worker.example.com/')).toEqual({
      primary: 'https://my-worker.example.com/minimax/bake-voice',
      fallback: BAKE_VOICE_RELATIVE_PATH,
    });
    expect(resolveBakeVoiceUrls('https://my-worker.example.com').fallback).toBe('/api/minimax/bake-voice');
  });

  it('isBakeVoiceRouteMissing 只认 404/405', () => {
    expect(isBakeVoiceRouteMissing(404)).toBe(true);
    expect(isBakeVoiceRouteMissing(405)).toBe(true);
    expect(isBakeVoiceRouteMissing(401)).toBe(false);
    expect(isBakeVoiceRouteMissing(502)).toBe(false);
    expect(isBakeVoiceRouteMissing(200)).toBe(false);
  });
});

describe('postBakeVoice', () => {
  it('worker 成功 → 直接返回，不碰回退', async () => {
    const fake = vi.fn(async (url: string) => {
      expect(String(url)).toBe(PRIMARY);
      return jsonRes(200, { success: true, voice_id: 'vcabc123' });
    });
    vi.stubGlobal('fetch', fake);
    const data = await postBakeVoice({ primary: PRIMARY, fallback: BAKE_VOICE_RELATIVE_PATH, payload: PAYLOAD, region: 'domestic' });
    expect(data).toMatchObject({ success: true });
    expect(fake).toHaveBeenCalledTimes(1);
  });

  it('worker 404（未重新部署）→ 回退相对路径并返回', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(String(url));
      if (String(url) === PRIMARY) return jsonRes(404, { error: 'not found' });
      return jsonRes(200, { success: true, voice_id: 'vcabc123' });
    }));
    const data = await postBakeVoice({ primary: PRIMARY, fallback: BAKE_VOICE_RELATIVE_PATH, payload: PAYLOAD, region: 'domestic' });
    expect(data).toMatchObject({ success: true });
    expect(calls).toEqual([PRIMARY, BAKE_VOICE_RELATIVE_PATH]);
  });

  it('worker 业务失败（401）→ 直接抛，不回退', async () => {
    const fake = vi.fn(async () => jsonRes(401, { error: 'invalid key' }));
    vi.stubGlobal('fetch', fake);
    await expect(postBakeVoice({ primary: PRIMARY, fallback: BAKE_VOICE_RELATIVE_PATH, payload: PAYLOAD, region: 'domestic' }))
      .rejects.toThrow('invalid key');
    expect(fake).toHaveBeenCalledTimes(1);
  });

  it('两路都不可用 → 明确抛"当前部署不支持固定声音"', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url) === PRIMARY) throw new TypeError('fetch failed');
      return jsonRes(404, 'not found');
    }));
    await expect(postBakeVoice({ primary: PRIMARY, fallback: BAKE_VOICE_RELATIVE_PATH, payload: PAYLOAD, region: 'domestic' }))
      .rejects.toThrow('当前部署不支持固定声音');
  });
});
