import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    addHiddenDoubanId,
    DEFAULT_DOUBAN_GROUPS,
    doubanImgUrl,
    fetchDoubanTopics,
    isDoubanImageUrl,
    loadDoubanGroups,
    loadHiddenDoubanIds,
    normalizeDoubanComment,
    normalizeDoubanTopic,
    parseDoubanGroupInput,
    parseDoubanTime,
    saveDoubanGroups,
    stripHtml,
} from './doubanSource';
import type { DoubanGroup } from './doubanSource';

const GROUP: DoubanGroup = { id: 'hangzhou', name: '杭州' };

// 实测 rexxar 话题条目形状（字段有删减，结构保持原样）
const TOPIC_FIXTURE = {
    abstract: '求推荐好吃的本帮菜',
    author: {
        avatar: 'https://img3.doubanio.com/icon/up181715904-3.jpg',
        id: '181715904',
        name: '豆友9527',
    },
    comments_count: 15,
    cover_url: '',
    create_time: '2026-09-06 12:34:52',
    id: '484935880',
    photos: [
        {
            image: {
                large: { height: 349, width: 500, url: 'https://img3.doubanio.com/view/group_topic/l/public/p542398873.jpg' },
                normal: { height: 349, width: 500, url: 'https://img3.doubanio.com/view/group_topic/l/public/p542398873.jpg' },
            },
        },
    ],
    reactions_count: 7,
    title: '杭州好吃的本帮菜求推荐',
    update_time: '2026-09-06 14:51:26',
    url: 'https://www.douban.com/group/topic/484935880/',
};

afterEach(() => {
    vi.restoreAllMocks();
    localStorage.removeItem('spark_douban_groups');
    localStorage.removeItem('spark_douban_hidden');
});

describe('normalizeDoubanTopic', () => {
    it('真实条目归一化成 SocialPost（id 前缀/来源/小组/图片/时间）', () => {
        const post = normalizeDoubanTopic(TOPIC_FIXTURE, GROUP);
        expect(post).not.toBeNull();
        expect(post!.id).toBe('douban:484935880');
        expect(post!.origin).toBe('douban');
        expect(post!.sourceId).toBe('484935880');
        expect(post!.groupTitle).toBe('杭州');
        expect(post!.groupId).toBe('hangzhou');
        expect(post!.title).toBe('杭州好吃的本帮菜求推荐');
        expect(post!.content).toBe('求推荐好吃的本帮菜');
        expect(post!.authorName).toBe('豆友9527');
        // 库里存豆瓣原链，不存代理地址
        expect(post!.images).toEqual(['https://img3.doubanio.com/view/group_topic/l/public/p542398873.jpg']);
        expect(post!.authorType).toBe('stranger');
        expect(post!.timestamp).toBe(new Date('2026-09-06T14:51:26').getTime());
    });

    it('缺 id 或标题返回 null', () => {
        expect(normalizeDoubanTopic({ title: 'x' }, GROUP)).toBeNull();
        expect(normalizeDoubanTopic({ id: '1' }, GROUP)).toBeNull();
        expect(normalizeDoubanTopic(null, GROUP)).toBeNull();
    });

    it('无图无简介时给安全默认值', () => {
        const post = normalizeDoubanTopic({ id: '99', title: 't' }, GROUP)!;
        expect(post.images).toEqual([]);
        expect(post.content).toBe('');
        expect(post.authorName).toBe('豆友');
        expect(post.sourceUrl).toBe('https://www.douban.com/group/topic/99/');
        expect(Number.isFinite(post.timestamp)).toBe(true);
    });
});

describe('normalizeDoubanComment', () => {
    it('嵌套 author + text 形态', () => {
        const c = normalizeDoubanComment({
            id: 123,
            text: '同问！求地址',
            vote_count: 5,
            author: { name: '吃货', avatar: 'https://img1.doubanio.com/icon/u1.jpg' },
        })!;
        expect(c.id).toBe('douban-cmt:123');
        expect(c.authorName).toBe('吃货');
        expect(c.content).toBe('同问！求地址');
        expect(c.likes).toBe(5);
        expect(c.authorType).toBe('stranger');
    });

    it('content 字段 + HTML 转纯文本 + 超长截断', () => {
        const c = normalizeDoubanComment({ id: 'a', content: '<p>hi<br/>there</p>', author: {} })!;
        expect(c.content).toBe('hi\nthere');
        const long = normalizeDoubanComment({ id: 'b', text: 'x'.repeat(600), author: {} })!;
        expect(long.content.length).toBe(500);
    });

    it('空内容/非对象返回 null', () => {
        expect(normalizeDoubanComment({ id: 1, author: {} })).toBeNull();
        expect(normalizeDoubanComment(null)).toBeNull();
    });
});

describe('parseDoubanTime / stripHtml', () => {
    it('豆瓣时间字符串解析', () => {
        expect(parseDoubanTime('2026-09-06 14:51:26')).toBe(new Date('2026-09-06T14:51:26').getTime());
        expect(parseDoubanTime('2026-09-06 19:50:46.639321')).toBe(new Date('2026-09-06T19:50:46.639').getTime());
    });

    it('非法输入回 0（脏时间沉底，绝不能冒充最新）', () => {
        expect(parseDoubanTime('not-a-date')).toBe(0);
        expect(parseDoubanTime(undefined)).toBe(0);
        expect(parseDoubanTime('')).toBe(0);
    });

    it('stripHtml 去标签转义字符', () => {
        expect(stripHtml('<p>a<br/>b</p>')).toBe('a\nb');
        expect(stripHtml('a&nbsp;&amp;&nbsp;b')).toBe('a & b');
        expect(stripHtml(null)).toBe('');
    });
});

describe('小组管理', () => {
    it('默认预置 8 个实测活跃组', () => {
        expect(DEFAULT_DOUBAN_GROUPS.length).toBe(8);
        expect(DEFAULT_DOUBAN_GROUPS.map(g => g.id)).toContain('hangzhou');
    });

    it('load/save roundtrip，坏数据回退默认', () => {
        expect(loadDoubanGroups()).toEqual(DEFAULT_DOUBAN_GROUPS);
        saveDoubanGroups([{ id: 'meishi', name: '美食' }]);
        expect(loadDoubanGroups()).toEqual([{ id: 'meishi', name: '美食' }]);
        localStorage.setItem('spark_douban_groups', '{坏}');
        expect(loadDoubanGroups()).toEqual(DEFAULT_DOUBAN_GROUPS);
    });

    it('parseDoubanGroupInput 接受 slug / URL / 数字 id', () => {
        expect(parseDoubanGroupInput('meishi')).toBe('meishi');
        expect(parseDoubanGroupInput('https://www.douban.com/group/meishi/')).toBe('meishi');
        expect(parseDoubanGroupInput('https://m.douban.com/group/12345/')).toBe('12345');
        expect(parseDoubanGroupInput('  hangzhou  ')).toBe('hangzhou');
        expect(parseDoubanGroupInput('')).toBeNull();
        expect(parseDoubanGroupInput('有 空格 的')).toBeNull();
        expect(parseDoubanGroupInput('https://evil.com/group/x')).toBeNull();
    });

    it('隐藏 id 集合读写（删掉的豆瓣帖不再回来）', () => {
        expect(loadHiddenDoubanIds().size).toBe(0);
        addHiddenDoubanId('484935880');
        expect(loadHiddenDoubanIds().has('484935880')).toBe(true);
    });
});

describe('doubanImgUrl', () => {
    it('豆瓣图床走 worker 代理', () => {
        const raw = 'https://img3.doubanio.com/view/group_topic/l/public/p1.jpg';
        expect(isDoubanImageUrl(raw)).toBe(true);
        expect(doubanImgUrl(raw)).toBe(
            `https://sullymeow.ccwu.cc/social/img?u=${encodeURIComponent(raw)}`,
        );
    });

    it('非豆瓣链接原样透传', () => {
        expect(isDoubanImageUrl('https://api.dicebear.com/7.x/x?seed=a')).toBe(false);
        expect(doubanImgUrl('https://api.dicebear.com/7.x/x?seed=a')).toBe('https://api.dicebear.com/7.x/x?seed=a');
        expect(doubanImgUrl('')).toBe('');
    });
});

describe('fetchDoubanTopics', () => {
    it('包 success 信封的 topics 数组归一化，隐藏 id 被过滤', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: true,
            text: async () => JSON.stringify({ success: true, data: { topics: [TOPIC_FIXTURE, { id: 'hidden1', title: '藏' }] } }),
        })));
        addHiddenDoubanId('hidden1');
        const posts = await fetchDoubanTopics(GROUP, 0);
        expect(posts.map(p => p.id)).toEqual(['douban:484935880']);
    });

    it('上游失败直接抛错（调用方静默降级）', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: false,
            status: 502,
            text: async () => JSON.stringify({ error: '豆瓣接口超时' }),
        })));
        await expect(fetchDoubanTopics(GROUP, 0)).rejects.toThrow('豆瓣接口超时');
    });
});
