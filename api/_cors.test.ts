import { describe, expect, it } from 'vitest';
import { applyCors } from './_cors';

const makeRes = () => {
  const headers: Record<string, string> = {};
  return { headers, setHeader(k: string, v: string) { headers[k] = v; } };
};

describe('api/_cors applyCors', () => {
  it('回显任意合法请求头/方法，丢弃非法头', () => {
    const res = makeRes();
    applyCors({
      headers: {
        'access-control-request-headers': 'x-future-feature, bad header!',
        'access-control-request-method': 'PROPFIND',
      },
    } as any, res as any);
    expect(res.headers['Access-Control-Allow-Origin']).toBe('*');
    expect(res.headers['Access-Control-Allow-Headers'].toLowerCase()).toContain('x-future-feature');
    expect(res.headers['Access-Control-Allow-Headers']).not.toContain('bad header!');
    expect(res.headers['Access-Control-Allow-Methods']).toContain('PROPFIND');
    expect(res.headers['Access-Control-Max-Age']).toBe('86400');
  });

  it('无预检头时给出基础并集', () => {
    const res = makeRes();
    applyCors({ headers: {} } as any, res as any);
    expect(res.headers['Access-Control-Allow-Headers']).toContain('Content-Type');
    expect(res.headers['Access-Control-Allow-Headers']).toContain('X-MiniMax-Group-Id');
    expect(res.headers['Access-Control-Allow-Methods']).toContain('POST');
  });
});
