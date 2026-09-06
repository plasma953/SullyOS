import { describe, expect, it } from 'vitest';
import { editDistance, matchPlace, normalizePlaceText } from './geoMatch';

const lib = [
    { name: '滨江公园' },
    { name: '世纪公园' },
    { name: '陆家嘴中心' },
    { name: '老街咖啡' },
];

describe('normalizePlaceText', () => {
    it('去空白标点、统一小写、去尾部市字', () => {
        expect(normalizePlaceText(' 滨江公园，')).toBe('滨江公园');
        expect(normalizePlaceText('南京市')).toBe('南京');
        expect(normalizePlaceText('StarBucks!')).toBe('starbucks');
        expect(normalizePlaceText(undefined)).toBe('');
    });
});

describe('editDistance', () => {
    it('经典用例', () => {
        expect(editDistance('kitten', 'sitting')).toBe(3);
        expect(editDistance('', 'abc')).toBe(3);
        expect(editDistance('公园', '公园')).toBe(0);
        expect(editDistance('滨江公园', '滨江公圆')).toBe(1);
    });
});

describe('matchPlace', () => {
    it('全等优先', () => {
        expect(matchPlace('滨江公园', lib)).toEqual({ place: { name: '滨江公园' }, level: 'exact' });
    });
    it('包含匹配取最长的（避免"公园"吞掉具体公园）', () => {
        const r = matchPlace('去滨江公园散步', lib);
        expect(r?.place.name).toBe('滨江公园');
        expect(r?.level).toBe('contains');
    });
    it('短查询不做包含匹配', () => {
        expect(matchPlace('公园', lib)).toBeNull();
    });
    it('一字之差走 fuzzy', () => {
        const r = matchPlace('滨江公圆', lib);
        expect(r?.place.name).toBe('滨江公园');
        expect(r?.level).toBe('fuzzy');
    });
    it('差太多返回 null', () => {
        expect(matchPlace('埃菲尔铁塔', lib)).toBeNull();
        expect(matchPlace('', lib)).toBeNull();
        expect(matchPlace('滨江公园', [])).toBeNull();
    });
});
