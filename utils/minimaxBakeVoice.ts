/**
 * Bake-voice（固定声音）前端寻址与回退策略。
 *
 * 自建中心 worker 优先：`{workerBase}/minimax/bake-voice`；
 * 相对路径 `/api/minimax/bake-voice` 回退（Vercel serverless / 本地 dev）。
 * 直连 MiniMax 上游不可回退——T2A→upload→voice_clone 三步编排只能由代理执行。
 *
 * 回退只发生在"旧 worker 尚无此路由（404/405）或网络不通"时；
 * worker 明确返回的业务失败（401/400/502 等）直接抛，不回退，避免把真错误吞掉。
 */

import { safeResponseJson } from './safeApi';

export const BAKE_VOICE_WORKER_PATH = '/minimax/bake-voice';
export const BAKE_VOICE_RELATIVE_PATH = '/api/minimax/bake-voice';

/** worker 优先、相对路径回退的地址对。纯函数，可单测。 */
export const resolveBakeVoiceUrls = (workerBase: string): { primary: string; fallback: string } => ({
  primary: `${String(workerBase || '').trim().replace(/\/+$/, '')}${BAKE_VOICE_WORKER_PATH}`,
  fallback: BAKE_VOICE_RELATIVE_PATH,
});

/** 旧 worker 未重新部署（无此路由）：只有这两种状态值得回退相对路径。 */
export const isBakeVoiceRouteMissing = (status: number): boolean =>
  status === 404 || status === 405;

/** worker 明确返回的业务失败：标记后跳过回退，直接透出。 */
class BakeVoiceBusinessError extends Error {}

export interface BakeVoicePostArgs {
  primary: string;
  fallback: string;
  payload: Record<string, unknown>;
  region: string;
}

const postJson = async (url: string, payload: Record<string, unknown>, region: string): Promise<{ status: number; data: any }> => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-MiniMax-Region': region },
    body: JSON.stringify(payload),
  });
  return { status: res.status, data: await safeResponseJson(res) };
};

/**
 * 先打自建 worker，路由缺失（404/405）或网络不通才回退相对路径。
 * 两路都不可用时抛"当前部署不支持固定声音"，调用方直接 toast，不静默。
 */
export const postBakeVoice = async ({ primary, fallback, payload, region }: BakeVoicePostArgs): Promise<any> => {
  try {
    const { status, data } = await postJson(primary, payload, region);
    if (status >= 200 && status < 300 && !data?.error) return data;
    if (!isBakeVoiceRouteMissing(status)) {
      throw new BakeVoiceBusinessError(data?.error || `固定声音失败（HTTP ${status}）`);
    }
    // 404/405：旧 worker 无此路由 → 回退相对路径
  } catch (err) {
    if (err instanceof BakeVoiceBusinessError) throw err;
    // fetch 本身抛错（网络不通/旧 worker 404 页等）→ 回退相对路径
  }

  let relRes: Response;
  try {
    relRes = await fetch(fallback, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-MiniMax-Region': region },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error('当前部署不支持固定声音（自建 worker 与内置接口均不可用）');
  }
  const relData = await safeResponseJson(relRes);
  if (!relRes.ok || relData?.error) {
    if (isBakeVoiceRouteMissing(relRes.status)) {
      throw new Error('当前部署不支持固定声音（内置接口缺失，且自建 worker 未更新）');
    }
    throw new Error(relData?.error || `固定声音失败（HTTP ${relRes.status}）`);
  }
  return relData;
};
