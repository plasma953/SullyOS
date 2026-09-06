import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error The deployed Worker entry is intentionally plain runtime JavaScript.
import worker from './index.js';

// B站内容抓取代理（/bilibili/*）的契约测试。前端 utils/bilibiliCard.ts 依赖这些端点；
// 上游全部 stub，不碰真实 B站。风格照抄 worker/xhs-lite/session-risk.test.ts。
const BVID = 'BV1xx411c7mD';
const CID = '12345678';

const callBili = (path: string, query = '') =>
  worker.fetch(new Request(`https://local.test${path}${query}`), {}, { waitUntil() {} });

const seen: Array<{ url: string; headers: Headers }> = [];
const stubUpstream = (routes: Record<string, { status?: number; body: unknown; contentType?: string }>) => {
  seen.length = 0;
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    seen.push({ url: url.toString(), headers: new Headers(init?.headers) });
    const route = routes[`${url.hostname}${url.pathname}`];
    if (!route) throw new Error(`unexpected upstream request: ${url}`);
    const text = typeof route.body === 'string' ? route.body : JSON.stringify(route.body);
    return new Response(text, {
      status: route.status ?? 200,
      headers: { 'content-type': route.contentType ?? 'application/json' },
    });
  });
};

afterEach(() => {
  vi.restoreAllMocks();
});

const viewOk = {
  code: 0,
  data: {
    bvid: BVID, aid: 12345, cid: Number(CID),
    title: '测试视频标题', desc: '视频简介若干',
    owner: { name: '测试UP主' },
    stat: { view: 1000000, like: 50000, coin: 20000, favorite: 30000, share: 5000, reply: 8000 },
    duration: 600, pubdate: 1700000000,
    pic: 'http://i1.hdslb.com/bfs/archive/cover.jpg',
  },
};

const playerOk = {
  code: 0,
  data: {
    subtitle: {
      allow_submit: true,
      lan: 'zh-CN',
      subtitles: [{
        lan: 'zh-CN', lan_doc: '中文（中国）',
        subtitle_url: 'https://aisubtitle.hdslb.com/bfs/ai_subtitle/prod/xxx.json',
      }],
    },
  },
};

const storyboardOk = {
  code: 0,
  data: {
    img_x_len: 10, img_y_len: 10,
    img_x_size: 1600, img_y_size: 900,
    image: ['https://i0.hdslb.com/bfs/storyboard/xxx-1.webp'],
    index: [1],
  },
};

describe('/bilibili/view', () => {
  it('bvid 正常时透传稿件元数据', async () => {
    stubUpstream({ 'api.bilibili.com/x/web-interface/view': { body: viewOk } });
    const res = await callBili('/bilibili/view', `?bvid=${BVID}`);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.title).toBe('测试视频标题');
    expect(body.data.owner.name).toBe('测试UP主');
    // 上游请求带 Referer/UA 过风控
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toContain('/x/web-interface/view');
    expect(seen[0].headers.get('referer')).toContain('bilibili.com');
  });

  it('缺 bvid 回 400', async () => {
    stubUpstream({});
    const res = await callBili('/bilibili/view');
    expect(res.status).toBe(400);
    expect((await res.json() as any).error).toBeTruthy();
  });

  it('上游业务失败（code!=0）不包 success，直接 502 报错', async () => {
    stubUpstream({ 'api.bilibili.com/x/web-interface/view': { body: { code: -404, message: '啥都木有' } } });
    const res = await callBili('/bilibili/view', `?bvid=${BVID}`);
    expect(res.status).toBe(502);
    const body: any = await res.json();
    expect(body.success).not.toBe(true);
    expect(body.error).toBeTruthy();
  });
});

describe('/bilibili/player', () => {
  it('bvid+cid 正常时透传字幕列表', async () => {
    stubUpstream({ 'api.bilibili.com/x/player/v2': { body: playerOk } });
    const res = await callBili('/bilibili/player', `?bvid=${BVID}&cid=${CID}`);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.subtitle.subtitles[0].lan).toBe('zh-CN');
    expect(seen[0].url).toContain('/x/player/v2');
  });

  it('缺 cid 回 400', async () => {
    stubUpstream({});
    const res = await callBili('/bilibili/player', `?bvid=${BVID}`);
    expect(res.status).toBe(400);
  });
});

describe('/bilibili/storyboard', () => {
  it('bvid+cid 正常时透传预览帧雪碧图信息', async () => {
    stubUpstream({ 'api.bilibili.com/x/player/videoshot': { body: storyboardOk } });
    const res = await callBili('/bilibili/storyboard', `?bvid=${BVID}&cid=${CID}`);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.image[0]).toContain('hdslb.com');
    expect(body.data.img_x_len).toBe(10);
  });

  it('缺参数回 400', async () => {
    stubUpstream({});
    const res = await callBili('/bilibili/storyboard', `?bvid=${BVID}`);
    expect(res.status).toBe(400);
  });
});

describe('/bilibili/asset', () => {
  const spriteUrl = 'https://i0.hdslb.com/bfs/storyboard/xxx-1.webp';

  it('白名单 CDN 资源原样透传二进制 + 保留 content-type + CORS 头', async () => {
    stubUpstream({ 'i0.hdslb.com/bfs/storyboard/xxx-1.webp': { body: 'FAKEWEBPBYTES', contentType: 'image/webp' } });
    const res = await callBili('/bilibili/asset', `?u=${encodeURIComponent(spriteUrl)}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('image/webp');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(await res.text()).toBe('FAKEWEBPBYTES');
  });

  it('非白名单域名拒绝（防开放代理）', async () => {
    stubUpstream({});
    const res = await callBili('/bilibili/asset', `?u=${encodeURIComponent('https://evil.example.com/x.webp')}`);
    expect(res.status).toBe(400);
    expect(seen).toHaveLength(0); // 根本没发上游请求
  });

  it('缺 u 参数回 400', async () => {
    stubUpstream({});
    const res = await callBili('/bilibili/asset');
    expect(res.status).toBe(400);
  });
});
