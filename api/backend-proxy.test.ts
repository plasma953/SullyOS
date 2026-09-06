import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { PassThrough } from 'node:stream';
import handler from './backend-proxy';

const OLD_ENV = process.env.BACKEND_HOST;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (OLD_ENV === undefined) delete process.env.BACKEND_HOST;
  else process.env.BACKEND_HOST = OLD_ENV;
});

beforeEach(() => {
  process.env.BACKEND_HOST = 'backend.example.com';
});

const mockRes = () => {
  const stream = new PassThrough();
  const chunks: Buffer[] = [];
  stream.on('data', (c) => chunks.push(Buffer.from(c)));
  const res: any = Object.assign(stream, {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    headersSent: false,
    status(code: number) { res.statusCode = code; return res; },
    setHeader(k: string, v: string) { res.headers[k.toLowerCase()] = v; },
    json(obj: unknown) { res.body = obj; res.end(); return res; },
    text() { return Promise.resolve(Buffer.concat(chunks).toString('utf8')); },
  });
  return res;
};

const mockReq = (over: Record<string, unknown> = {}) => ({
  method: 'GET',
  headers: {},
  query: { ns: 'agent', rest: 'v1/health' },
  ...over,
});

describe('api/backend-proxy', () => {
  it('relays to https://BACKEND_HOST/ns/rest with query passthrough', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response('ok', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));
    const res = mockRes();
    await handler(mockReq({ query: { ns: 'amsg', rest: 'v1/tools', x: '1' } }), res);
    expect(res.statusCode).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://backend.example.com/amsg/v1/tools?x=1');
    expect(res.headers['content-type']).toBe('application/json');
  });

  it('forwards Authorization and drops hop-by-hop headers', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response('ok', { status: 200 });
    }));
    const res = mockRes();
    await handler(mockReq({
      method: 'POST',
      headers: { authorization: 'Bearer t', host: 'x.vercep.app', 'content-length': '3' },
      body: { a: 1 },
      query: { ns: 'agent', rest: 'v1/mcp-relay' },
    }), res);
    const sent = new Headers(calls[0].init.headers);
    expect(sent.get('authorization')).toBe('Bearer t');
    expect(sent.get('host')).toBeNull();
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ a: 1 });
  });

  it('missing BACKEND_HOST → 500 without calling upstream', async () => {
    delete process.env.BACKEND_HOST;
    const fake = vi.fn();
    vi.stubGlobal('fetch', fake);
    const res = mockRes();
    await handler(mockReq(), res);
    expect(res.statusCode).toBe(500);
    expect(fake).not.toHaveBeenCalled();
  });

  it('rejects unknown namespace, empty path and malformed host', async () => {
    const fake = vi.fn();
    vi.stubGlobal('fetch', fake);
    for (const query of [
      { ns: 'evil', rest: 'x' },
      { ns: 'agent', rest: '' },
    ]) {
      const res = mockRes();
      await handler(mockReq({ query }), res);
      expect(res.statusCode).toBe(400);
    }
    process.env.BACKEND_HOST = 'https://evil host/x';
    const res = mockRes();
    await handler(mockReq(), res);
    expect(res.statusCode).toBe(500);
    expect(fake).not.toHaveBeenCalled();
  });

  it('upstream failure → 502', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
    const res = mockRes();
    await handler(mockReq(), res);
    expect(res.statusCode).toBe(502);
  });
});
