import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { installOpencodeIdentityFetch } from './llmIdentity';

/**
 * fetch 补丁的回归守卫：opencode.ai 的 POST /chat/completions 必须带上身份头，
 * 其余请求一律原样放行（旧行为——没补丁——下第 1 条会挂）。
 */

const UA = 'SullyOS-AmsgWorker/1.0 (+https://github.com/plasma953/SullyOS)';
const CHAT_URL = 'https://opencode.ai/zen/go/v1/chat/completions';

const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
  new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }),
);

const calls = () => fetchMock.mock.calls;

const headersOf = (callIndex: number): Headers =>
  new Headers((calls()[callIndex]?.[1] as RequestInit | undefined)?.headers);

beforeAll(() => {
  vi.stubGlobal('fetch', fetchMock);
  installOpencodeIdentityFetch(UA);
});

beforeEach(() => {
  fetchMock.mockClear();
});

describe('installOpencodeIdentityFetch', () => {
  it('opencode.ai 的 chat/completions POST 补上 user-agent + x-opencode-session', async () => {
    await fetch(CHAT_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"model":"m"}',
    });
    expect(calls()).toHaveLength(1);
    expect(String(calls()[0][0])).toBe(CHAT_URL);
    expect(headersOf(0).get('user-agent')).toBe(UA);
    expect(headersOf(0).get('x-opencode-session') || '').toBeTruthy();
    // 原有头不能丢。
    expect(headersOf(0).get('content-type')).toBe('application/json');
  });

  it('同 isolate 内 session 稳定（跨不同子域也一致）', async () => {
    await fetch('https://opencode.ai/a/v1/chat/completions', { method: 'POST', body: '{}' });
    await fetch('https://zen.opencode.ai/b/v1/chat/completions', { method: 'POST', body: '{}' });
    expect(headersOf(0).get('x-opencode-session')).toBe(headersOf(1).get('x-opencode-session'));
  });

  it('非 chat/completions 路径（GET /models）不加头', async () => {
    await fetch('https://opencode.ai/zen/go/v1/models', {
      method: 'GET',
      headers: { authorization: 'Bearer sk-x' },
    });
    expect(headersOf(0).get('user-agent')).toBeNull();
    expect(headersOf(0).get('x-opencode-session')).toBeNull();
    expect(headersOf(0).get('authorization')).toBe('Bearer sk-x');
  });

  it('非 opencode 域不加头', async () => {
    await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', body: '{}' });
    expect(headersOf(0).get('user-agent')).toBeNull();
    expect(headersOf(0).get('x-opencode-session')).toBeNull();
  });

  it('调用方已带的 user-agent / session 不被覆盖', async () => {
    await fetch(CHAT_URL, {
      method: 'POST',
      headers: { 'user-agent': 'CustomAgent/9.9', 'x-opencode-session': 'caller-session' },
      body: '{}',
    });
    expect(headersOf(0).get('user-agent')).toBe('CustomAgent/9.9');
    expect(headersOf(0).get('x-opencode-session')).toBe('caller-session');
  });

  it('URL 对象入参同样生效', async () => {
    await fetch(new URL(CHAT_URL), { method: 'POST', body: '{}' });
    expect(headersOf(0).get('user-agent')).toBe(UA);
    expect(headersOf(0).get('x-opencode-session') || '').toBeTruthy();
  });

  it('Request 对象形态原样放行（不碰 body 流）', async () => {
    const request = new Request(CHAT_URL, { method: 'POST', body: '{}' });
    await fetch(request);
    expect(calls()).toHaveLength(1);
    const passed = calls()[0][0] as Request;
    expect(passed).toBe(request);
    expect(passed.headers.get('user-agent')).toBeNull();
  });

  it('幂等：装两次全局 fetch 引用不变（不包第二层）', () => {
    const before = globalThis.fetch;
    installOpencodeIdentityFetch(UA);
    expect(globalThis.fetch).toBe(before);
  });

  it('body 原样透传', async () => {
    const body = '{"model":"deepseek-v4-flash","messages":[]}';
    await fetch(CHAT_URL, { method: 'POST', body });
    expect((calls()[0][1] as RequestInit).body).toBe(body);
  });
});
