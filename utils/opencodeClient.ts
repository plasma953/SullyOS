/**
 * 终端 App 的 opencode 协议客户端（`opencode serve` 的 HTTP API）。
 *
 * 只连用户自己的一台电脑：单连接配置存 localStorage（`aetheros.opencode.connection`），
 * 含 Basic Auth 密码——与 MCP token 同口径，备份包里会有它，妥善保管；密码永不进
 * 日志与报错文本。
 *
 * 网络路径（与 MCP 三选一同构，见 docs/opencode-terminal.md）：
 * 1. 直连 —— 同机 / 局域网 / Tailscale（opencode 起 `--cors <手机源>`）
 * 2. 本地代理 —— node scripts/opencode-proxy.mjs
 * 3. 用户自己的 Cloudflare Worker —— worker/opencode-proxy/（+ PROXY_KEY）
 * 代理约定统一为 <代理URL>?target=<url-encoded 目标>。刻意不走中心 sfworker。
 *
 * 说明：测试文件用动态 import() 引用本模块，保证每个用例独立取数；
 * 新增 API 时只往后追加函数，不改已有签名（设置页与终端 App 都在消费）。
 */

import type {
    OpencodeConnection,
    OpencodeFileDiff,
    OpencodeFileNode,
    OpencodeMessageItem,
    OpencodeMessageInfo,
    OpencodePermission,
    OpencodeSessionInfo,
    OpencodeSessionStatus,
} from '../types';

export type {
    OpencodeConnection,
    OpencodeFileDiff,
    OpencodeFileNode,
    OpencodeMessageItem,
    OpencodeMessageInfo,
    OpencodePermission,
    OpencodeSessionInfo,
    OpencodeSessionStatus,
};

const CONNECTION_KEY = 'aetheros.opencode.connection';

/** 默认单次请求超时：编码任务走 prompt_async + 轮询，不靠长连接等。 */
export const OPENCODE_REQUEST_TIMEOUT_MS = 30_000;

// ========== 错误类型（message 里永不带密码） ==========

export class OpencodeAuthError extends Error {
    constructor() {
        super('opencode 鉴权失败（401）：检查设置里的用户名/密码是否与服务端的 OPENCODE_SERVER_PASSWORD 一致');
        this.name = 'OpencodeAuthError';
    }
}

export class OpencodeNetworkError extends Error {
    constructor(reason: 'unreachable' | 'timeout') {
        super(
            reason === 'timeout'
                ? 'opencode 请求超时：电脑关机/休眠、网络中断，或 opencode serve 已退出'
                : 'opencode 连接失败：电脑不可达。直连时确认同网/CORS，代理时确认代理地址与 ?target= 约定',
        );
        this.name = 'OpencodeNetworkError';
    }
}

export class OpencodeApiError extends Error {
    readonly status: number;
    constructor(status: number) {
        super(`opencode 返回 ${status}：请求被拒绝（路径或参数不对，先确认 serve 版本）`);
        this.name = 'OpencodeApiError';
        this.status = status;
    }
}

// ========== 单连接配置（localStorage） ==========

export const loadOpencodeConnection = (): OpencodeConnection | null => {
    try {
        const raw = localStorage.getItem(CONNECTION_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<OpencodeConnection>;
        if (!parsed || typeof parsed !== 'object' || typeof parsed.baseUrl !== 'string') return null;
        return {
            id: typeof parsed.id === 'string' ? parsed.id : 'oc_main',
            name: typeof parsed.name === 'string' ? parsed.name : '我的电脑',
            baseUrl: parsed.baseUrl,
            username: typeof parsed.username === 'string' ? parsed.username : undefined,
            password: typeof parsed.password === 'string' ? parsed.password : undefined,
            proxyUrl: typeof parsed.proxyUrl === 'string' && parsed.proxyUrl ? parsed.proxyUrl : undefined,
            proxyKey: typeof parsed.proxyKey === 'string' && parsed.proxyKey ? parsed.proxyKey : undefined,
            enabled: parsed.enabled !== false,
            updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
        };
    } catch { return null; }
};

export const saveOpencodeConnection = (conn: OpencodeConnection): void => {
    try {
        localStorage.setItem(CONNECTION_KEY, JSON.stringify(conn));
    } catch { /* ignore */ }
};

export const clearOpencodeConnection = (): void => {
    try { localStorage.removeItem(CONNECTION_KEY); } catch { /* ignore */ }
};

export const createOpencodeConnection = (baseUrl: string): OpencodeConnection => ({
    id: `oc_${Date.now().toString(36)}`,
    name: '我的电脑',
    baseUrl,
    username: 'opencode',
    enabled: true,
    updatedAt: Date.now(),
});

// ── 备份用：随「设置 → 导出/导入备份」一起带走（存 localStorage；含密码，备份包妥善保管） ──
export function exportOpencodeLocal(): Record<string, string> | undefined {
    try {
        const raw = localStorage.getItem(CONNECTION_KEY);
        return raw ? { [CONNECTION_KEY]: raw } : undefined;
    } catch { return undefined; }
}
export function importOpencodeLocal(data: Record<string, string> | null | undefined): void {
    if (!data || typeof data !== 'object') return;
    try {
        if (typeof data[CONNECTION_KEY] === 'string') localStorage.setItem(CONNECTION_KEY, data[CONNECTION_KEY]);
    } catch { /* ignore */ }
}

// ========== 鉴权与 URL ==========

/** UTF-8 安全的 base64（浏览器 btoa 只吃 latin1，中文密码要先转字节）。 */
const utf8ToBase64 = (s: string): string => {
    const bytes = new TextEncoder().encode(s);
    let binary = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
};

/** HTTP Basic Auth 头；未配用户名/密码时返回空串（调用方跳过该头）。 */
export const basicAuthHeader = (conn: Pick<OpencodeConnection, 'username' | 'password'>): string => {
    const user = conn.username ?? '';
    const pass = conn.password ?? '';
    if (!user && !pass) return '';
    return `Basic ${utf8ToBase64(`${user}:${pass}`)}`;
};

const trimSlash = (s: string): string => s.replace(/\/+$/, '');

/** 直连拼 baseUrl+path；配了代理则包成 <proxyUrl>?target=<url-encoded>。 */
export const buildOpencodeUrl = (
    conn: Pick<OpencodeConnection, 'baseUrl' | 'proxyUrl'>,
    path: string,
): string => {
    const target = `${trimSlash(conn.baseUrl)}${path.startsWith('/') ? path : `/${path}`}`;
    if (conn.proxyUrl) return `${trimSlash(conn.proxyUrl)}?target=${encodeURIComponent(target)}`;
    return target;
};

// ========== fetch 封装 ==========

/**
 * 带鉴权/代理/超时的底层请求。401 → OpencodeAuthError；fetch 自身失败或超时 →
 * OpencodeNetworkError；其他 4xx/5xx → OpencodeApiError（只带状态码，不带 body，
 * 防止 body 里回显敏感信息）。
 */
export const opencodeFetch = async (
    conn: OpencodeConnection,
    path: string,
    init: RequestInit = {},
    timeoutMs: number = OPENCODE_REQUEST_TIMEOUT_MS,
): Promise<Response> => {
    const controller = new AbortController();
    // 外部 signal（SSE 长连接）与超时二选一：传了外部 signal 就不另设超时。
    const ownSignal = !init.signal;
    const timer = ownSignal && timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
        const headers = new Headers(init.headers);
        if (!headers.has('Accept')) headers.set('Accept', 'application/json');
        const auth = basicAuthHeader(conn);
        if (auth) headers.set('Authorization', auth);
        if (conn.proxyKey) headers.set('X-Proxy-Key', conn.proxyKey);
        const res = await fetch(buildOpencodeUrl(conn, path), {
            ...init,
            headers,
            signal: init.signal ?? controller.signal,
        });
        if (res.status === 401) throw new OpencodeAuthError();
        if (!res.ok) throw new OpencodeApiError(res.status);
        return res;
    } catch (e) {
        if (e instanceof OpencodeAuthError || e instanceof OpencodeApiError) throw e;
        if (e instanceof DOMException && e.name === 'AbortError') {
            // 调用方主动 abort（SSE 断开订阅）原样抛出，由订阅函数翻译；超时则报网络错。
            if (!ownSignal) throw e;
            throw new OpencodeNetworkError('timeout');
        }
        throw new OpencodeNetworkError('unreachable');
    } finally {
        if (timer) clearTimeout(timer);
    }
};

const readJson = async <T>(res: Response): Promise<T> => (await res.json()) as T;

// ========== 测试连接 ==========

/** GET /global/health，通则返回服务端版本。 */
export const testOpencodeConnection = async (conn: OpencodeConnection): Promise<{ version: string }> => {
    const res = await opencodeFetch(conn, '/global/health');
    const body = await readJson<{ healthy?: boolean; version?: string }>(res);
    if (!body || body.healthy !== true) throw new OpencodeApiError(200);
    return { version: typeof body.version === 'string' ? body.version : 'unknown' };
};

// ========== 会话 API ==========

const encId = (id: string): string => encodeURIComponent(id);

/** GET /session：列出全部会话（新在前还是旧在前由服务端定，UI 层按 time.updated 排序）。 */
export const listSessions = async (conn: OpencodeConnection): Promise<OpencodeSessionInfo[]> =>
    readJson<OpencodeSessionInfo[]>(await opencodeFetch(conn, '/session'));

/** POST /session：新建会话（title 可空，服务端会自动生成）。 */
export const createSession = async (conn: OpencodeConnection, title?: string): Promise<OpencodeSessionInfo> =>
    readJson<OpencodeSessionInfo>(
        await opencodeFetch(conn, '/session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(title ? { title } : {}),
        }),
    );

/** GET /session/:id：取单个会话详情。 */
export const getSession = async (conn: OpencodeConnection, sessionID: string): Promise<OpencodeSessionInfo> =>
    readJson<OpencodeSessionInfo>(await opencodeFetch(conn, `/session/${encId(sessionID)}`));

/** PATCH /session/:id：改标题。 */
export const renameSession = async (
    conn: OpencodeConnection,
    sessionID: string,
    title: string,
): Promise<OpencodeSessionInfo> =>
    readJson<OpencodeSessionInfo>(
        await opencodeFetch(conn, `/session/${encId(sessionID)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title }),
        }),
    );

/** DELETE /session/:id：删除会话及其全部数据。 */
export const deleteSession = async (conn: OpencodeConnection, sessionID: string): Promise<boolean> =>
    readJson<boolean>(
        await opencodeFetch(conn, `/session/${encId(sessionID)}`, { method: 'DELETE' }),
    );

/** POST /session/:id/abort：中断正在跑的会话。 */
export const abortSession = async (conn: OpencodeConnection, sessionID: string): Promise<boolean> =>
    readJson<boolean>(await opencodeFetch(conn, `/session/${encId(sessionID)}/abort`, { method: 'POST' }));

/** GET /session/status：全部会话的忙闲表（轮询忙闲就靠它，不用逐个问）。 */
export const getSessionStatus = async (
    conn: OpencodeConnection,
): Promise<Record<string, { type: OpencodeSessionStatus }>> =>
    readJson(await opencodeFetch(conn, '/session/status'));

/** GET /session/:id/diff：本会话的文件改动（只读展示用）。 */
export const getSessionDiff = async (
    conn: OpencodeConnection,
    sessionID: string,
): Promise<OpencodeFileDiff[]> =>
    readJson<OpencodeFileDiff[]>(await opencodeFetch(conn, `/session/${encId(sessionID)}/diff`));

export type OpencodePermissionResponse = 'once' | 'always' | 'reject';

/**
 * POST /session/:id/permissions/:permissionID：审批待确认操作。
 * once 本次允许 / always 总是允许 / reject 拒绝。无人值守默认 reject，不自动允许。
 */
export const respondPermission = async (
    conn: OpencodeConnection,
    sessionID: string,
    permissionID: string,
    response: OpencodePermissionResponse,
): Promise<boolean> => {
    await opencodeFetch(conn, `/session/${encId(sessionID)}/permissions/${encId(permissionID)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response }),
    });
    return true;
};

// ========== 消息与 Shell API（只走 async + 轮询单路径） ==========

export interface OpencodePromptOptions {
    model?: { providerID: string; modelID: string };
    agent?: string;
}

/**
 * POST /session/:id/prompt_async：发 prompt 不等回（204 即受理）。
 * 编码任务动辄跑几分钟，UI 用它 + 轮询 listSessionMessages，不靠同步长连接等。
 */
export const sendPromptAsync = async (
    conn: OpencodeConnection,
    sessionID: string,
    text: string,
    opts: OpencodePromptOptions = {},
): Promise<boolean> => {
    const body: Record<string, unknown> = { parts: [{ type: 'text', text }] };
    if (opts.model) body.model = opts.model;
    if (opts.agent) body.agent = opts.agent;
    await opencodeFetch(conn, `/session/${encId(sessionID)}/prompt_async`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    return true;
};

/** GET /session/:id/message：拉消息（含 parts），轮询刷新就靠它。 */
export const listSessionMessages = async (
    conn: OpencodeConnection,
    sessionID: string,
    limit = 100,
): Promise<OpencodeMessageItem[]> =>
    readJson<OpencodeMessageItem[]>(
        await opencodeFetch(conn, `/session/${encId(sessionID)}/message?limit=${limit}`),
    );

export interface OpencodeShellOptions {
    agent?: string;
    model?: { providerID: string; modelID: string };
}

/**
 * POST /session/:id/shell：跑一条 shell 命令（返回裸 AssistantMessage）。
 * 需要审批时服务端会挂起并经 permission.updated 事件要确认，见 respondPermission。
 */
export const runShellCommand = async (
    conn: OpencodeConnection,
    sessionID: string,
    command: string,
    opts: OpencodeShellOptions = {},
): Promise<OpencodeMessageInfo> => {
    const body: Record<string, unknown> = { agent: opts.agent ?? 'build', command };
    if (opts.model) body.model = opts.model;
    return readJson<OpencodeMessageInfo>(
        await opencodeFetch(conn, `/session/${encId(sessionID)}/shell`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        }),
    );
};

/** POST /session/:id/command：执行斜杠命令（如 /init）。 */
export const runSlashCommand = async (
    conn: OpencodeConnection,
    sessionID: string,
    command: string,
    args: string,
    agent?: string,
): Promise<OpencodeMessageItem> => {
    const body: Record<string, unknown> = { command, arguments: args };
    if (agent) body.agent = agent;
    return readJson<OpencodeMessageItem>(
        await opencodeFetch(conn, `/session/${encId(sessionID)}/command`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        }),
    );
};

// ========== 文件 API ==========

/** GET /file?path=：列目录（path 空 = 项目根）。 */
export const listFiles = async (conn: OpencodeConnection, path = ''): Promise<OpencodeFileNode[]> =>
    readJson<OpencodeFileNode[]>(
        await opencodeFetch(conn, `/file?path=${encodeURIComponent(path)}`),
    );

export interface OpencodeFileContent {
    type: 'text' | 'binary';
    content: string;
    [key: string]: unknown;
}

/** GET /file/content?path=：读文件（text 直接是文本；binary 为 base64，调用方按需处理）。 */
export const readFileContent = async (conn: OpencodeConnection, path: string): Promise<OpencodeFileContent> =>
    readJson<OpencodeFileContent>(
        await opencodeFetch(conn, `/file/content?path=${encodeURIComponent(path)}`),
    );

/** GET /find?pattern=：全文搜索（返回匹配对象数组，原样透传）。 */
export const searchText = async (conn: OpencodeConnection, pattern: string): Promise<unknown[]> =>
    readJson<unknown[]>(await opencodeFetch(conn, `/find?pattern=${encodeURIComponent(pattern)}`));

/** GET /find/file?query=：按名找文件/目录（返回路径数组，原样透传）。 */
export const findFile = async (conn: OpencodeConnection, query: string): Promise<string[]> =>
    readJson<string[]>(await opencodeFetch(conn, `/find/file?query=${encodeURIComponent(query)}`));

// ========== TUI 遥控（操作本机正在跑的那个 TUI） ==========

const tuiPost = async (conn: OpencodeConnection, action: string, body?: Record<string, unknown>): Promise<boolean> => {
    await opencodeFetch(conn, `/tui/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? {}),
    });
    return true;
};

/** 往本机 TUI 输入框追加文本（不提交）。 */
export const tuiAppendPrompt = (conn: OpencodeConnection, text: string): Promise<boolean> =>
    tuiPost(conn, 'append-prompt', { text });

/** 提交本机 TUI 当前输入框。 */
export const tuiSubmitPrompt = (conn: OpencodeConnection): Promise<boolean> =>
    tuiPost(conn, 'submit-prompt');

/** 清空本机 TUI 当前输入框。 */
export const tuiClearPrompt = (conn: OpencodeConnection): Promise<boolean> =>
    tuiPost(conn, 'clear-prompt');

/** 在本机 TUI 执行命令（如 session.new / session.interrupt）。 */
export const tuiExecuteCommand = (conn: OpencodeConnection, command: string): Promise<boolean> =>
    tuiPost(conn, 'execute-command', { command });

/** 在本机 TUI 右下角弹 toast。 */
export const tuiShowToast = (conn: OpencodeConnection, message: string, title?: string): Promise<boolean> =>
    tuiPost(conn, 'show-toast', title ? { title, message } : { message });

/** 打开本机 TUI 的会话选择器。 */
export const tuiOpenSessions = (conn: OpencodeConnection): Promise<boolean> =>
    tuiPost(conn, 'open-sessions');

/** 打开本机 TUI 的模型选择器。 */
export const tuiOpenModels = (conn: OpencodeConnection): Promise<boolean> =>
    tuiPost(conn, 'open-models');

// ========== SSE 事件流 ==========

export interface OpencodeEvent {
    type: string;
    properties: unknown;
}

/**
 * 订阅 GET /event（SSE 长连接）。
 * 注意：EventSource 设不了 Authorization 头，所以用 fetch + reader 手工拆帧。
 * - 首事件 server.connected；之后是 message.part.updated（带 delta）、permission.updated、
 *   session.status/idle、session.created/updated/deleted、todo.updated 等。
 * - /event 吐裸 Event，/global/event 套 {directory, payload}；这里两种都认，统一归一化。
 * - 调用方 abort → 正常 resolve；服务端断流/网络错 → reject，由 UI 层决定重连。
 */
export const subscribeOpencodeEvents = async (
    conn: OpencodeConnection,
    onEvent: (e: OpencodeEvent) => void,
    signal: AbortSignal,
): Promise<void> => {
    let res: Response;
    try {
        res = await opencodeFetch(conn, '/event', { headers: { Accept: 'text/event-stream' }, signal });
    } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        throw e;
    }
    const reader = res.body?.getReader();
    if (!reader) throw new OpencodeNetworkError('unreachable');
    const decoder = new TextDecoder();
    let buf = '';
    const emitFrame = (frame: string): void => {
        const dataLines: string[] = [];
        for (const line of frame.split('\n')) {
            if (line.startsWith(':')) continue;
            if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
        }
        if (dataLines.length === 0) return;
        let parsed: unknown;
        try {
            parsed = JSON.parse(dataLines.join('\n'));
        } catch { return; }
        if (!parsed || typeof parsed !== 'object') return;
        const rec = parsed as Record<string, unknown>;
        const inner = rec.payload && typeof rec.payload === 'object'
            ? (rec.payload as Record<string, unknown>)
            : rec;
        if (typeof inner.type !== 'string') return;
        onEvent({ type: inner.type, properties: (inner.properties ?? {}) as unknown });
    };
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            buf = buf.replace(/\r\n/g, '\n');
            let idx: number;
            while ((idx = buf.indexOf('\n\n')) >= 0) {
                const frame = buf.slice(0, idx);
                buf = buf.slice(idx + 2);
                emitFrame(frame);
            }
        }
        buf += decoder.decode();
        if (buf.trim()) emitFrame(buf);
    } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        throw e;
    } finally {
        try { reader.cancel(); } catch { /* ignore */ }
    }
    if (signal.aborted) return;
    // 服务端正常关流属于异常（SSE 本该一直开着），抛错让 UI 显示断线。
    throw new OpencodeNetworkError('unreachable');
};
