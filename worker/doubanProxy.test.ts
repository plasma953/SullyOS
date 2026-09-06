import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error The deployed Worker entry is intentionally plain runtime JavaScript.
import worker from './index.js';

// Spark 豆瓣小组内容代理（/social/douban/*, /social/img）的契约测试。
// 前端 utils/doubanSource.ts 依赖这些端点；上游全部 stub，不碰真实豆瓣。
// 风格照抄 worker/bilibiliProxy.test.ts。
const callSocial = (path: string, query = '') =>
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

const topicsOk = {
  topics: [{
    id: '484935880',
    title: '杭州好吃的本帮菜求推荐',
    abstract: '求推荐',
    author: { name: '豆友9527', avatar: 'https://img3.doubanio.com/icon/u.jpg' },
    comments_count: 15,
    update_time: '2026-09-06 14:51:26',
    photos: [],
  }],
  total: 1,
};

const topicDetailOk = {
  id: '484935880',
  title: '杭州好吃的本帮菜求推荐',
  content: '<p>求推荐好吃的本帮菜</p>',
  like_count: 12,
  comments_count: 15,
  photos: [],
};

const commentsOk = {
  total: 2,
  comments: [
    { id: 1, text: '同问', author: { name: '吃货', avatar: '' } },
    { id: 2, text: '收藏了', author: { name: '路人', avatar: '' } },
  ],
};

describe('/social/douban/topics', () => {
  it('合法小组透传话题列表（success 信封）', async () => {
    stubUpstream({ 'm.douban.com/rexxar/api/v2/group/hangzhou/topics': { body: topicsOk } });
    const res = await callSocial('/social/douban/topics', '?group=hangzhou&start=0');
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.topics[0].title).toBe('杭州好吃的本帮菜求推荐');
    // 上游请求带 iPhone UA + m 站 Referer 过风控
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toContain('/rexxar/api/v2/group/hangzhou/topics');
    expect(seen[0].headers.get('user-agent')).toContain('iPhone');
    expect(seen[0].headers.get('referer')).toContain('m.douban.com/group/hangzhou/');
  });

  it('相同请求 120s 内走内存缓存，不再打上游', async () => {
    stubUpstream({ 'm.douban.com/rexxar/api/v2/group/meishi/topics': { body: topicsOk } });
    await callSocial('/social/douban/topics', '?group=meishi&start=0');
    const res = await callSocial('/social/douban/topics', '?group=meishi&start=0');
    expect(res.status).toBe(200);
    expect((await res.json() as any).cached).toBe(true);
    expect(seen).toHaveLength(1);
  });

  it('group 非法回 400 且不发上游请求', async () => {
    stubUpstream({});
    const res = await callSocial('/social/douban/topics', '?group=../../etc');
    expect(res.status).toBe(400);
    expect(seen).toHaveLength(0);
  });

  it('上游 500 → 502，前端走降级', async () => {
    stubUpstream({ 'm.douban.com/rexxar/api/v2/group/travel/topics': { status: 500, body: 'bad gateway' } });
    const res = await callSocial('/social/douban/topics', '?group=travel&start=0');
    expect(res.status).toBe(502);
    expect((await res.json() as any).success).not.toBe(true);
  });
});

describe('/social/douban/topic', () => {
  it('合法 id 透传话题详情', async () => {
    stubUpstream({ 'm.douban.com/rexxar/api/v2/group/topic/484935880': { body: topicDetailOk } });
    const res = await callSocial('/social/douban/topic', '?id=484935880');
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.content).toContain('本帮菜');
  });

  it('id 非法回 400', async () => {
    stubUpstream({});
    const res = await callSocial('/social/douban/topic', '?id=abc');
    expect(res.status).toBe(400);
    expect(seen).toHaveLength(0);
  });
});

describe('/social/douban/comments', () => {
  it('合法 id 透传评论列表', async () => {
    stubUpstream({ 'm.douban.com/rexxar/api/v2/group/topic/484935880/comments': { body: commentsOk } });
    const res = await callSocial('/social/douban/comments', '?id=484935880&start=0');
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.comments).toHaveLength(2);
  });

  it('缺 id 回 400', async () => {
    stubUpstream({});
    const res = await callSocial('/social/douban/comments');
    expect(res.status).toBe(400);
  });
});

describe('/social/img', () => {
  const imgUrl = 'https://img3.doubanio.com/view/group_topic/l/public/p1.jpg';

  it('白名单图床资源原样透传二进制 + 保留 content-type + CORS 头', async () => {
    stubUpstream({ 'img3.doubanio.com/view/group_topic/l/public/p1.jpg': { body: 'FAKEJPEGBYTES', contentType: 'image/jpeg' } });
    const res = await callSocial('/social/img', `?u=${encodeURIComponent(imgUrl)}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('image/jpeg');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(await res.text()).toBe('FAKEJPEGBYTES');
    expect(seen[0].headers.get('referer')).toContain('douban.com');
  });

  it('非白名单域名拒绝（防开放代理）', async () => {
    stubUpstream({});
    const res = await callSocial('/social/img', `?u=${encodeURIComponent('https://evil.example.com/x.jpg')}`);
    expect(res.status).toBe(400);
    expect(seen).toHaveLength(0); // 根本没发上游请求
  });

  it('缺 u 参数回 400', async () => {
    stubUpstream({});
    const res = await callSocial('/social/img');
    expect(res.status).toBe(400);
  });
});
