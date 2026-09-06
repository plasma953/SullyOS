import { describe, expect, it, vi } from 'vitest';
import { suggestImageTags } from './imageGenFlow';

const API = { baseUrl: 'https://llm.test', apiKey: 'k', model: 'm' } as any;

describe('suggestImageTags', () => {
    it('调 LLM 把场景写成一行英文 tag', async () => {
        const seen: any[] = [];
        const fetchImpl = vi.fn(async (_url: string, init?: any) => {
            seen.push({ url: String(_url), body: JSON.parse(init.body) });
            return {
                ok: true, status: 200,
                json: async () => ({ choices: [{ message: { content: '1girl, moonlight, lake\n多余的第二行' } }] }),
                blob: async () => new Blob([]),
                headers: { get: () => null },
            };
        });
        const tags = await suggestImageTags('小苏：今晚的月色真美', { id: 'c1', name: '小苏' } as any, API, fetchImpl as any);
        expect(tags).toBe('1girl, moonlight, lake');
        expect(seen[0].url).toContain('/chat/completions');
    });

    it('LLM 没配好时抛中文提示', async () => {
        await expect(suggestImageTags('hi', { id: 'c1', name: 'x' } as any, {} as any))
            .rejects.toThrow('LLM');
    });

    it('LLM 空回时抛错', async () => {
        const fetchImpl = vi.fn(async () => ({
            ok: true, status: 200,
            json: async () => ({ choices: [{ message: { content: '   ' } }] }),
            blob: async () => new Blob([]),
            headers: { get: () => null },
        }));
        await expect(suggestImageTags('hi', { id: 'c1', name: 'x' } as any, API, fetchImpl as any))
            .rejects.toThrow();
    });
});
