/**
 * 主代理中转的请求改写（纯函数，OSContext 拦截器与 utils/externalRequest 共用）。
 *
 * 设置里填了 agentUrl（os_api_config.agentUrl）后：
 *   - /chat/completions → ${agentUrl}/agent/v1/chat/completions，原供应商
 *     baseUrl/apiKey/model 打包进 body.llm 随请求直传（主代理零落盘、换预设即时
 *     生效），鉴权换成 X-Client-Token；
 *   - /models → ${agentUrl}/agent/v1/models?target=<原URL>，供应商 key 经
 *     X-Relay-Target-Authorization 头现场转发（不进 URL、不落盘，与 MCP 中转同一约定）。
 *
 * 返回 null 表示不需要/不能改写（未配中转、已是中转 URL、路径不匹配、body 非 JSON），
 * 调用方保持原请求。
 */

import { readBearerFromHeaders, type AgentRoutingConfig } from './agentRouting';

export interface AgentRelayResult {
  url: string;
  init: RequestInit;
}

type RelayCfg = Pick<AgentRoutingConfig, 'agentUrl' | 'agentToken'>;

const agentBaseOf = (cfg: RelayCfg): string => (cfg.agentUrl || '').trim().replace(/\/+$/, '');

const relayHeaders = (cfg: RelayCfg): Record<string, string> => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cfg.agentToken) headers['X-Client-Token'] = cfg.agentToken;
  return headers;
};

/** /chat/completions → 主代理中转（body.llm 包装）。 */
export function buildAgentRelayRequest(
  url: string,
  init: RequestInit,
  cfg: RelayCfg,
): AgentRelayResult | null {
  const agentBase = agentBaseOf(cfg);
  if (!agentBase) return null;
  if (url.includes(agentBase)) return null;
  if (!/\/chat\/completions(\?.*)?$/.test(url)) return null;
  const rawBody = init.body;
  if (typeof rawBody !== 'string') return null;
  try {
    const parsed = JSON.parse(rawBody);
    const authRaw = readBearerFromHeaders(init.headers);
    const apiKey = authRaw.replace(/^Bearer\s+/i, '') || parsed?.apiKey || '';
    const providerBase = url.replace(/\/chat\/completions(\?.*)?$/, '');
    return {
      url: `${agentBase}/agent/v1/chat/completions`,
      init: {
        ...init,
        headers: relayHeaders(cfg),
        body: JSON.stringify({
          ...parsed,
          llm: { baseUrl: providerBase, apiKey, model: parsed?.model },
        }),
      },
    };
  } catch {
    return null;
  }
}

/** /models → 主代理中转（target 透传，供应商 key 走 X-Relay-Target-Authorization）。 */
export function buildAgentModelsRelayRequest(
  url: string,
  init: RequestInit,
  cfg: RelayCfg,
): AgentRelayResult | null {
  const agentBase = agentBaseOf(cfg);
  if (!agentBase) return null;
  if (url.includes(agentBase)) return null;
  if (!/\/models(\?.*)?$/.test(url)) return null;
  const headers = relayHeaders(cfg);
  const authRaw = readBearerFromHeaders(init.headers);
  const apiKey = authRaw.replace(/^Bearer\s+/i, '');
  if (apiKey) headers['X-Relay-Target-Authorization'] = `Bearer ${apiKey}`;
  return {
    url: `${agentBase}/agent/v1/models?target=${encodeURIComponent(url)}`,
    init: { ...init, headers },
  };
}
