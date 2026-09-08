/**
 * 中心 worker 的 /minimax/bake-voice 编排路由（worker/index.js）。
 *
 * 复用 api/minimax/bake-voice.ts 的三步逻辑（T2A→upload→voice_clone）。
 * 锁住：
 *   - key 随请求来（body.apiKey）、worker 不读不存，缺 key → 401，且一次上游都不发
 *   - 缺 voiceId/ttsPayload → 400，上游不发
 *   - 非 POST → 405
 *   - 三步只调 MiniMax 固定域名（domestic api.minimaxi.com / overseas api.minimax.io）
 *   - 上游业务失败 → 502 明文案；绝不回退服务端 env
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
// @ts-expect-error 中心 worker 是纯 JS 单文件，仓库没开 allowJs
import worker from './index.js';

const HEX_AUDIO = 'fffb90000000fffb90000000fffb90000000fffb90000000';

const jsonRes = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const callBake = (body: unknown, { method = 'POST', region = undefined as string | undefined } = {}) => {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (region) h['X-MiniMax-Region'] = region;
  return worker.fetch(
    new Request('https://proxy.test/minimax/bake-voice', {
      method,
      headers: h,
      body: method === 'POST' ? JSON.stringify(body) : undefined,
    }),
    {},
    { waitUntil: () => {} },
  );
};

const okBody = (over: Record<string, unknown> = {}) => ({
  apiKey: 'sk-test-key',
  voiceId: 'vcabc123',
  model: 'speech-2.8-hd',
  ttsPayload: { voice_setting: { voice_id: 'moss_audio' } },
  region: 'domestic',
  ...over,
});

/** 三步全成功的上游 stub（T2A 走 HEX 音频，不触发下载分支）。 */
const stubHappyPath = () => {
  const calls: Array<{ url: string; init: any }> = [];
  const fake = vi.fn(async (url: string, init: any) => {
    calls.push({ url: String(url), init });
    const u = String(url);
    if (u.endsWith('/v1/t2a_v2')) {
      return jsonRes(200, { base_resp: { status_code: 0 }, data: { audio: HEX_AUDIO } });
    }
    if (u.endsWith('/v1/files/upload')) {
      return jsonRes(200, { file: { file_id: 'file-1' } });
    }
    if (u.endsWith('/v1/voice_clone')) {
      return jsonRes(200, { base_resp: { status_code: 0 }, data: { audio: 'hex-preview' } });
    }
    throw new Error(`unexpected upstream: ${u}`);
  });
  vi.stubGlobal('fetch', fake);
  return calls;
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('/minimax/bake-voice 编排', () => {
  it('非 POST → 405，上游不发', async () => {
    const calls: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (...a: unknown[]) => { calls.push(a); throw new Error('must not fetch'); }));
    const res = await callBake(null, { method: 'GET' });
    expect(res.status).toBe(405);
    expect(calls).toHaveLength(0);
  });

  it('缺 apiKey → 401，且一次上游都不发', async () => {
    const calls: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (...a: unknown[]) => { calls.push(a); throw new Error('must not fetch'); }));
    const res = await callBake(okBody({ apiKey: '' }));
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it('缺 voiceId/ttsPayload → 400，上游不发', async () => {
    const calls: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (...a: unknown[]) => { calls.push(a); throw new Error('must not fetch'); }));
    expect((await callBake(okBody({ voiceId: '' }))).status).toBe(400);
    expect((await callBake(okBody({ ttsPayload: null }))).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('三步成功 → 200，key 原样透传、只调 MiniMax 国内固定域名', async () => {
    const calls = stubHappyPath();
    const res = await callBake(okBody());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, file_id: 'file-1', voice_id: 'vcabc123' });
    expect(calls).toHaveLength(3);
    expect(calls.map((c) => c.url)).toEqual([
      'https://api.minimaxi.com/v1/t2a_v2',
      'https://api.minimaxi.com/v1/files/upload',
      'https://api.minimaxi.com/v1/voice_clone',
    ]);
    for (const c of calls) {
      expect(c.init.headers['Authorization']).toBe('Bearer sk-test-key');
    }
    // clone 步带上 voice_id
    expect(JSON.parse(calls[2].init.body)).toMatchObject({ file_id: 'file-1', voice_id: 'vcabc123' });
  });

  it('region=overseas（header 透传）→ 走 api.minimax.io', async () => {
    const calls = stubHappyPath();
    const { region: _drop, ...noRegion } = okBody();
    const res = await callBake(noRegion, { region: 'overseas' });
    expect(res.status).toBe(200);
    expect(calls[0].url).toBe('https://api.minimax.io/v1/t2a_v2');
    expect(calls[1].url).toBe('https://api.minimax.io/v1/files/upload');
  });

  it('T2A 业务失败 → 502 明文案，不再走后两步', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(String(url));
      return jsonRes(200, { base_resp: { status_code: 1004, status_msg: 'auth failed' } });
    }));
    const res = await callBake(okBody());
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('T2A') });
    expect(calls).toHaveLength(1);
  });

  it('上游网络异常 → 502，不吞错', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('upstream down'); }));
    const res = await callBake(okBody());
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: 'MiniMax 上游请求失败' });
  });
});
