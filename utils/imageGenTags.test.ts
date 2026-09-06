import { describe, expect, it } from 'vitest';
import { extractGenImageTags, resolveAppearanceRefs, stripGenImageTags } from './imageGenTags';

describe('extractGenImageTags', () => {
    it('parses a basic tag with explicit resolution', () => {
        const reqs = extractGenImageTags('今晚的月色真美\n[[GEN_IMAGE: 1girl, silver hair, moonlight | landscape]]');
        expect(reqs).toHaveLength(1);
        expect(reqs[0].prompt).toBe('1girl, silver hair, moonlight');
        expect(reqs[0].resolution).toBe('landscape');
    });

    it('defaults to portrait when no resolution suffix', () => {
        const reqs = extractGenImageTags('[[GEN_IMAGE: 1girl, smile]]');
        expect(reqs).toHaveLength(1);
        expect(reqs[0].prompt).toBe('1girl, smile');
        expect(reqs[0].resolution).toBe('portrait');
    });

    it('accepts Chinese resolution words', () => {
        expect(extractGenImageTags('[[GEN_IMAGE: cat | 横]]')[0].resolution).toBe('landscape');
        expect(extractGenImageTags('[[GEN_IMAGE: cat | 竖]]')[0].resolution).toBe('portrait');
        expect(extractGenImageTags('[[GEN_IMAGE: cat | 方]]')[0].resolution).toBe('square');
    });

    it('treats unknown trailing segment as part of the prompt, not resolution', () => {
        const reqs = extractGenImageTags('[[GEN_IMAGE: 1girl | sunset]]');
        expect(reqs).toHaveLength(1);
        expect(reqs[0].prompt).toBe('1girl | sunset');
        expect(reqs[0].resolution).toBe('portrait');
    });

    it('ignores empty prompts', () => {
        expect(extractGenImageTags('[[GEN_IMAGE:   ]]')).toHaveLength(0);
        expect(extractGenImageTags('[[GEN_IMAGE: | portrait]]')).toHaveLength(0);
    });

    it('returns empty array when no tag present', () => {
        expect(extractGenImageTags('今晚吃火锅吗')).toHaveLength(0);
    });

    it('collapses inner whitespace and newlines in prompt', () => {
        const reqs = extractGenImageTags('[[GEN_IMAGE: 1girl,\n  silver   hair]]');
        expect(reqs[0].prompt).toBe('1girl, silver hair');
    });
});

describe('stripGenImageTags', () => {
    it('removes the tag but keeps surrounding text', () => {
        const out = stripGenImageTags('第一句\n[[GEN_IMAGE: 1girl | portrait]]\n第二句');
        expect(out).not.toContain('GEN_IMAGE');
        expect(out).toContain('第一句');
        expect(out).toContain('第二句');
    });

    it('leaves text without tags untouched', () => {
        expect(stripGenImageTags('纯文本')).toBe('纯文本');
    });
});

describe('resolveAppearanceRefs', () => {
    const profiles = [
        { names: ['Sully', '小苏'], tags: 'cat girl, silver hair, green eyes' },
        { names: ['阿白'], tags: 'white fox ears, red eyes' },
    ];

    it('replaces @name with the archived appearance tags', () => {
        const out = resolveAppearanceRefs('@Sully sitting under moonlight', profiles);
        expect(out).toBe('cat girl, silver hair, green eyes sitting under moonlight');
    });

    it('matches nicknames too', () => {
        const out = resolveAppearanceRefs('@小苏 和 @阿白 在喝茶', profiles);
        expect(out).toContain('cat girl, silver hair, green eyes');
        expect(out).toContain('white fox ears, red eyes');
    });

    it('leaves unknown @refs untouched', () => {
        expect(resolveAppearanceRefs('@路人甲 走过', profiles)).toBe('@路人甲 走过');
    });

    it('prefers the longest matching name to avoid prefix shadowing', () => {
        const ps = [
            { names: ['小白'], tags: 'SHORT' },
            { names: ['小白脸'], tags: 'LONG' },
        ];
        expect(resolveAppearanceRefs('@小白脸 笑了', ps)).toBe('LONG 笑了');
    });
});
