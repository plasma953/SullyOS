import { describe, it, expect } from 'vitest';
import type { CharacterProfile, Message, UserProfile } from '../types';
import { ChatPrompts } from './chatPrompts';
import { BILIBILI_FRAME_COUNT } from './bilibiliCard';

// buildMessageHistory 的 webpage_card 分支：正文走 normalizeMessageContent 全文，
// B站预览帧（metadata.webpage.video.frames）挂 image_url（多模态主模型白看；
// 有画面描述缓存 + 开识图时只给文本，照图片消息既有模式）。
const char = { id: 'char-1', name: 'Sully' } as CharacterProfile;
const user = { name: 'User' } as UserProfile;

const frames = (n: number): string[] =>
  Array.from({ length: n }, (_, i) => `data:image/jpeg;base64,FRAME${i}`);

const card = (video: any): Message => ({
  id: 1,
  charId: 'char-1',
  role: 'user',
  type: 'webpage_card',
  content: '测试视频',
  timestamp: 1_700_000_000_000,
  metadata: {
    webpage: {
      title: '测试视频', siteName: '哔哩哔哩', content: '',
      finalUrl: 'https://www.bilibili.com/video/BV1xx411c7mD', video,
    },
  },
} as Message);

const history = (msg: Message, options?: { useVisionDescriptions?: boolean }) =>
  ChatPrompts.buildMessageHistory([msg], 10, char, user, [], undefined, options).apiMessages[0];

describe('buildMessageHistory · webpage_card 帧附带', () => {
  it('有帧无描述时：文本 + image_url（字幕进文本，帧随主请求发送）', () => {
    const msg = history(card({
      platform: 'bilibili', subtitles: '[00:01] 开场', frames: frames(3),
    }));
    expect(Array.isArray(msg.content)).toBe(true);
    const parts = msg.content as any[];
    expect(parts[0].type).toBe('text');
    expect(parts[0].text).toContain('开场');
    const images = parts.filter(p => p.type === 'image_url');
    expect(images).toHaveLength(3);
    expect(images[0].image_url.url).toContain('FRAME0');
  });

  it('帧数超过上限时只附前 N 帧', () => {
    const msg = history(card({ platform: 'bilibili', frames: frames(8) }));
    const images = (msg.content as any[]).filter(p => p.type === 'image_url');
    expect(images).toHaveLength(BILIBILI_FRAME_COUNT);
  });

  it('有画面描述缓存 + 开识图时：纯文本，无 image_url（省 token，照图片消息模式）', () => {
    const msg = history(card({
      platform: 'bilibili', frames: frames(3), visionDescription: '街景与人群',
    }), { useVisionDescriptions: true });
    expect(typeof msg.content).toBe('string');
    expect(msg.content).toContain('街景与人群');
    expect(JSON.stringify(msg)).not.toContain('image_url');
  });

  it('无帧时：纯文本走 normalizeMessageContent 全文', () => {
    const msg = history(card({ platform: 'bilibili', subtitles: '[00:01] 开场' }));
    expect(typeof msg.content).toBe('string');
    expect(msg.content).toContain('开场');
  });

  it('非法帧值被过滤（死令牌/非图片字符串不进请求）', () => {
    const msg = history(card({ platform: 'bilibili', frames: ['not-an-image', frames(1)[0]] }));
    const images = (msg.content as any[]).filter(p => p.type === 'image_url');
    expect(images).toHaveLength(1);
  });

  it('回归：普通网页卡仍是纯文本（无 image_url）', () => {
    const plain: Message = {
      ...card({ platform: 'other' }),
      metadata: { webpage: { title: '某文章', siteName: 'blog.com', content: '正文内容若干' } },
    } as Message;
    const msg = history(plain);
    expect(typeof msg.content).toBe('string');
    expect(msg.content).toContain('正文内容若干');
    expect(JSON.stringify(msg)).not.toContain('image_url');
  });
});
