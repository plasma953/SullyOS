import { describe, expect, it, vi } from 'vitest';
import { DB } from './db';
import { runImageGenReply } from './imageGenFlow';

type MockResp = { ok: boolean; status: number; body: any };

const jsonResp = (status: number, body: any): MockResp => ({ ok: status >= 200 && status < 300, status, body });

function makeFetch(script: MockResp[]) {
    let i = 0;
    return vi.fn(async (_url: string, _init?: any) => {
        const resp = script[Math.min(i++, script.length - 1)];
        return {
            ok: resp.ok,
            status: resp.status,
            json: async () => resp.body,
            blob: async () => new Blob(['fake-png-bytes'], { type: 'image/png' }),
            headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? 'image/png' : null) },
        };
    });
}

const GEN_SCRIPT: MockResp[] = [
    jsonResp(200, { workersOnline: 2, queued: 0 }),
    jsonResp(202, { id: 'job-1', status: 'queued' }),
    jsonResp(200, { id: 'job-1', status: 'succeeded', artworkId: 'art-9', seed: 7 }),
    jsonResp(200, {}),
];

const makeDeps = (overrides: any = {}) => ({
    apiConfig: {
        baseUrl: 'https://llm.test', apiKey: 'k', model: 'm',
        latentImageKey: 'lat_sk_test', imageGenEnabled: true,
    },
    char: { id: 'c-flow', name: '阿画', imageGenProfile: 'cat girl, silver hair' },
    userProfile: { name: '我' },
    characters: [{ id: 'c-flow', name: '阿画', imageGenProfile: 'cat girl, silver hair' }],
    contextMsgs: [],
    hooks: { addToast: vi.fn() },
    saveCharProfile: vi.fn(),
    ...overrides,
});

describe('runImageGenReply 落库链路', () => {
    it('生成成功 → image 消息落库（含档案替换后的 prompt）+ 进相册', async () => {
        const deps = makeDeps({ fetchImpl: makeFetch(GEN_SCRIPT) });
        await runImageGenReply(
            { prompt: '@阿画 sitting under moonlight', resolution: 'portrait' },
            deps as any,
        );

        const msgs = await DB.getRecentMessagesByCharId('c-flow', 50);
        const img = msgs.find(m => m.type === 'image');
        expect(img).toBeTruthy();
        expect(img!.content.startsWith('blobref:')).toBe(true);
        expect(img!.metadata?.imageGen?.prompt).toContain('cat girl, silver hair');
        expect(img!.metadata?.imageGen?.prompt).not.toContain('@阿画');
        expect(img!.metadata?.imageGen?.artworkId).toBe('art-9');

        const gallery = await DB.getGalleryImages('c-flow');
        expect(gallery.some(g => g.url === img!.content)).toBe(true);

        expect(deps.hooks.addToast).not.toHaveBeenCalledWith(expect.stringContaining('失败'), 'error');
    });

    it('缺 key → toast 提示，不落库', async () => {
        const deps = makeDeps({
            char: { id: 'c-nokey', name: '没钥匙', imageGenProfile: 'cat' },
            characters: [{ id: 'c-nokey', name: '没钥匙', imageGenProfile: 'cat' }],
            apiConfig: { baseUrl: 'https://llm.test', apiKey: 'k', model: 'm', latentImageKey: '', imageGenEnabled: true },
            fetchImpl: makeFetch(GEN_SCRIPT),
        });
        await runImageGenReply({ prompt: 'cat', resolution: 'portrait' }, deps as any);
        expect(deps.hooks.addToast).toHaveBeenCalledWith(expect.stringContaining('Key'), 'error');
        const msgs = await DB.getRecentMessagesByCharId('c-nokey', 50);
        expect(msgs.filter(m => m.type === 'image')).toHaveLength(0);
    });

    it('生成失败 → toast 错误，不落库', async () => {
        const deps = makeDeps({
            fetchImpl: makeFetch([
                jsonResp(200, { workersOnline: 1, queued: 0 }),
                jsonResp(429, { error: 'quota_exhausted' }),
            ]),
        });
        await runImageGenReply({ prompt: 'cat', resolution: 'portrait' }, deps as any);
        expect(deps.hooks.addToast).toHaveBeenCalledWith(expect.stringContaining('额度'), 'error');
    });
});

describe('runImageGenReply 外貌档案自动提取', () => {
    it('无档案时调一次 LLM 提取 → 存档 → 本次即用', async () => {
        const char: any = { id: 'c-new', name: '新人', systemPrompt: '银发猫耳少女，绿眼睛' };
        const seen: string[] = [];
        const fetchImpl = vi.fn(async (url: string, init?: any) => {
            seen.push(String(url));
            if (String(url).includes('/chat/completions')) {
                return {
                    ok: true, status: 200,
                    json: async () => ({ choices: [{ message: { content: 'cat girl, silver hair, green eyes' } }] }),
                    blob: async () => new Blob([]),
                    headers: { get: () => null },
                };
            }
            const script = GEN_SCRIPT;
            const idx = Math.min(seen.filter(u => !u.includes('/chat/completions')).length - 1, script.length - 1);
            const resp = script[idx];
            return {
                ok: resp.ok, status: resp.status,
                json: async () => resp.body,
                blob: async () => new Blob(['x'], { type: 'image/png' }),
                headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? 'image/png' : null) },
            };
        });
        const deps = makeDeps({
            char,
            characters: [char],
            fetchImpl,
        });
        await runImageGenReply({ prompt: '@新人 smiling', resolution: 'portrait' }, deps as any);

        expect(deps.saveCharProfile).toHaveBeenCalledWith('c-new', 'cat girl, silver hair, green eyes');
        const msgs = await DB.getRecentMessagesByCharId('c-new', 50);
        const img = msgs.find(m => m.type === 'image');
        expect(img?.metadata?.imageGen?.prompt).toContain('silver hair');
    });
});
