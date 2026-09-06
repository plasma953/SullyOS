import { describe, expect, it } from 'vitest';
import { ChatPrompts } from './chatPrompts';

// 锁住「角色自己生成的图，下一轮要在历史里记得画过什么」。
//
// 链路: 生图完成后落库 type:'image' + metadata.imageGen.prompt。
// buildMessageHistory 以前把所有图片都走 image_url（用户发的图）或 [图片] 占位；
// 自己生成的图不需要再回传一遍图片字节（省 token），但模型要知道"画过什么"。
// 修复后：带 imageGen.prompt 的 assistant 图片消息渲染成纯文本摘要。

const char = { id: 'c1', name: '小画家' } as any;
const userProfile = { name: '我' } as any;
const t0 = Date.now() - 60_000;

const PROMPT = '1girl, silver hair, green eyes, moonlight';

const makeHistory = () => ([
    { id: 1, charId: 'c1', role: 'user', type: 'text', content: '画一张月夜下的你', timestamp: t0 },
    {
        id: 2, charId: 'c1', role: 'assistant', type: 'text', content: '好呀，画好了', timestamp: t0 + 1000,
    },
    {
        id: 3, charId: 'c1', role: 'assistant', type: 'image', content: 'blobref:b_fake',
        timestamp: t0 + 2000,
        metadata: { imageGen: { prompt: PROMPT, resolution: 'portrait', seed: 7, artworkId: 'art-1' } },
    },
] as any[]);

describe('buildMessageHistory 生图回填', () => {
    it('自己生成的图渲染成纯文本摘要，不走 image_url', () => {
        const { apiMessages } = ChatPrompts.buildMessageHistory(makeHistory(), 10, char, userProfile, []);
        const imgMsg = apiMessages.find((m: any) => m.role === 'assistant' && typeof m.content === 'string' && (m.content as string).includes('silver hair'));
        expect(imgMsg).toBeTruthy();
        expect(typeof imgMsg!.content).toBe('string');
    });

    it('摘要里带「自己画的」语义，模型知道是它发的', () => {
        const { apiMessages } = ChatPrompts.buildMessageHistory(makeHistory(), 10, char, userProfile, []);
        const imgMsg = apiMessages.find((m: any) => m.role === 'assistant' && typeof m.content === 'string' && (m.content as string).includes('silver hair'));
        expect(imgMsg!.content as string).toMatch(/你.{0,6}画/);
    });

    it('没 prompt 的旧图片消息行为不变（仍走 image_url 或占位）', () => {
        const history = ([
            {
                id: 9, charId: 'c1', role: 'user', type: 'image', content: 'blobref:b_old',
                timestamp: t0,
            },
        ] as any[]);
        const { apiMessages } = ChatPrompts.buildMessageHistory(history, 10, char, userProfile, []);
        const msg = apiMessages.find((m: any) => m.role === 'user');
        expect(msg).toBeTruthy();
        // 有令牌 → 结构化 image_url（既有行为）；绝不能变成纯文本把图弄丢
        expect(Array.isArray((msg as any).content)).toBe(true);
    });
});
