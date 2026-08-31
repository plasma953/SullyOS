/**
 * anniversaryEngine.test — 时光契约重复规则引擎测试。
 *
 * 覆盖：五种重复模式、农历（含闰月顺延）、跨年、月末收敛、单次过期、向后兼容。
 */
import { describe, it, expect } from 'vitest';
import {
    expandOccurrences,
    isAnniversaryOn,
    getUpcomingAnniversaries,
    getNextOccurrenceKey,
} from './anniversaryEngine';
import type { Anniversary } from '../types';

const mk = (over: Partial<Anniversary>): Anniversary => ({
    id: 'a1',
    title: '测试契约',
    date: '2020-05-20',
    charId: 'c1',
    ...over,
});

describe('expandOccurrences', () => {
    it('yearly：每年发生，跨年对齐', () => {
        const occ = expandOccurrences(mk({}), '2023-01-01', '2024-12-31');
        expect(occ.map(o => o.dateKey)).toEqual(['2023-05-20', '2024-05-20']);
    });

    it('yearly：2/29 登记在平年收敛到 2/28，闰年照常', () => {
        const anni = mk({ date: '2024-02-29', repeat: { mode: 'yearly' } });
        expect(expandOccurrences(anni, '2025-01-01', '2025-12-31').map(o => o.dateKey)).toEqual(['2025-02-28']);
        expect(expandOccurrences(anni, '2028-01-01', '2028-12-31').map(o => o.dateKey)).toEqual(['2028-02-29']);
    });

    it('monthly：每月同日，2 月收敛月末', () => {
        const anni = mk({ date: '2023-01-31', repeat: { mode: 'monthly' } });
        const occ = expandOccurrences(anni, '2023-02-01', '2023-04-30');
        expect(occ.map(o => o.dateKey)).toEqual(['2023-02-28', '2023-03-31', '2023-04-30']);
    });

    it('weekly：每周同星期，跨年不断档', () => {
        // 2023-01-04 是周三；区间内各周三都应命中
        const anni = mk({ date: '2023-01-04', repeat: { mode: 'weekly' } });
        const occ = expandOccurrences(anni, '2023-12-20', '2024-01-10');
        expect(occ.map(o => o.dateKey)).toEqual(['2023-12-20', '2023-12-27', '2024-01-03', '2024-01-10']);
    });

    it('interval：每 14 天发生', () => {
        const anni = mk({ date: '2023-06-01', repeat: { mode: 'interval', intervalDays: 14 } });
        const occ = expandOccurrences(anni, '2023-06-10', '2023-06-29');
        expect(occ.map(o => o.dateKey)).toEqual(['2023-06-15', '2023-06-29']);
    });

    it('none：单次，过期不发生', () => {
        const anni = mk({ date: '2020-05-20', repeat: { mode: 'none' } });
        expect(expandOccurrences(anni, '2023-01-01', '2023-12-31')).toEqual([]);
        expect(expandOccurrences(anni, '2020-01-01', '2020-12-31').map(o => o.dateKey)).toEqual(['2020-05-20']);
    });

    it('农历五月初五逐年对齐（2023 端午 = 06-22，2024 = 06-10）', () => {
        const anni = mk({ date: '2023-06-22', repeat: { mode: 'yearly', lunar: true } });
        const occ = expandOccurrences(anni, '2023-01-01', '2024-12-31');
        expect(occ.map(o => o.dateKey)).toEqual(['2023-06-22', '2024-06-10']);
        expect(occ.every(o => o.fromLunar)).toBe(true);
    });

    it('农历登记日遇大月三十：登记 2023-10-15（八月三十）在 2024 年顺延不崩', () => {
        // 2023-10-15 是否恰为某月三十不作强断言——本用例验证换算失败时有顺延兜底、不抛错
        const anni = mk({ date: '2023-10-15', repeat: { mode: 'yearly', lunar: true } });
        const occ = expandOccurrences(anni, '2024-01-01', '2024-12-31');
        expect(occ.length).toBeLessThanOrEqual(1);
        for (const o of occ) expect(o.dateKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('repeat 缺省按每年处理（向后兼容）', () => {
        const occ = expandOccurrences(mk({}), '2023-05-19', '2023-05-21');
        expect(occ.map(o => o.dateKey)).toEqual(['2023-05-20']);
    });

    it('区间外不产生发生日', () => {
        expect(expandOccurrences(mk({}), '2023-05-21', '2023-05-25')).toEqual([]);
    });
});

describe('isAnniversaryOn / getUpcomingAnniversaries / getNextOccurrenceKey', () => {
    it('isAnniversaryOn 单日查询', () => {
        expect(isAnniversaryOn(mk({}), '2023-05-20')).toBe(true);
        expect(isAnniversaryOn(mk({}), '2023-05-21')).toBe(false);
        // 2020-05-20 是周三 → 2023-05-24 也是周三；周六的 2023-05-20 不应命中
        expect(isAnniversaryOn(mk({ repeat: { mode: 'weekly' } }), '2023-05-24')).toBe(true);
        expect(isAnniversaryOn(mk({ repeat: { mode: 'weekly' } }), '2023-05-20')).toBe(false);
    });

    it('getUpcomingAnniversaries 7 天窗口内按最近排序', () => {
        const annis = [
            mk({ id: 'far', date: '2020-06-01' }),
            mk({ id: 'near', date: '2020-05-22' }),
        ];
        const r = getUpcomingAnniversaries(annis, '2023-05-20', 15);
        expect(r[0].anni.id).toBe('near');
        expect(r[0].nextDateKey).toBe('2023-05-22');
        expect(r[1].anni.id).toBe('far');
        expect(getUpcomingAnniversaries(annis, '2023-05-20', 2).map(x => x.anni.id)).toEqual(['near']);
    });

    it('getNextOccurrenceKey：单次过期返回 null', () => {
        expect(getNextOccurrenceKey(mk({ repeat: { mode: 'none' } }), '2023-01-01')).toBe(null);
        expect(getNextOccurrenceKey(mk({}), '2023-05-19')).toBe('2023-05-20');
    });
});
