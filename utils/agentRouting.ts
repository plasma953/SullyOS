/**
 * VPS 主代理中转（预设联动）的运行时配置读取。
 *
 * patchedFetch 只安装一次（interceptorsInitialized 门控），闭包里拿不到最新的
 * apiConfig——所以这里每次请求实时读 localStorage('os_api_config')，改设置立即生效。
 */
export interface AgentRoutingConfig {
  agentUrl: string;
  agentToken: string;
}

export function readAgentRoutingConfig(): AgentRoutingConfig {
  try {
    const raw = localStorage.getItem('os_api_config');
    if (!raw) return { agentUrl: '', agentToken: '' };
    const cfg = JSON.parse(raw);
    return {
      agentUrl: String(cfg?.agentUrl || '').trim(),
      agentToken: String(cfg?.agentToken || '').trim(),
    };
  } catch {
    return { agentUrl: '', agentToken: '' };
  }
}

/**
 * 从 fetch 的 headers 里安全取 Authorization（兼容 Headers 对象与普通对象两种形态）。
 */
export function readBearerFromHeaders(headers: unknown): string {
  try {
    const asHeaders = headers as Headers;
    if (typeof (asHeaders as any)?.get === 'function') {
      return String((asHeaders as Headers).get('Authorization') || '');
    }
    const obj = headers as Record<string, string>;
    return String(obj?.Authorization || obj?.authorization || '');
  } catch {
    return '';
  }
}