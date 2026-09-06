import { describe, it, expect, afterEach, vi } from 'vitest';
import {
    detectBilibiliShare,
    extractBvidFromUrl,
    resolveBvid,
    subtitleBodyToText,
    formatSubtitleTime,
    computeSpriteFrameRects,
    mapViewToWebpage,
    fetchBilibiliWebpage,
} from './bilibiliCard';

const BVID = 'BV1xx411c7mD';

const mockFetch = (router: (url: string) => { status?: number; body: unknown }) => {
    const fn = vi.fn(async (...args: any[]) => {
        const r = router(String(args[0]));
        return {
            ok: (r.status ?? 200) >= 200 && (r.status ?? 200) < 300,
            status: r.status ?? 200,
            text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)),
        };
    });
    vi.stubGlobal('fetch', fn);
    return fn;
};

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('detectBilibiliShare', () => {
    it('完整视频链接命中并提取 BV 号', () => {
        expect(detectBilibiliShare(`看看这个 https://www.bilibili.com/video/${BVID} 很有意思`))
            .toMatchObject({ kind: 'bvid', bvid: BVID });
    });

    it('带分 P 参数的链接也命中', () => {
        expect(detectBilibiliShare(`https://www.bilibili.com/video/${BVID}?p=3&vd_source=abc`))
            .toMatchObject({ kind: 'bvid', bvid: BVID });
    });

    it('手机端域名命中', () => {
        expect(detectBilibiliShare(`https://m.bilibili.com/video/${BVID}`))
            .toMatchObject({ kind: 'bvid', bvid: BVID });
    });

    it('b23.tv 短链命中为待展开的 url 类型', () => {
        expect(detectBilibiliShare('https://b23.tv/abc123XYZ 快看'))
            .toMatchObject({ kind: 'url' });
    });

    it('裸 BV 号（无链接）命中', () => {
        expect(detectBilibiliShare(`昨晚刷到 ${BVID} 笑死`))
            .toMatchObject({ kind: 'bvid', bvid: BVID });
    });

    it('非 B站内容不命中', () => {
        expect(detectBilibiliShare('https://www.xiaohongshu.com/explore/abc')).toBeNull();
        expect(detectBilibiliShare('https://v.douyin.com/xyz/')).toBeNull();
        expect(detectBilibiliShare('今天天气不错')).toBeNull();
        expect(detectBilibiliShare('')).toBeNull();
    });

    it('位数不对的 BV 形字符串不命中（防误吞 11 位以上）', () => {
        expect(detectBilibiliShare('BV12345678901')).toBeNull();
        expect(detectBilibiliShare('BV12345')).toBeNull();
    });
});

describe('extractBvidFromUrl', () => {
    it('从各种视频 URL 形态提取 BV 号', () => {
        expect(extractBvidFromUrl(`https://www.bilibili.com/video/${BVID}`)).toBe(BVID);
        expect(extractBvidFromUrl(`https://www.bilibili.com/video/${BVID}/?p=2`)).toBe(BVID);
        expect(extractBvidFromUrl(`https://m.bilibili.com/video/${BVID}`)).toBe(BVID);
    });

    it('av 号 / 非视频页返回空（交给 apizero 兜底）', () => {
        expect(extractBvidFromUrl('https://www.bilibili.com/video/av123456')).toBe('');
        expect(extractBvidFromUrl('https://space.bilibili.com/123')).toBe('');
        expect(extractBvidFromUrl('not a url')).toBe('');
    });
});

describe('formatSubtitleTime', () => {
    it('秒数转 mm:ss / h:mm:ss', () => {
        expect(formatSubtitleTime(61.5)).toBe('01:01');
        expect(formatSubtitleTime(0)).toBe('00:00');
        expect(formatSubtitleTime(3661)).toBe('1:01:01');
    });
});

describe('subtitleBodyToText', () => {
    it('字幕 body 转时间轴纯文本，跳过空行并按时间排序', () => {
        const out = subtitleBodyToText([
            { from: 63.2, to: 65, content: '第二句' },
            { from: 1.0, to: 3, content: '  第一句  ' },
            { from: 10, to: 12, content: '' },
            { from: 20, to: 22, content: '   ' },
        ]);
        expect(out).toBe('[00:01] 第一句\n[01:03] 第二句');
    });

    it('空 body 返回空串', () => {
        expect(subtitleBodyToText([])).toBe('');
        expect(subtitleBodyToText(null as any)).toBe('');
    });
});

describe('computeSpriteFrameRects', () => {
    const meta = { imgXLen: 10, imgYLen: 10, imgX: 160, imgY: 90, frameCount: 100, intervalSec: 6 };

    it('均匀采样 N 帧并算出雪碧图切片坐标', () => {
        const rects = computeSpriteFrameRects(meta, 3);
        expect(rects).toHaveLength(3);
        // 首帧 = 第 0 格，末帧 = 第 99 格
        expect(rects[0]).toMatchObject({ sx: 0, sy: 0, sw: 160, sh: 90, atSec: 0 });
        expect(rects[2]).toMatchObject({ sx: 9 * 160, sy: 9 * 90, atSec: 99 * 6 });
        // 中间帧 = 第 50 格（第 5 行行首）
        expect(rects[1]).toMatchObject({ sx: 0, sy: 5 * 90, atSec: 50 * 6 });
    });

    it('边界：count<=0 返回空；count 超过总数返回全部', () => {
        expect(computeSpriteFrameRects(meta, 0)).toEqual([]);
        expect(computeSpriteFrameRects(meta, 200)).toHaveLength(100);
    });
});

describe('mapViewToWebpage', () => {
    const view = {
        bvid: BVID, aid: 12345, cid: 67890,
        title: '测试视频', desc: '简介若干',
        owner: { name: '测试UP主' },
        stat: { view: 1000000, like: 50000, coin: 20000, favorite: 30000, share: 5000, reply: 8000 },
        duration: 600, pubdate: 1700000000,
        pic: 'http://i1.hdslb.com/bfs/archive/cover.jpg',
    };

    it('view 映射成 ExtractedWebpage（video 附加字段）', () => {
        const wp = mapViewToWebpage(view, `https://www.bilibili.com/video/${BVID}`);
        expect(wp.provider).toBe('bilibili-api');
        expect(wp.title).toBe('测试视频');
        expect(wp.finalUrl).toBe(`https://www.bilibili.com/video/${BVID}`);
        // 封面 http→https（与 xhs coverUrl 同一处理）
        expect(wp.image).toBe('https://i1.hdslb.com/bfs/archive/cover.jpg');
        expect(wp.video).toMatchObject({
            platform: 'bilibili',
            platformLabel: '哔哩哔哩',
            contentType: 'video',
            authorName: '测试UP主',
            playCount: 1000000,
            likeCount: 50000,
            commentCount: 8000,
            bvid: BVID,
            cid: 67890,
            durationSec: 600,
        });
        expect(wp.content).toBe('');
    });
});

describe('resolveBvid', () => {
    it('b23.tv 短链经 expandShortUrl 展开后提取 BV 号', async () => {
        mockFetch((url) => url.includes('/expand-url')
            ? { body: { success: true, data: { finalUrl: `https://www.bilibili.com/video/${BVID}?vd_source=abc` } } }
            : { status: 404, body: {} });
        await expect(resolveBvid({ kind: 'url', url: 'https://b23.tv/abc123XYZ' })).resolves.toBe(BVID);
    });
});

describe('fetchBilibiliWebpage', () => {
    // 注意：这里 stub 的是 sfworker /bilibili/* 的返回（worker 信封 {success,data}），
    // 上游 B站原接口形状见 worker/bilibiliProxy.test.ts。
    const viewData = {
        bvid: BVID, aid: 1, cid: 2, title: 'T', desc: 'D',
        owner: { name: 'U' }, stat: {}, duration: 60, pubdate: 1, pic: '',
    };
    const subtitleJson = {
        body: [
            { from: 1, to: 2, content: '开场' },
            { from: 5, to: 6, content: '正片' },
        ],
    };

    const biliRouter = (playerRes: unknown, storyboardRes: unknown) => (url: string) => {
        if (url.includes('/bilibili/view')) return { body: { success: true, data: viewData } };
        if (url.includes('/bilibili/player')) return playerRes as any;
        if (url.includes('/bilibili/storyboard')) return storyboardRes as any;
        if (url.includes('/bilibili/asset')) return { body: subtitleJson };
        throw new Error(`unexpected: ${url}`);
    };

    it('全链路成功：字幕全文 + 预览帧信息进 metadata', async () => {
        mockFetch(biliRouter(
            { body: { success: true, data: { subtitle: { subtitles: [{ lan: 'zh-CN', subtitle_url: 'https://aisubtitle.hdslb.com/x.json' }] } } } },
            { body: { success: true, data: { img_x_len: 10, img_y_len: 10, img_x_size: 480, img_y_size: 270, image: ['//bimp.hdslb.com/s.jpg'], index: [1] } } },
        ));
        const wp = await fetchBilibiliWebpage({ kind: 'bvid', bvid: BVID });
        expect(wp.provider).toBe('bilibili-api');
        expect(wp.video?.subtitles).toContain('开场');
        expect(wp.video?.subtitles).toContain('正片');
        // 协议相对地址补成 https（实测 B站 videoshot 返回 //bimp.hdslb.com/…）
        expect(wp.video?.storyboard?.spriteUrl).toBe('https://bimp.hdslb.com/s.jpg');
        expect(wp.video?.storyboard).toMatchObject({ imgX: 480, imgY: 270, frameCount: 100 });
        // node 测试环境无 document，切帧优雅降级为空数组且不抛错
        expect(wp.video?.frames).toEqual([]);
    });

    it('无字幕无预览帧时只剩元数据：不抛错，卡片照建', async () => {
        mockFetch(biliRouter(
            { body: { success: true, data: { subtitle: { subtitles: [] } } } },
            { status: 502, body: { error: 'no storyboard' } },
        ));
        const wp = await fetchBilibiliWebpage({ kind: 'bvid', bvid: BVID });
        expect(wp.video?.subtitles).toBeFalsy();
        expect(wp.video?.storyboard).toBeFalsy();
        expect(wp.title).toBe('T');
    });

    it('view 失败直接抛错（调用方降级 apizero）', async () => {
        mockFetch(() => ({ status: 502, body: { error: 'B站接口返回错误' } }));
        await expect(fetchBilibiliWebpage({ kind: 'bvid', bvid: BVID })).rejects.toThrow();
    });
});
