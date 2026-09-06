import { describe, it, expect } from 'vitest';
import { normalizeMessageContent } from './messageFormat';
import type { Message } from '../types';

const base: Omit<Message, 'type' | 'content' | 'metadata'> = {
  id: 1, charId: 'c1', role: 'user', timestamp: 0,
};
const mk = (type: string, content: string, metadata?: any): Message =>
  ({ ...base, type, content, metadata } as Message);

describe('normalizeMessageContent · xhs_card', () => {
  it('有 MCP 正文时把标题+正文+作者喂给角色', () => {
    const out = normalizeMessageContent(
      mk('xhs_card', '睡不够', { xhsNote: { title: '睡不够', desc: '今天画了花岗岩版', author: '某人' } }),
      'Char', '我',
    );
    expect(out).toContain('《睡不够》');
    expect(out).toContain('作者：某人');
    expect(out).toContain('今天画了花岗岩版');
  });

  it('有评论时把评论区也喂给角色（user 分享的笔记也能看到评论）', () => {
    const out = normalizeMessageContent(
      mk('xhs_card', '睡不够', { xhsNote: {
        title: '睡不够', desc: '今天画了花岗岩版', author: '某人',
        comments: [
          { author: '路人甲', content: '太好笑了', likes: 12 },
          { author: '路人乙', content: '同款', likes: 3 },
        ],
      } }),
      'Char', '我',
    );
    expect(out).toContain('评论区');
    expect(out).toContain('路人甲');
    expect(out).toContain('太好笑了');
    expect(out).toContain('路人乙');
  });

  it('只有文案标题(无 MCP/没抓到正文)时给标题并明示别瞎编', () => {
    const out = normalizeMessageContent(
      mk('xhs_card', '睡不够', { xhsNote: { title: '睡不够', desc: '', author: '' } }),
      'Char', '我',
    );
    expect(out).toContain('《睡不够》');
    expect(out).toContain('别假装读过');
    expect(out).not.toContain('笔记正文');
  });

  it('标题也没有时不崩，给出"没能获取到"', () => {
    const out = normalizeMessageContent(mk('xhs_card', '', { xhsNote: {} }), 'Char', '我');
    expect(out).toContain('小红书笔记');
    expect(out).toContain('没能获取到');
  });
});

describe('normalizeMessageContent · webpage_card（B站官方接口路径）', () => {
  const biliVideo = {
    platform: 'bilibili', platformLabel: '哔哩哔哩', contentType: 'video',
    authorName: '测试UP主', playCount: 1000000, bvid: 'BV1xx411c7mD',
  };
  const mkBili = (video: any) => mk('webpage_card', '测试视频', {
    webpage: {
      title: '测试视频', siteName: '哔哩哔哩', content: '',
      finalUrl: 'https://www.bilibili.com/video/BV1xx411c7mD', video,
    },
  });

  it('有字幕全文时全量注入，并说明已看完', () => {
    const out = normalizeMessageContent(
      mkBili({ ...biliVideo, subtitles: '[00:01] 开场\n[00:05] 正片', subtitleCount: 2 }),
      'Char', '我',
    );
    expect(out).toContain('开场');
    expect(out).toContain('正片');
    expect(out).toContain('完整字幕');
    expect(out).not.toContain('别假装看过视频内容');
  });

  it('只有简介时注入简介，仍保留看不到画面的说明', () => {
    const out = normalizeMessageContent(
      mkBili({ ...biliVideo, desc: '这期讲测试方法' }),
      'Char', '我',
    );
    expect(out).toContain('这期讲测试方法');
    expect(out).toContain('看不到视频画面');
  });

  it('画面描述（拼图识图缓存）注入', () => {
    const out = normalizeMessageContent(
      mkBili({ ...biliVideo, visionDescription: '街景与人群' }),
      'Char', '我',
    );
    expect(out).toContain('街景与人群');
  });

  it('超长字幕触发保险截断（10 万字符）', () => {
    const out = normalizeMessageContent(
      mkBili({ ...biliVideo, subtitles: '字'.repeat(100001) }),
      'Char', '我',
    );
    expect(out).toContain('已截断');
    expect(out.length).toBeLessThan(110000);
  });

  it('回归：普通 apizero 视频卡行为不变', () => {
    const out = normalizeMessageContent(
      mkBili({ platform: 'bilibili', platformLabel: '哔哩哔哩', authorName: 'U' }),
      'Char', '我',
    );
    expect(out).toContain('别假装看过视频内容');
  });
});

describe('normalizeMessageContent · webpage_card', () => {
  it('有正文时注入网页正文', () => {
    const out = normalizeMessageContent(
      mk('webpage_card', '某文章', { webpage: { title: '某文章', siteName: 'blog.com', content: '正文内容若干', finalUrl: 'https://blog.com/a' } }),
      'Char', '我',
    );
    expect(out).toContain('《某文章》');
    expect(out).toContain('网页正文');
    expect(out).toContain('正文内容若干');
  });

  it('正文抓空时明示没抓到，别假装读过', () => {
    const out = normalizeMessageContent(
      mk('webpage_card', 'MSN', { webpage: { title: 'MSN', siteName: 'msn.com', content: '', excerpt: '' } }),
      'Char', '我',
    );
    expect(out).toContain('《MSN》');
    expect(out).toContain('没能抓取到');
    expect(out).not.toContain('网页正文');
  });
});
