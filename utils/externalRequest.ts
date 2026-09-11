/**
 * 统一外部请求入口（CORS 通道路由 + 诊断标注）。
 *
 * 背景见 docs/superpowers/specs/2026-09-11-cors-unification-design.md：
 * SullyOS 的第三方请求分四条路——LLM 走主代理中转（配了 agentUrl 时）、
 * 公开 API 走中心 worker、MCP 走自配代理、本机服务直连。此前每个模块各自
 * 拼 URL/选通道，接新服务时容易漏走通道或撞 CORS；这里提供唯一的决策入口。
 *
 * 用法：调用方声明 route（请求语义）；resolveExternalRequest 决定最终 URL 与
 * headers（纯函数、可单测）；externalFetch 额外把「用途 + 通道」挂进 __sullyMeta，
 * 让全局网络失败日志（调试终端 SYSTEM ERROR）直接显示这条请求走的是哪条通道。
 */

import { getProxyWorkerUrl } from './proxyWorker';
import { readAgentRoutingConfig } from './agentRouting';
import { buildAgentModelsRelayRequest, buildAgentRelayRequest } from './agentRelayRequest';

export type ExternalRoute = 'llm' | 'worker' | 'mcp' | 'direct';

export interface ExternalRequestInit extends RequestInit {
  route: ExternalRoute;
  /** 诊断用用途说明，例如「拉取模型列表」；会进失败日志。 */
  purpose?: string;
}

export interface ExternalRoutingConfig {
  agentUrl: string;
  agentToken: string;
  workerBase: string;
}

export interface ResolvedExternalRequest {
  url: string;
  init: RequestInit;
  /** 实际走的通道名，进诊断日志。 */
  channel: string;
}

/** 各通道失败时的排查清单（路由无关的通用线索由 networkFailureDiagnosis 产出）。 */
export const CHANNEL_CHECKLISTS: Record<ExternalRoute, string[]> = {
  llm: [
    '检查设置 → 主代理地址与 Token（配了才走中转）',
    '未配中转时该供应商必须自带 CORS 头，否则浏览器直连必失败',
    '确认 API Key 有效、Base URL 无多余斜杠',
  ],
  worker: [
    '检查设置 → 网络代理 (Worker) 地址是否可达',
    '公共实例可能未部署该端点；自部署实例需要更新到对应版本',
  ],
  mcp: [
    '检查服务器条目的连接方式（中转 / 直连 / 代理 URL）',
    '直连模式要求 MCP 服务器自带 CORS 且暴露 Mcp-Session-Id',
  ],
  direct: [
    '该服务可能不支持浏览器直连（无 CORS 头）；确认是否应改走 worker / 主代理通道',
    '本机服务确认地址与端口（混合内容、局域网访问）',
  ],
};

const defaultConfig = (): ExternalRoutingConfig => ({
  ...readAgentRoutingConfig(),
  workerBase: getProxyWorkerUrl(),
});

/**
 * 决定一条外部请求最终该打到哪里。纯函数（配置可注入），单测直接覆盖分支。
 */
export function resolveExternalRequest(
  url: string,
  init: ExternalRequestInit,
  cfg: ExternalRoutingConfig = defaultConfig(),
): ResolvedExternalRequest {
  const baseInit: RequestInit = { ...init };
  delete (baseInit as Record<string, unknown>).route;
  delete (baseInit as Record<string, unknown>).purpose;

  if (init.route === 'worker') {
    const finalUrl = url.startsWith('/') ? `${cfg.workerBase}${url}` : url;
    return { url: finalUrl, init: baseInit, channel: 'worker' };
  }

  if (init.route === 'llm') {
    const relayCfg = { agentUrl: cfg.agentUrl, agentToken: cfg.agentToken };
    const chat = buildAgentRelayRequest(url, baseInit, relayCfg);
    if (chat) return { url: chat.url, init: chat.init, channel: 'llm:主代理中转' };
    const models = buildAgentModelsRelayRequest(url, baseInit, relayCfg);
    if (models) return { url: models.url, init: models.init, channel: 'llm:主代理中转' };
    return { url, init: baseInit, channel: 'llm:直连' };
  }

  if (init.route === 'mcp') return { url, init: baseInit, channel: 'mcp' };
  return { url, init: baseInit, channel: 'direct' };
}

/**
 * 统一出口：路由 + 把「用途 + 通道」挂进 __sullyMeta。
 * 失败诊断不在这里重复打印——全局 fetch 拦截器已经会写一条带旁证的网络日志
 * （utils/networkFailureDiagnosis.ts），这里的标注只是让那条日志能显示通道。
 */
export async function externalFetch(url: string, init: ExternalRequestInit): Promise<Response> {
  const resolved = resolveExternalRequest(url, init);
  const purpose = [init.purpose, `通道：${resolved.channel}`].filter(Boolean).join(' · ');
  const existingMeta = (resolved.init as { __sullyMeta?: Record<string, unknown> }).__sullyMeta || {};
  const finalInit = {
    ...resolved.init,
    __sullyMeta: { ...existingMeta, purpose },
  } as RequestInit;
  return fetch(resolved.url, finalInit);
}
