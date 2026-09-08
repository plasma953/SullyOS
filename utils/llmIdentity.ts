/**
 * opencode.ai 上游自标识（Go 防滥用要求）。
 *
 * opencode 要求调用方带可识别的 User-Agent + x-opencode-session 头（提示词缓存亲和），
 * 缺了直接拒请求。浏览器路径没这个问题——聊天走主代理中转，头由 VPS 的
 * worker/main-agent 补（见那份的 llmIdentityHeaders）。但云端 worker（主动消息 2.0、
 * Instant Push）是拿凭据表里的原始供应商地址直连 opencode.ai 的，上游 SDK 的 callLlm
 * 只发 Content-Type + Authorization，到点必被拒：
 *   「Error from provider: Request is missing x-opencode-session and cannot be routed…」
 *
 * 修法镜像 main-agent 的做法：装一个全局 fetch 补丁，命中 opencode.ai 域的
 * POST /chat/completions 时补上两个头，其余请求原样放行。在 worker 入口模块顶层装
 * 一次——上游 SDK（callLlm、情绪评估）全部在调用时现取 globalThis.fetch，一个点全覆盖。
 *
 * 细节：
 *   - session 取 isolate 级稳定 UUID（同 main-agent 的进程级稳定，缓存亲和 best-effort）。
 *   - 只处理 (string|URL, init?) 形态——两个 worker 的全部 LLM 调用点都是这个形态；
 *     Request 形态直接放行（重建 Request 有 body 流锁死的风险，不值得）。
 *   - 整段 try/catch fail-open：任何解析异常原样放行，绝不影响 push / D1 / self-update
 *     等其他请求。
 *   - 补头只在不存在时 set，不覆盖调用方已带的同名头。
 *
 * 零依赖、零浏览器 API（这份代码会被打进 worker bundle）。
 */

/** opencode.ai 及其子域。 */
const OPENCODE_HOST_RE = /(^|\.)opencode\.ai$/i;

/** 只认 chat completions 终点，别的路径（/models 等）不碰。 */
const CHAT_COMPLETIONS_RE = /\/chat\/completions$/;

/** 幂等标记，挂在 globalThis 上：装过一次就不再包第二层。 */
const INSTALL_FLAG = '__sullyosOpencodeIdentityInstalled';

const DEFAULT_UA = 'SullyOS-Worker/1.0 (+https://github.com/plasma953/SullyOS)';

/** isolate 级稳定 session：第一次用到才生成，之后整个 isolate 生命周期内复用。 */
let sessionId: string | null = null;

/** worker 名字进 UA，opencode 侧排障时能认出请求来自哪条链路。 */
let userAgent = DEFAULT_UA;

function resolveSessionId(): string {
  if (!sessionId) {
    try {
      sessionId =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    } catch {
      sessionId = `fallback-${Date.now().toString(36)}`;
    }
  }
  return sessionId;
}

/** 命中 opencode.ai 的 chat completions 就回要补的头，否则 null。 */
function identityHeadersFor(url: URL): Record<string, string> | null {
  if (!OPENCODE_HOST_RE.test(url.hostname)) return null;
  if (!CHAT_COMPLETIONS_RE.test(url.pathname)) return null;
  return {
    'user-agent': userAgent,
    'x-opencode-session': resolveSessionId(),
  };
}

/** URL 解析尽力而为；Request 形态明确回 null（不碰），解析不出也回 null（放行）。 */
function parseUrl(input: RequestInfo | URL): URL | null {
  try {
    if (typeof input === 'string') return new URL(input);
    if (input instanceof URL) return input;
  } catch {
    return null;
  }
  return null;
}

/**
 * 给当前全局 fetch 装上 opencode 身份头。必须在任何 LLM 调用发生前调用
 * （worker 入口模块顶层装一次即可；重复调用是 no-op）。
 */
export function installOpencodeIdentityFetch(ua?: string): void {
  const g = globalThis as any;
  if (g[INSTALL_FLAG]) return;
  g[INSTALL_FLAG] = true;
  userAgent = ua || DEFAULT_UA;
  const originalFetch: typeof fetch = g.fetch.bind(g);
  const patched = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    try {
      const url = parseUrl(input);
      const extra = url ? identityHeadersFor(url) : null;
      const method = String(init?.method ?? 'POST').toUpperCase();
      // Request 形态 / 非 POST / 非 opencode / 解析失败：原样放行。
      if (!extra || method !== 'POST' || input instanceof Request) {
        return originalFetch(input, init);
      }
      const headers = new Headers(init?.headers);
      for (const [name, value] of Object.entries(extra)) {
        if (!headers.has(name)) headers.set(name, value);
      }
      return originalFetch(input, { ...init, headers });
    } catch {
      return originalFetch(input, init);
    }
  };
  g.fetch = patched;
}
