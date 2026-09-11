import { describe, expect, it } from 'vitest';
import { buildAgentModelsRelayRequest, buildAgentRelayRequest } from './agentRelayRequest';

const cfg = { agentUrl: 'https://agent.example.com/', agentToken: 'tok' };

describe('buildAgentRelayRequest（/chat/completions 主代理中转）', () => {
  it('把供应商信息打包进 body.llm，鉴权换 X-Client-Token', () => {
    const init = {
      method: 'POST',
      headers: { Authorization: 'Bearer sk-supplier', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-x', messages: [], stream: true }),
    };
    const out = buildAgentRelayRequest('https://api.vendor.com/v1/chat/completions', init, cfg)!;
    expect(out).not.toBeNull();
    expect(out.url).toBe('https://agent.example.com/agent/v1/chat/completions');
    const headers = out.init.headers as Record<string, string>;
    expect(headers['X-Client-Token']).toBe('tok');
    expect((headers as Record<string, unknown>).Authorization).toBeUndefined();
    const body = JSON.parse(String(out.init.body));
    expect(body.llm).toEqual({ baseUrl: 'https://api.vendor.com/v1', apiKey: 'sk-supplier', model: 'gpt-x' });
    expect(body.messages).toEqual([]);
    expect(body.stream).toBe(true);
  });

  it('未配 agentUrl / 已是中转 URL / 非 chat 路径 / body 非 JSON 都返回 null', () => {
    const base = { method: 'POST', body: JSON.stringify({ model: 'm' }) };
    expect(buildAgentRelayRequest('https://api.vendor.com/v1/chat/completions', base, { agentUrl: '', agentToken: '' })).toBeNull();
    expect(buildAgentRelayRequest('https://agent.example.com/agent/v1/chat/completions', base, cfg)).toBeNull();
    expect(buildAgentRelayRequest('https://api.vendor.com/v1/models', base, cfg)).toBeNull();
    expect(buildAgentRelayRequest('https://api.vendor.com/v1/chat/completions', { method: 'POST', body: 'not json' }, cfg)).toBeNull();
  });

  it('headers 里的 key 缺失时回退到 body.apiKey', () => {
    const init = { method: 'POST', body: JSON.stringify({ model: 'm', apiKey: 'sk-in-body' }) };
    const out = buildAgentRelayRequest('https://api.vendor.com/v1/chat/completions', init, cfg)!;
    expect(JSON.parse(String(out.init.body)).llm.apiKey).toBe('sk-in-body');
  });
});

describe('buildAgentModelsRelayRequest（/models 主代理中转）', () => {
  it('target 透传，供应商 key 走 X-Relay-Target-Authorization', () => {
    const init = { method: 'GET', headers: { Authorization: 'Bearer sk-abc' } };
    const out = buildAgentModelsRelayRequest('https://api.vendor.com/v1/models', init, cfg)!;
    expect(out.url).toBe('https://agent.example.com/agent/v1/models?target=' + encodeURIComponent('https://api.vendor.com/v1/models'));
    const headers = out.init.headers as Record<string, string>;
    expect(headers['X-Client-Token']).toBe('tok');
    expect(headers['X-Relay-Target-Authorization']).toBe('Bearer sk-abc');
  });

  it('未配中转 / 已是中转 URL / 非 models 路径返回 null', () => {
    expect(buildAgentModelsRelayRequest('https://api.vendor.com/v1/models', {}, { agentUrl: '', agentToken: '' })).toBeNull();
    expect(buildAgentModelsRelayRequest('https://agent.example.com/agent/v1/models?target=x', {}, cfg)).toBeNull();
    expect(buildAgentModelsRelayRequest('https://api.vendor.com/v1/chat/completions', {}, cfg)).toBeNull();
  });
});
