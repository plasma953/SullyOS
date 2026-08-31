/**
 * mcpResultMemory.test — MCP 调用记忆分级清空测试。
 *
 * 覆盖：clearMcpResults 三档 scope（recent / manual / all）、
 * 与 keepTurns 滚动窗口的兼容、跨角色隔离。
 */
import { describe, it, expect } from 'vitest';
import {
    recordMcpResult,
    getMcpResultList,
    clearMcpResults,
    inferPersistent,
} from './mcpResultMemory';

let seq = 0;
const record = (
    charId: string,
    turnId: number,
    opts?: { manual?: boolean; serverName?: string; toolName?: string },
): void => {
    seq += 1;
    recordMcpResult({
        charId,
        server: {
            id: `srv-${seq}`,
            name: opts?.serverName ?? '测试服务',
            persistMode: opts?.manual ? 'always' : 'auto',
        },
        toolName: opts?.toolName ?? 'search',
        args: { q: `query-${seq}` },
        result: { success: true, data: `结果内容-${seq}` },
        turnId,
        keepTurns: 2,
    });
};

describe('inferPersistent', () => {
    it('always 模式强制长期；auto 按关键词；never 强制短期', () => {
        expect(inferPersistent('文档服务', 'read_page', 'always')).toBe(true);
        expect(inferPersistent('普通服务', 'search', 'auto')).toBe(false);
        expect(inferPersistent('普通服务', '使用手册查询', 'auto')).toBe(true);
        expect(inferPersistent('文档服务', 'read_page', 'never')).toBe(false);
    });
});

describe('clearMcpResults 三档', () => {
    it("scope='recent' 只清短期窗口，手册类长期条目保留", () => {
        const ch = `char-recent-${seq}`;
        record(ch, 1);
        record(ch, 2);
        record(ch, 2, { manual: true });
        expect(getMcpResultList(ch)).toHaveLength(3);

        clearMcpResults(ch, 'recent');
        const rest = getMcpResultList(ch);
        expect(rest).toHaveLength(1);
        expect(rest[0].persistent).toBe(true);
    });

    it("scope='manual' 只清手册类，短期窗口条目保留", () => {
        const ch = `char-manual-${seq}`;
        record(ch, 1);
        record(ch, 2, { manual: true });
        record(ch, 2, { manual: true });

        clearMcpResults(ch, 'manual');
        const rest = getMcpResultList(ch);
        expect(rest).toHaveLength(1);
        expect(rest[0].persistent).toBe(false);
    });

    it("scope='all' 清空该角色全部记录，其他角色不受影响", () => {
        const chA = `char-all-a-${seq}`;
        const chB = `char-all-b-${seq}`;
        record(chA, 1);
        record(chA, 1, { manual: true });
        record(chB, 1);

        clearMcpResults(chA, 'all');
        expect(getMcpResultList(chA)).toHaveLength(0);
        expect(getMcpResultList(chB)).toHaveLength(1);
    });

    it('与 keepTurns 滚动窗口兼容：窗口淘汰不受清空档位破坏', () => {
        const ch = `char-window-${seq}`;
        // turn1 短期 → 在 turn3 时已滑出 keepTurns=2 的窗口
        record(ch, 1);
        record(ch, 2);
        record(ch, 3);
        record(ch, 3, { manual: true });

        // 滚动窗口：短期只留 turn2/turn3，手册类不受窗口影响
        const before = getMcpResultList(ch);
        expect(before.filter(e => !e.persistent)).toHaveLength(2);
        expect(before.filter(e => e.persistent)).toHaveLength(1);

        // 清短期后：只剩手册类；再清长期 → 空
        clearMcpResults(ch, 'recent');
        expect(getMcpResultList(ch).filter(e => e.persistent)).toHaveLength(1);
        clearMcpResults(ch, 'manual');
        expect(getMcpResultList(ch)).toHaveLength(0);
    });

    it('空记录角色清空不抛错（幂等）', () => {
        const ch = `char-empty-${seq}`;
        expect(() => clearMcpResults(ch, 'recent')).not.toThrow();
        expect(() => clearMcpResults(ch, 'manual')).not.toThrow();
        expect(() => clearMcpResults(ch, 'all')).not.toThrow();
    });
});
