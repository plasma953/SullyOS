import { describe, expect, it, vi } from 'vitest';

vi.mock('./imageGenFlow', () => ({
    runImageGenReply: vi.fn(async () => {}),
}));

import { applyAssistantPostProcessing, PostProcessCtx, XhsCaches } from './applyAssistantPostProcessing';
import { runImageGenReply } from './imageGenFlow';
import { DB } from './db';

// 锁住 Step 5b「AI 生图标签」：
// - 标签必须从落库文字里剥干净（展示 / 历史 / 二轮都不该看到它）；
// - 开关开 + 有运行时 → 取第一个标签跑后台生图；
// - 开关关 / 没运行时 → 只剥离、不执行（不烧额度）。

const mockedRun = vi.mocked(runImageGenReply);

const makeCtx = (charId: string, imageGen?: PostProcessCtx['imageGen']): PostProcessCtx => {
    const xhsCaches: XhsCaches = {
        xsecTokenCache: new Map(),
        noteTitleCache: new Map(),
        commentUserIdCache: new Map(),
        commentAuthorNameCache: new Map(),
        commentParentIdCache: new Map(),
    };
    return {
        char: { id: charId, name: '测试角色' } as any,
        userProfile: { name: '我' } as any,
        emojis: [],
        contextMsgs: [],
        fullMessages: [],
        initialData: {},
        historyMsgCount: 0,
        xhsCaches,
        api: {
            baseUrl: 'http://localhost:0',
            headers: {},
            effectiveApi: { baseUrl: 'http://localhost:0', apiKey: '', model: 'test' },
        },
        hooks: {
            setMessages: vi.fn(),
            addToast: vi.fn(),
        },
        ...(imageGen ? { imageGen } : {}),
    };
};

const RUNTIME = (enabled: boolean): PostProcessCtx['imageGen'] => ({
    apiConfig: { baseUrl: 'http://localhost:0', apiKey: 'k', model: 'm', latentImageKey: 'lat_sk_x', imageGenEnabled: enabled } as any,
    characters: [{ id: 'c-x', name: '测试角色' } as any],
    saveCharProfile: vi.fn(),
});

const RAW = '今晚的月色真美\n[[GEN_IMAGE: 1girl, silver hair, moonlight | landscape]]\n给你画下来了';

describe('Step 5b AI 生图标签', () => {
    it('开关开：标签剥离 + 取第一个跑后台生图', async () => {
        const charId = `c-img-on-${Date.now()}`;
        mockedRun.mockClear();
        await applyAssistantPostProcessing(RAW, makeCtx(charId, RUNTIME(true)));

        expect(mockedRun).toHaveBeenCalledTimes(1);
        expect(mockedRun.mock.calls[0][0]).toMatchObject({
            prompt: '1girl, silver hair, moonlight',
            resolution: 'landscape',
        });

        const msgs = await DB.getRecentMessagesByCharId(charId, 50);
        const texts = msgs.filter(m => m.role === 'assistant' && m.type === 'text');
        expect(texts.length).toBeGreaterThan(0);
        for (const t of texts) expect(t.content).not.toContain('GEN_IMAGE');
        expect(texts.map(t => t.content).join('\n')).toContain('今晚的月色真美');
    }, 20000);

    it('开关关：只剥离、不执行', async () => {
        const charId = `c-img-off-${Date.now()}`;
        mockedRun.mockClear();
        await applyAssistantPostProcessing(RAW, makeCtx(charId, RUNTIME(false)));

        expect(mockedRun).not.toHaveBeenCalled();
        const msgs = await DB.getRecentMessagesByCharId(charId, 50);
        const texts = msgs.filter(m => m.role === 'assistant' && m.type === 'text');
        for (const t of texts) expect(t.content).not.toContain('GEN_IMAGE');
    }, 20000);

    it('没传运行时（群聊/push 路径）：只剥离、不执行', async () => {
        const charId = `c-img-nort-${Date.now()}`;
        mockedRun.mockClear();
        await applyAssistantPostProcessing(RAW, makeCtx(charId, undefined));

        expect(mockedRun).not.toHaveBeenCalled();
        const msgs = await DB.getRecentMessagesByCharId(charId, 50);
        const texts = msgs.filter(m => m.role === 'assistant' && m.type === 'text');
        for (const t of texts) expect(t.content).not.toContain('GEN_IMAGE');
    }, 20000);
});
