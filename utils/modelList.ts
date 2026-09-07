import { readAgentRoutingConfig } from './agentRouting';

const MODEL_ID_KEYS = ['id', 'model', 'name', 'model_name', 'slug'] as const;

/**
 * 把第三方 /models 的松散返回值收敛成 UI 可以安全处理的字符串列表。
 * 有些兼容站会把整个模型对象（甚至 null、数字）塞进数组；这些值若直接
 * 进入选择器，公共前缀计算里的 slice/toLowerCase 会让整页崩溃。
 */
export function normalizeModelIds(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    const result: string[] = [];

    for (const item of value) {
        let candidate: unknown = item;
        if (item && typeof item === 'object') {
            const record = item as Record<string, unknown>;
            candidate = MODEL_ID_KEYS.map(key => record[key]).find(entry => typeof entry === 'string');
        }
        if (typeof candidate !== 'string') continue;
        const id = candidate.trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        result.push(id);
    }

    return result;
}

/** Extract common OpenAI-compatible and nested model-list response shapes. */
export function extractModelIds(data: unknown): string[] {
    if (Array.isArray(data)) return normalizeModelIds(data);
    if (!data || typeof data !== 'object') return [];

    const root = data as Record<string, unknown>;
    const nestedData = root.data && typeof root.data === 'object' && !Array.isArray(root.data)
        ? root.data as Record<string, unknown>
        : undefined;
    const candidates = [root.data, root.models, nestedData?.models, nestedData?.data];
    for (const candidate of candidates) {
        const models = normalizeModelIds(candidate);
        if (models.length > 0) return models;
    }
    return [];
}

/**
 * 浏览器侧拉取 OpenAI 兼容 /models 列表（唯一入口）。
 *
 * CORS 规则：主流 LLM 网关（含 opencode.ai）不给浏览器回 CORS 头，浏览器直连
 * 必然 Failed to fetch。主代理中转已配置时一律走 /agent/v1/models 透传
 * （供应商 key 放 X-Relay-Target-Authorization 头，与 MCP 中转同一约定，
 * 不进 URL、不落盘）；未配置中转才保持浏览器直连（此时要求对方自带 CORS）。
 */
export async function fetchChatModelList(
    baseUrl: string,
    apiKey: string,
    request: typeof fetch = fetch,
): Promise<string[]> {
    const base = baseUrl.trim().replace(/\/+$/, '');
    if (!base) throw new Error('请先填写 URL');
    const agent = readAgentRoutingConfig();
    const agentBase = agent.agentUrl.trim().replace(/\/+$/, '');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    let url: string;
    if (agentBase) {
        url = agentBase + '/agent/v1/models?target=' + encodeURIComponent(base + '/models');
        if (agent.agentToken) headers['X-Client-Token'] = agent.agentToken;
        if (apiKey) headers['X-Relay-Target-Authorization'] = `Bearer ${apiKey}`;
    } else {
        url = base + '/models';
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    }
    const response = await request(url, { method: 'GET', headers });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    let data: unknown;
    try {
        data = await response.json();
    } catch {
        throw new Error('模型列表不是合法 JSON');
    }
    return extractModelIds(data);
}
