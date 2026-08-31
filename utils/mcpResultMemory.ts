/**
 * mcpResultMemory — MCP 调用结果跨轮记忆（浏览器侧，localStorage）。
 *
 * 要解决的问题：工具循环里拿到的结果只在本轮 loopMessages 里存在，循环结束即丢弃，
 * 下一轮角色完全不记得自己调过什么 → 相同需求重复调用。
 *
 * 方案：
 * 1. 每次真实工具调用成功/失败都按「轮次」留档；最近 N 轮（用户在设置里可调）的
 *    结果随 system prompt 注入，角色下一轮直接复用，不再重复调用。
 * 2. 「操作手册类」工具（名称关键词自动判定 + 设置里每个服务器可手动覆盖三态
 *    auto/always/never）的结果长期保存，直到用户在聊天界面「MCP 记忆」弹窗主动清空。
 *
 * 存储形态：单 key 数组，条目带 charId 按角色隔离。所有读写 try/catch 容错，
 * 存不下/读不出时静默降级（只是少了跨轮记忆，不影响聊天主链路）。
 * worker 不引用本模块（工具结果的上云不在本期范围）。
 */

// ========== 类型与常量 ==========

export interface McpResultEntry {
    id: string;
    charId: string;
    serverId: string;
    serverName: string;
    toolName: string;
    /** 参数摘要（JSON 截断），防重复调用时判断「参数相同或相近」用 */
    argsSummary: string;
    /** 结果摘要（普通工具，短） */
    resultSummary: string;
    /** 原文截断（仅手册类长期保存条目） */
    resultRaw?: string;
    /** 手册类长期保存（用户手动清空前一直有效） */
    persistent: boolean;
    /** 调用发生时的轮次（一次 triggerAI 完整回复 = 1 轮） */
    turnId: number;
    createdAt: number;
}

const MCP_RESULT_KEY = 'aetheros.mcp.resultMemory';
const MCP_TURN_KEY = 'aetheros.mcp.turnCounter';

/** 普通结果摘要上限 */
const RESULT_SUMMARY_MAX = 200;
/** 手册类原文截断上限 */
const MANUAL_RAW_MAX = 1500;
/** 参数摘要上限 */
const ARGS_SUMMARY_MAX = 120;
/** 手册类条目上限（超出删最旧） */
const MANUAL_MAX_ENTRIES = 50;
/** 单个角色总条目上限（超出先删最旧非 persistent，再删最旧） */
const TOTAL_MAX_ENTRIES = 80;

/** 「操作手册类」自动判定关键词（工具名 / 服务器名，大小写不敏感） */
const MANUAL_KEYWORDS = [
    '手册', '指南', '教程', '说明', '文档', '帮助',
    'readme', 'guide', 'manual', 'handbook', 'help', 'faq', 'tutorial', 'doc', 'docs',
];

// ========== localStorage 读写 ==========

const readAllEntries = (): McpResultEntry[] => {
    try {
        const raw = localStorage.getItem(MCP_RESULT_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
};

const writeAllEntries = (entries: McpResultEntry[]): void => {
    try { localStorage.setItem(MCP_RESULT_KEY, JSON.stringify(entries)); } catch { /* ignore */ }
};

const readTurnCounter = (): Record<string, number> => {
    try {
        const raw = localStorage.getItem(MCP_TURN_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch { return {}; }
};

const writeTurnCounter = (counter: Record<string, number>): void => {
    try { localStorage.setItem(MCP_TURN_KEY, JSON.stringify(counter)); } catch { /* ignore */ }
};

// ========== 轮次 ==========

/** 当前角色已进行到第几轮（0 = 还没有过完整回复轮） */
export const getMcpTurn = (charId: string): number =>
    readTurnCounter()[charId] ?? 0;

/**
 * 新一轮开始（每次 triggerAI 生成前调用一次）。一次用户消息触发的完整
 * AI 回复（含全部工具循环）计 1 轮。返回本轮轮次号。
 */
export const bumpMcpTurn = (charId: string): number => {
    const counter = readTurnCounter();
    const next = (counter[charId] ?? 0) + 1;
    counter[charId] = next;
    writeTurnCounter(counter);
    return next;
};

// ========== 持久判定 ==========

/**
 * 操作手册类判定：手动覆盖（always/never）优先，其次关键词自动判定。
 * 关键词只看工具名和服务器名，不猜内容——名字带「手册/指南/帮助/文档」之类
 * 的工具体量大、变化慢，适合长期留档；其余工具默认走「最近 N 轮」窗口。
 */
export const inferPersistent = (
    serverName: string,
    toolName: string,
    override?: 'auto' | 'always' | 'never',
): boolean => {
    if (override === 'always') return true;
    if (override === 'never') return false;
    const haystack = `${serverName} ${toolName}`.toLowerCase();
    return MANUAL_KEYWORDS.some(k => haystack.includes(k));
};

// ========== 文本化 ==========

const toText = (data: any): string => {
    if (data == null) return '';
    if (typeof data === 'string') return data;
    try { return JSON.stringify(data); } catch { return String(data); }
};

/** 参数摘要 */
const summarizeArgs = (args: Record<string, any>): string =>
    toText(args).slice(0, ARGS_SUMMARY_MAX);

/** 结果摘要（普通工具） */
const summarizeResult = (result: { success: boolean; data?: any; error?: string }): string => {
    const text = result.success ? toText(result.data) : `失败: ${result.error || '未知错误'}`;
    const oneLine = text.replace(/\s+/g, ' ').trim();
    return oneLine.length > RESULT_SUMMARY_MAX
        ? `${oneLine.slice(0, RESULT_SUMMARY_MAX)}…[截断]`
        : oneLine;
};

/** 手册类原文（截断） */
const rawOf = (result: { success: boolean; data?: any; error?: string }): string => {
    const text = result.success ? toText(result.data) : `失败: ${result.error || '未知错误'}`;
    return text.length > MANUAL_RAW_MAX
        ? `${text.slice(0, MANUAL_RAW_MAX)}…[原文过长已截断]`
        : text;
};

// ========== 记录与清理 ==========

export interface RecordMcpResultInput {
    charId: string;
    server: { id: string; name: string; persistMode?: 'auto' | 'always' | 'never' };
    toolName: string;
    args: Record<string, any>;
    result: { success: boolean; data?: any; error?: string };
    /** 本轮轮次号（triggerAI 开始时 bumpMcpTurn 的返回值） */
    turnId: number;
    /** 保留轮次（设置值，0 = 只留手册类） */
    keepTurns: number;
}

/** 记录一次工具调用结果，并顺手清理过期条目 + 执行容量上限。 */
export const recordMcpResult = (input: RecordMcpResultInput): void => {
    const { charId, server, toolName, args, result, turnId, keepTurns } = input;
    const persistent = inferPersistent(server.name, toolName, server.persistMode);
    const entry: McpResultEntry = {
        id: `mcp_r_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        charId,
        serverId: server.id,
        serverName: server.name,
        toolName,
        argsSummary: summarizeArgs(args),
        resultSummary: summarizeResult(result),
        ...(persistent ? { resultRaw: rawOf(result) } : {}),
        persistent,
        turnId,
        createdAt: Date.now(),
    };
    const all = readAllEntries();
    all.push(entry);
    writeAllEntries(prune(all, charId, turnId, keepTurns));
};

/**
 * 清理：非手册类只保留最近 keepTurns 轮；手册类按容量上限删最旧；
 * 总容量上限兜底（先删最旧非手册类，再删最旧）。
 */
const prune = (
    all: McpResultEntry[],
    charId: string,
    currentTurn: number,
    keepTurns: number,
): McpResultEntry[] => {
    const others = all.filter(e => e.charId !== charId);
    let mine = all.filter(e => e.charId === charId);

    // 1. 非手册类按轮次窗口淘汰
    const floor = currentTurn - Math.max(0, keepTurns) + 1;
    mine = mine.filter(e => e.persistent || e.turnId >= floor);

    // 2. 手册类上限
    const manual = mine.filter(e => e.persistent).sort((a, b) => b.createdAt - a.createdAt);
    const recent = mine.filter(e => !e.persistent).sort((a, b) => b.createdAt - a.createdAt);
    const keptManual = manual.slice(0, MANUAL_MAX_ENTRIES);

    // 3. 总量上限
    const keptRecent = recent.slice(0, Math.max(0, TOTAL_MAX_ENTRIES - keptManual.length));

    return [...others, ...keptManual, ...keptRecent];
};

// ========== 读取 / 注入 / 清空 ==========

export const getMcpResultList = (charId: string): McpResultEntry[] =>
    readAllEntries()
        .filter(e => e.charId === charId)
        .sort((a, b) => b.createdAt - a.createdAt);

/**
 * 生成注入 system prompt 的「工具调用记忆块」。空记录返回空串。
 * 结构分两段：近期窗口（摘要）+ 长期手册（原文），并附防重复调用纪律。
 */
export const getMcpResultMemoryBlock = (charId: string, keepTurns: number): string => {
    const currentTurn = getMcpTurn(charId);
    const entries = getMcpResultList(charId);
    if (!entries.length) return '';

    const floor = currentTurn - Math.max(0, keepTurns) + 1;
    const recent = entries.filter(e => !e.persistent && e.turnId >= floor);
    const manual = entries.filter(e => e.persistent);

    if (!recent.length && !manual.length) return '';

    const lines: string[] = [];
    if (recent.length) {
        lines.push('[工具调用记忆 —— 最近几轮你调用过这些工具并已拿到结果。参数相同或相近的需求直接复用已有结果，不要重复调用]');
        for (const e of recent) {
            lines.push(`- (第${e.turnId}轮) ${e.serverName}·${e.toolName} · 参数: ${e.argsSummary} → 结果: ${e.resultSummary}`);
        }
    }
    if (manual.length) {
        lines.push('[长期工具手册 —— 以下结果长期保留（用户手动清空前一直有效）。需要时直接引用，不要重复调用]');
        for (const e of manual) {
            lines.push(`- ${e.serverName}·${e.toolName} · 参数: ${e.argsSummary} → 结果: ${e.resultRaw || e.resultSummary}`);
        }
    }
    return `\n---\n${lines.join('\n')}\n---\n`;
};

/**
 * 清空 MCP 调用记忆（分级）。
 * scope='recent'：只清近期窗口（非 persistent）条目，手册类长期结果不动；
 * scope='manual'：只清手册类长期结果（近期窗口条目继续自动滚动）；
 * scope='all'：清空该角色全部记录（短期 + 长期）。
 */
export const clearMcpResults = (charId: string, scope: 'recent' | 'manual' | 'all'): void => {
    const all = readAllEntries();
    const next = scope === 'all'
        ? all.filter(e => e.charId !== charId)
        : scope === 'recent'
            ? all.filter(e => e.charId !== charId || e.persistent)
            : all.filter(e => e.charId !== charId || !e.persistent);
    writeAllEntries(next);
};
