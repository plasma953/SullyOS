import { describe, expect, it } from 'vitest';
import { CHANNEL_CHECKLISTS, resolveExternalRequest } from './externalRequest';

const cfg = {
  agentUrl: 'https://agent.example.com',
  agentToken: 'tok',
  workerBase: 'https://worker.example.com',
};

describe('resolveExternalRequest', () => {
  it('worker 相对路径拼中心 worker，完整 URL 原样', () => {
    expect(resolveExternalRequest('/amap?x=1', { route: 'worker' }, cfg).url).toBe('https://worker.example.com/amap?x=1');
    expect(resolveExternalRequest('https://other.example.com/x', { route: 'worker' }, cfg).url).toBe('https://other.example.com/x');
    expect(resolveExternalRequest('/amap', { route: 'worker' }, cfg).channel).toBe('worker');
  });

  it('llm 配了 agentUrl 时 chat/models 走中转', () => {
    const chat = resolveExternalRequest('https://api.vendor.com/v1/chat/completions', {
      route: 'llm',
      method: 'POST',
      body: JSON.stringify({ model: 'm' }),
    }, cfg);
    expect(chat.url).toBe('https://agent.example.com/agent/v1/chat/completions');
    expect(chat.channel).toBe('llm:主代理中转');

    const models = resolveExternalRequest('https://api.vendor.com/v1/models', { route: 'llm' }, cfg);
    expect(models.url).toContain('/agent/v1/models?target=');
  });

  it('llm 未配 agentUrl 时直连（含暂无中转端点的 embeddings）', () => {
    const out = resolveExternalRequest('https://api.siliconflow.cn/v1/embeddings', {
      route: 'llm',
      method: 'POST',
      body: JSON.stringify({}),
    }, { ...cfg, agentUrl: '' });
    expect(out.url).toBe('https://api.siliconflow.cn/v1/embeddings');
    expect(out.channel).toBe('llm:直连');
  });

  it('route/purpose 不泄漏进 RequestInit', () => {
    const out = resolveExternalRequest('/x', { route: 'worker', purpose: '测试' }, cfg);
    expect((out.init as Record<string, unknown>).route).toBeUndefined();
    expect((out.init as Record<string, unknown>).purpose).toBeUndefined();
  });

  it('direct/mcp 原样透传', () => {
    expect(resolveExternalRequest('https://x.example.com/a', { route: 'direct' }, cfg).url).toBe('https://x.example.com/a');
    expect(resolveExternalRequest('https://mcp.example.com/mcp', { route: 'mcp' }, cfg).url).toBe('https://mcp.example.com/mcp');
  });

  it('每个通道都有非空排查清单', () => {
    for (const route of ['llm', 'worker', 'mcp', 'direct'] as const) {
      expect(CHANNEL_CHECKLISTS[route].length).toBeGreaterThan(0);
    }
  });
});
