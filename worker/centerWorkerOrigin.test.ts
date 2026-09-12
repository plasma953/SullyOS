/**
 * 中心 worker Origin 白名单（env.ALLOWED_ORIGINS）行为测试。
 * 设计：docs/superpowers/specs/2026-09-12-worker-default-origin-guard-design.md
 *
 * 约定：未配置 ALLOWED_ORIGINS 时行为与旧版完全一致（本文件最后一个用例锁死）；
 * 配置后只放行名单内页面来源，无 Origin 的后台/服务端调用不受影响。
 */
import { describe, expect, it } from 'vitest';
// @ts-expect-error 纯 JS worker 无类型声明
import worker from './index.js';

const ALLOWED = 'https://page.example.com, http://localhost:5173';

const call = (
  options: { origin?: string | null; method?: string; path?: string; env?: any },
) => {
  const { origin = null, method = 'GET', path = '/api/health', env = { ALLOWED_ORIGINS: ALLOWED } } = options;
  const headers: Record<string, string> = {};
  if (origin) headers.Origin = origin;
  return worker.fetch(
    new Request(`https://worker.invalid${path}`, { method, headers }),
    env,
    { waitUntil() {} },
  );
};

describe('中心 worker Origin 白名单', () => {
  it('名单内 Origin 的预检：204 + ACAO 回显 + 自定义请求头放行', async () => {
    const res = await worker.fetch(
      new Request('https://worker.invalid/any/path', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://page.example.com',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'x-future-feature',
        },
      }),
      { ALLOWED_ORIGINS: ALLOWED },
      { waitUntil() {} },
    );
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://page.example.com');
    expect((res.headers.get('Access-Control-Allow-Headers') || '').toLowerCase()).toContain('x-future-feature');
  });

  it('名单外 Origin：预检与实请求都 403，且不带任何 CORS 头', async () => {
    const pre = await call({ origin: 'https://evil.example.com', method: 'OPTIONS', path: '/any/path' });
    expect(pre.status).toBe(403);
    expect(pre.headers.get('Access-Control-Allow-Origin')).toBeNull();

    const get = await call({ origin: 'https://evil.example.com' });
    expect(get.status).toBe(403);
    expect(get.headers.get('Access-Control-Allow-Origin')).toBeNull();
    const body = await get.json() as any;
    expect(body.error).toBe('origin_not_allowed');
  });

  it('名单内 Origin 的实际请求正常通过', async () => {
    const res = await call({ origin: 'https://page.example.com' });
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://page.example.com');
  });

  it('无 Origin（后台任务 / 服务端调用）放行', async () => {
    const res = await call({ origin: null });
    expect(res.status).toBe(200);
  });

  it('Origin 大小写不敏感', async () => {
    const res = await call({ origin: 'HTTPS://PAGE.EXAMPLE.COM' });
    expect(res.status).toBe(200);
  });

  it('未配置 ALLOWED_ORIGINS：保持旧行为（任意来源放行）', async () => {
    const res = await call({ origin: 'https://anything.example.com', env: {} });
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://anything.example.com');
  });

  it('空字符串 ALLOWED_ORIGINS：视为未配置', async () => {
    const res = await call({ origin: 'https://anything.example.com', env: { ALLOWED_ORIGINS: ' , ' } });
    expect(res.status).toBe(200);
  });
});
