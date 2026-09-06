import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { OpencodeConnection } from './opencodeClient';

const mkConn = (over: Partial<OpencodeConnection> = {}): OpencodeConnection => ({
    id: 'oc_main',
    name: 'My PC',
    baseUrl: 'http://127.0.0.1:4096',
    username: 'opencode',
    password: 's3cret',
    enabled: true,
    updatedAt: 0,
    ...over,
});

const jsonResponse = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });

describe('opencodeClient connection storage', () => {
    it('save/load roundtrip a single connection', async () => {
        const { saveOpencodeConnection, loadOpencodeConnection } = await import('./opencodeClient');
        expect(loadOpencodeConnection()).toBeNull();
        saveOpencodeConnection(mkConn());
        expect(loadOpencodeConnection()).toEqual(mkConn());
    });

    it('clearOpencodeConnection removes the stored connection', async () => {
        const { saveOpencodeConnection, loadOpencodeConnection, clearOpencodeConnection } = await import('./opencodeClient');
        saveOpencodeConnection(mkConn());
        clearOpencodeConnection();
        expect(loadOpencodeConnection()).toBeNull();
    });

    it('坏 JSON 回退 null', async () => {
        const { loadOpencodeConnection } = await import('./opencodeClient');
        localStorage.setItem('aetheros.opencode.connection', '{broken');
        expect(loadOpencodeConnection()).toBeNull();
        localStorage.removeItem('aetheros.opencode.connection');
    });

    it('导出/导入随备份走（原样字符串搬运，密码不丢）', async () => {
        const { saveOpencodeConnection, loadOpencodeConnection, exportOpencodeLocal, importOpencodeLocal } = await import('./opencodeClient');
        saveOpencodeConnection(mkConn());
        const dump = exportOpencodeLocal();
        localStorage.removeItem('aetheros.opencode.connection');
        expect(loadOpencodeConnection()).toBeNull();
        importOpencodeLocal(dump);
        expect(loadOpencodeConnection()).toEqual(mkConn());
    });
});

describe('basicAuthHeader', () => {
    it('encodes username:password as Basic (utf-8 safe)', async () => {
        const { basicAuthHeader } = await import('./opencodeClient');
        expect(basicAuthHeader(mkConn())).toBe(
            `Basic ${Buffer.from('opencode:s3cret', 'utf8').toString('base64')}`,
        );
        expect(basicAuthHeader(mkConn({ username: 'u', password: '密码' }))).toBe(
            `Basic ${Buffer.from('u:密码', 'utf8').toString('base64')}`,
        );
    });

    it('returns empty string when no username/password configured', async () => {
        const { basicAuthHeader } = await import('./opencodeClient');
        expect(basicAuthHeader(mkConn({ username: '', password: '' }))).toBe('');
        expect(basicAuthHeader(mkConn({ username: undefined, password: undefined }))).toBe('');
    });
});

describe('buildOpencodeUrl', () => {
    it('joins baseUrl and path for direct connections', async () => {
        const { buildOpencodeUrl } = await import('./opencodeClient');
        expect(buildOpencodeUrl(mkConn({ proxyUrl: undefined }), '/global/health')).toBe(
            'http://127.0.0.1:4096/global/health',
        );
        expect(buildOpencodeUrl(mkConn({ baseUrl: 'http://127.0.0.1:4096/', proxyUrl: undefined }), '/session')).toBe(
            'http://127.0.0.1:4096/session',
        );
    });

    it('wraps target with ?target= when proxyUrl is set', async () => {
        const { buildOpencodeUrl } = await import('./opencodeClient');
        expect(
            buildOpencodeUrl(mkConn({ proxyUrl: 'https://oc-proxy.example.workers.dev' }), '/global/health'),
        ).toBe(
            `https://oc-proxy.example.workers.dev?target=${encodeURIComponent('http://127.0.0.1:4096/global/health')}`,
        );
    });
});

describe('opencodeFetch', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('sends Authorization + JSON headers on direct connection', async () => {
        const { opencodeFetch } = await import('./opencodeClient');
        fetchMock.mockResolvedValue(jsonResponse({ healthy: true }));
        await opencodeFetch(mkConn({ proxyUrl: undefined }), '/global/health');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe('http://127.0.0.1:4096/global/health');
        const headers = new Headers(init.headers);
        expect(headers.get('Authorization')).toBe(`Basic ${Buffer.from('opencode:s3cret', 'utf8').toString('base64')}`);
        expect(headers.get('Accept')).toBe('application/json');
    });

    it('forwards X-Proxy-Key and strips it from upstream when proxied', async () => {
        const { opencodeFetch } = await import('./opencodeClient');
        fetchMock.mockResolvedValue(jsonResponse({ healthy: true }));
        await opencodeFetch(
            mkConn({ proxyUrl: 'https://oc-proxy.example.workers.dev', proxyKey: 'pk123' }),
            '/global/health',
        );
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toContain('?target=');
        const headers = new Headers(init.headers);
        expect(headers.get('X-Proxy-Key')).toBe('pk123');
        // Basic auth must still travel through the proxy to opencode itself.
        expect(headers.get('Authorization')).toContain('Basic ');
    });

    it('throws OpencodeAuthError on 401 without leaking the password', async () => {
        const { opencodeFetch, OpencodeAuthError } = await import('./opencodeClient');
        fetchMock.mockResolvedValue(jsonResponse({ error: 'unauthorized' }, 401));
        const err = await opencodeFetch(mkConn(), '/global/health').catch((e) => e);
        expect(err).toBeInstanceOf(OpencodeAuthError);
        expect(String(err?.message)).not.toContain('s3cret');
    });

    it('throws OpencodeNetworkError when fetch itself rejects', async () => {
        const { opencodeFetch, OpencodeNetworkError } = await import('./opencodeClient');
        fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
        const err = await opencodeFetch(mkConn(), '/global/health').catch((e) => e);
        expect(err).toBeInstanceOf(OpencodeNetworkError);
        expect(String(err?.message)).not.toContain('s3cret');
    });

    it('aborts and throws OpencodeNetworkError on timeout', async () => {
        const { opencodeFetch, OpencodeNetworkError } = await import('./opencodeClient');
        fetchMock.mockImplementation(
            (_url: string, init?: RequestInit) =>
                new Promise((_resolve, reject) => {
                    init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
                }),
        );
        const err = await opencodeFetch(mkConn(), '/global/health', {}, 20).catch((e) => e);
        expect(err).toBeInstanceOf(OpencodeNetworkError);
    });
});

describe('session API', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    const lastCall = (): [string, RequestInit] => fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [string, RequestInit];

    it('listSessions GETs /session and passes sessions through', async () => {
        const { listSessions } = await import('./opencodeClient');
        const sessions = [{ id: 's1', title: 'a', directory: '/x', projectID: 'p', time: { created: 1, updated: 2 } }];
        fetchMock.mockResolvedValue(jsonResponse(sessions));
        await expect(listSessions(mkConn())).resolves.toEqual(sessions);
        const [url, init] = lastCall();
        expect(url).toBe('http://127.0.0.1:4096/session');
        expect(init.method ?? 'GET').toBe('GET');
    });

    it('createSession POSTs title and returns the session', async () => {
        const { createSession } = await import('./opencodeClient');
        const session = { id: 's2', title: 'job', directory: '/x', projectID: 'p', time: { created: 1, updated: 1 } };
        fetchMock.mockResolvedValue(jsonResponse(session));
        await expect(createSession(mkConn(), 'job')).resolves.toEqual(session);
        const [url, init] = lastCall();
        expect(url).toBe('http://127.0.0.1:4096/session');
        expect(init.method).toBe('POST');
        expect(JSON.parse(String(init.body))).toEqual({ title: 'job' });
    });

    it('getSession/renameSession/deleteSession hit /session/:id', async () => {
        const { getSession, renameSession, deleteSession } = await import('./opencodeClient');
        const session = { id: 's1', title: 'a', directory: '/x', projectID: 'p', time: { created: 1, updated: 2 } };
        fetchMock.mockResolvedValue(jsonResponse(session));
        await getSession(mkConn(), 's1');
        expect(lastCall()[0]).toBe('http://127.0.0.1:4096/session/s1');
        fetchMock.mockResolvedValue(jsonResponse({ ...session, title: 'b' }));
        await renameSession(mkConn(), 's1', 'b');
        const [renameUrl, renameInit] = lastCall();
        expect(renameUrl).toBe('http://127.0.0.1:4096/session/s1');
        expect(renameInit.method).toBe('PATCH');
        expect(JSON.parse(String(renameInit.body))).toEqual({ title: 'b' });
        fetchMock.mockResolvedValue(jsonResponse(true));
        await expect(deleteSession(mkConn(), 's1')).resolves.toBe(true);
        const [delUrl, delInit] = lastCall();
        expect(delUrl).toBe('http://127.0.0.1:4096/session/s1');
        expect(delInit.method).toBe('DELETE');
    });

    it('abortSession POSTs /session/:id/abort', async () => {
        const { abortSession } = await import('./opencodeClient');
        fetchMock.mockResolvedValue(jsonResponse(true));
        await expect(abortSession(mkConn(), 's1')).resolves.toBe(true);
        const [url, init] = lastCall();
        expect(url).toBe('http://127.0.0.1:4096/session/s1/abort');
        expect(init.method).toBe('POST');
    });

    it('getSessionStatus GETs /session/status', async () => {
        const { getSessionStatus } = await import('./opencodeClient');
        const status = { s1: { type: 'busy' }, s2: { type: 'idle' } };
        fetchMock.mockResolvedValue(jsonResponse(status));
        await expect(getSessionStatus(mkConn())).resolves.toEqual(status);
        expect(lastCall()[0]).toBe('http://127.0.0.1:4096/session/status');
    });

    it('getSessionDiff GETs /session/:id/diff', async () => {
        const { getSessionDiff } = await import('./opencodeClient');
        const diffs = [{ file: 'a.ts', before: 'x', after: 'y', additions: 1, deletions: 0 }];
        fetchMock.mockResolvedValue(jsonResponse(diffs));
        await expect(getSessionDiff(mkConn(), 's1')).resolves.toEqual(diffs);
        expect(lastCall()[0]).toBe('http://127.0.0.1:4096/session/s1/diff');
    });

    it('respondPermission POSTs once/always/reject', async () => {
        const { respondPermission } = await import('./opencodeClient');
        fetchMock.mockResolvedValue(jsonResponse(true));
        await expect(respondPermission(mkConn(), 's1', 'p9', 'once')).resolves.toBe(true);
        const [url, init] = lastCall();
        expect(url).toBe('http://127.0.0.1:4096/session/s1/permissions/p9');
        expect(init.method).toBe('POST');
        expect(JSON.parse(String(init.body))).toEqual({ response: 'once' });
    });
});

describe('message and shell API', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    const lastCall = (): [string, RequestInit] => fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [string, RequestInit];

    it('sendPromptAsync POSTs text parts and accepts 204 without parsing', async () => {
        const { sendPromptAsync } = await import('./opencodeClient');
        fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
        await expect(sendPromptAsync(mkConn(), 's1', '修一下登录 bug')).resolves.toBe(true);
        const [url, init] = lastCall();
        expect(url).toBe('http://127.0.0.1:4096/session/s1/prompt_async');
        expect(init.method).toBe('POST');
        expect(JSON.parse(String(init.body))).toEqual({ parts: [{ type: 'text', text: '修一下登录 bug' }] });
    });

    it('sendPromptAsync forwards model/agent options', async () => {
        const { sendPromptAsync } = await import('./opencodeClient');
        fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
        await sendPromptAsync(mkConn(), 's1', 'hi', {
            model: { providerID: 'anthropic', modelID: 'claude-x' },
            agent: 'plan',
        });
        expect(JSON.parse(String(lastCall()[1].body))).toEqual({
            parts: [{ type: 'text', text: 'hi' }],
            model: { providerID: 'anthropic', modelID: 'claude-x' },
            agent: 'plan',
        });
    });

    it('listSessionMessages GETs with limit', async () => {
        const { listSessionMessages } = await import('./opencodeClient');
        const items = [{ info: { id: 'm1', sessionID: 's1', role: 'user', time: { created: 1 } }, parts: [] }];
        fetchMock.mockResolvedValue(jsonResponse(items));
        await expect(listSessionMessages(mkConn(), 's1', 50)).resolves.toEqual(items);
        expect(lastCall()[0]).toBe('http://127.0.0.1:4096/session/s1/message?limit=50');
    });

    it('runShellCommand POSTs agent+command and returns the assistant message', async () => {
        const { runShellCommand } = await import('./opencodeClient');
        const msg = { id: 'm9', sessionID: 's1', role: 'assistant', time: { created: 2 } };
        fetchMock.mockResolvedValue(jsonResponse(msg));
        await expect(runShellCommand(mkConn(), 's1', 'git status --short')).resolves.toEqual(msg);
        const [url, init] = lastCall();
        expect(url).toBe('http://127.0.0.1:4096/session/s1/shell');
        expect(init.method).toBe('POST');
        expect(JSON.parse(String(init.body))).toEqual({ agent: 'build', command: 'git status --short' });
    });

    it('runSlashCommand POSTs command+arguments', async () => {
        const { runSlashCommand } = await import('./opencodeClient');
        const reply = { info: { id: 'm3', sessionID: 's1', role: 'assistant', time: { created: 3 } }, parts: [] };
        fetchMock.mockResolvedValue(jsonResponse(reply));
        await expect(runSlashCommand(mkConn(), 's1', 'init', '')).resolves.toEqual(reply);
        const [url, init] = lastCall();
        expect(url).toBe('http://127.0.0.1:4096/session/s1/command');
        expect(JSON.parse(String(init.body))).toEqual({ command: 'init', arguments: '' });
    });
});

describe('file and TUI API', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    const lastCall = (): [string, RequestInit] => fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [string, RequestInit];

    it('listFiles GETs /file?path=', async () => {
        const { listFiles } = await import('./opencodeClient');
        const nodes = [{ name: 'a.ts', path: 'src/a.ts', absolute: '/x/src/a.ts', type: 'file', ignored: false }];
        fetchMock.mockResolvedValue(jsonResponse(nodes));
        await expect(listFiles(mkConn(), 'src')).resolves.toEqual(nodes);
        expect(lastCall()[0]).toBe('http://127.0.0.1:4096/file?path=src');
    });

    it('readFileContent GETs /file/content?path=', async () => {
        const { readFileContent } = await import('./opencodeClient');
        const content = { type: 'text', content: 'hello' };
        fetchMock.mockResolvedValue(jsonResponse(content));
        await expect(readFileContent(mkConn(), 'src/a.ts')).resolves.toEqual(content);
        expect(lastCall()[0]).toBe('http://127.0.0.1:4096/file/content?path=src%2Fa.ts');
    });

    it('searchText/findFile hit /find endpoints', async () => {
        const { searchText, findFile } = await import('./opencodeClient');
        fetchMock.mockImplementation(() => Promise.resolve(jsonResponse([])));
        await searchText(mkConn(), 'TODO');
        expect(lastCall()[0]).toBe('http://127.0.0.1:4096/find?pattern=TODO');
        await findFile(mkConn(), 'TerminalApp');
        expect(lastCall()[0]).toBe('http://127.0.0.1:4096/find/file?query=TerminalApp');
    });

    it('TUI controls POST the right paths and bodies', async () => {
        const { tuiAppendPrompt, tuiSubmitPrompt, tuiClearPrompt, tuiExecuteCommand, tuiShowToast, tuiOpenSessions, tuiOpenModels } = await import('./opencodeClient');
        fetchMock.mockResolvedValue(jsonResponse(true));
        await tuiAppendPrompt(mkConn(), 'hello');
        expect(lastCall()[0]).toBe('http://127.0.0.1:4096/tui/append-prompt');
        expect(JSON.parse(String(lastCall()[1].body))).toEqual({ text: 'hello' });
        await tuiSubmitPrompt(mkConn());
        expect(lastCall()[0]).toBe('http://127.0.0.1:4096/tui/submit-prompt');
        await tuiClearPrompt(mkConn());
        expect(lastCall()[0]).toBe('http://127.0.0.1:4096/tui/clear-prompt');
        await tuiExecuteCommand(mkConn(), 'session.new');
        expect(lastCall()[0]).toBe('http://127.0.0.1:4096/tui/execute-command');
        expect(JSON.parse(String(lastCall()[1].body))).toEqual({ command: 'session.new' });
        await tuiShowToast(mkConn(), 'done');
        expect(lastCall()[0]).toBe('http://127.0.0.1:4096/tui/show-toast');
        expect(JSON.parse(String(lastCall()[1].body))).toEqual({ message: 'done' });
        await tuiOpenSessions(mkConn());
        expect(lastCall()[0]).toBe('http://127.0.0.1:4096/tui/open-sessions');
        await tuiOpenModels(mkConn());
        expect(lastCall()[0]).toBe('http://127.0.0.1:4096/tui/open-models');
    });
});

describe('SSE event stream', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    const sseResponse = (chunks: string[]): Response => {
        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                for (const c of chunks) controller.enqueue(encoder.encode(c));
                controller.close();
            },
        });
        return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    };

    it('parses frames split across chunks and normalizes GlobalEvent wrapper', async () => {
        const { subscribeOpencodeEvents } = await import('./opencodeClient');
        fetchMock.mockResolvedValue(
            sseResponse([
                'data: {"type":"server.connected","prope',
                'rties":{}}\n\ndata: {"directory":"/x","payload":{"type":"session.idle","properties":{"sessionID":"s1"}}}\n\n',
            ]),
        );
        const seen: { type: string; properties: unknown }[] = [];
        const controller = new AbortController();
        await expect(
            subscribeOpencodeEvents(mkConn(), (e) => seen.push(e), controller.signal),
        ).rejects.toThrow();
        expect(seen).toEqual([
            { type: 'server.connected', properties: {} },
            { type: 'session.idle', properties: { sessionID: 's1' } },
        ]);
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe('http://127.0.0.1:4096/event');
        expect(new Headers(init.headers).get('Accept')).toBe('text/event-stream');
    });

    it('resolves (not rejects) when aborted by caller', async () => {
        const { subscribeOpencodeEvents } = await import('./opencodeClient');
        fetchMock.mockImplementation(
            (_url: string, init?: RequestInit) =>
                new Promise((_resolve, reject) => {
                    init?.signal?.addEventListener('abort', () =>
                        reject(new DOMException('aborted', 'AbortError')),
                    );
                }),
        );
        const controller = new AbortController();
        const pending = subscribeOpencodeEvents(mkConn(), () => {}, controller.signal);
        controller.abort();
        await expect(pending).resolves.toBeUndefined();
    });
});

describe('testOpencodeConnection', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('returns server version on healthy response', async () => {
        const { testOpencodeConnection } = await import('./opencodeClient');
        fetchMock.mockResolvedValue(jsonResponse({ healthy: true, version: '1.18.29' }));
        await expect(testOpencodeConnection(mkConn())).resolves.toEqual({ version: '1.18.29' });
        const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe('http://127.0.0.1:4096/global/health');
    });

    it('rejects unhealthy servers', async () => {
        const { testOpencodeConnection } = await import('./opencodeClient');
        fetchMock.mockResolvedValue(jsonResponse({ healthy: false, version: '1.18.29' }));
        await expect(testOpencodeConnection(mkConn())).rejects.toThrow();
    });
});
