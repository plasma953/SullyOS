/**
 * SullyOS 终端 CORS 代理 — 部署到「你自己的」Cloudflare 账号
 *
 * 出门在外、手机和电脑不在一个网时，浏览器直连家里的 opencode serve 会被
 * CORS 拦住（或根本没有公网地址）。这个 Worker 做透明转发并补上正确的 CORS 头，
 * Basic Auth 原样透传给 serve，Worker 本身不存任何凭据。
 *
 * 部署（二选一）：
 *   A. Cloudflare Dashboard → Workers → Create → 粘贴本文件 → Deploy
 *   B. 本目录下执行 `wrangler deploy`
 *
 * 用法：在 SullyOS 设置 → 终端 的「代理 URL」里填你的 Worker 地址，
 *      例如 https://sullyos-opencode-proxy.<你的子域>.workers.dev
 *      前端会以 <代理URL>?target=<opencode地址> 的形式转发请求。
 *
 * 前置条件（重要）：Worker 只能访问公网地址。家里电脑需要先有公网入口
 * （公网 IP + 端口映射，或 Cloudflare Tunnel），且 serve 必须设强密码：
 *   OPENCODE_SERVER_PASSWORD=<强密码> opencode serve --hostname 0.0.0.0 --port 4096
 * 详见 docs/opencode-terminal.md。
 *
 * 必填加固（防别人白嫖你的 Worker 流量，否则请求会被 401 拒绝）：
 *   wrangler secret put PROXY_KEY（或 Dashboard → Settings → Variables 里加），
 *   然后在 SullyOS 设置 → 终端的「代理密钥」里填同一个值。
 */

const FORWARD_REQUEST_HEADERS = [
    'content-type',
    'accept',
    'authorization',
];

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization, X-Proxy-Key',
    'Access-Control-Expose-Headers': 'WWW-Authenticate',
    'Access-Control-Max-Age': '86400',
};

function corsJson(status, obj) {
    return new Response(JSON.stringify(obj), {
        status,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
}

function isPrivateIpv4(host) {
    const parts = host.split('.').map(Number);
    if (parts.length !== 4 || parts.some(p => !Number.isInteger(p) || p < 0 || p > 255)) return false;
    const [a, b] = parts;
    return a === 0 || a === 10 || a === 127
        || (a === 169 && b === 254)
        || (a === 172 && b >= 16 && b <= 31)
        || (a === 192 && b === 168)
        || (a === 100 && b >= 64 && b <= 127);
}

// 只允许公网 http/https 目标，禁止把 Worker 当内网探针用
function blockedTargetReason(rawUrl) {
    let url;
    try { url = new URL(rawUrl); } catch { return 'target 不是合法 URL'; }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '只允许 http/https';
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    const blocked = host === 'localhost'
        || host.endsWith('.localhost')
        || host.endsWith('.local')
        || host.endsWith('.internal')
        || host === '::1'
        || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')
        || isPrivateIpv4(host);
    return blocked ? '不允许代理内网/本机地址' : null;
}

export default {
    async fetch(request, env) {
        if (request.method === 'OPTIONS') {
            const headers = new Headers(CORS_HEADERS);
            // 只回显白名单内的请求头：原样回显任意头会让任意站点把自定义头打进预检。
            const allowed = new Set(
                String(CORS_HEADERS['Access-Control-Allow-Headers']).split(',').map(s => s.trim().toLowerCase()),
            );
            const requestedHeaders = request.headers.get('access-control-request-headers');
            if (requestedHeaders) {
                const picked = requestedHeaders.split(',').map(s => s.trim()).filter(s => allowed.has(s.toLowerCase()));
                if (picked.length) headers.set('Access-Control-Allow-Headers', picked.join(', '));
            }
            return new Response(null, { status: 204, headers });
        }

        // PROXY_KEY 必填（fail-closed）：无鉴权的 ?target= 开放转发等于把 Worker 配额送人。
        // 部署：在 Worker 环境变量设 PROXY_KEY，并在 SullyOS 设置 → 终端的「代理密钥」填同一个值。
        if (!env.PROXY_KEY) {
            return corsJson(401, { error: '未配置 PROXY_KEY：请在 Worker 环境变量设置后重试（防流量被白嫖）' });
        }
        {
            const key = request.headers.get('x-proxy-key') || '';
            if (key !== env.PROXY_KEY) return corsJson(403, { error: '代理密钥错误（X-Proxy-Key）' });
        }

        const target = new URL(request.url).searchParams.get('target');
        if (!target) return corsJson(400, { error: '缺少 ?target=<opencode地址> 参数' });
        const blocked = blockedTargetReason(target);
        if (blocked) return corsJson(400, { error: blocked });

        const fwdHeaders = new Headers();
        for (const name of FORWARD_REQUEST_HEADERS) {
            const v = request.headers.get(name);
            if (v) fwdHeaders.set(name, v);
        }

        let upstream;
        try {
            upstream = await fetch(target, {
                method: request.method,
                headers: fwdHeaders,
                body: (request.method === 'GET' || request.method === 'HEAD') ? undefined : request.body,
            });
        } catch (e) {
            return corsJson(502, { error: `转发失败: ${e.message}` });
        }

        // 透传响应（含 SSE 流），补 CORS 头
        const respHeaders = new Headers(CORS_HEADERS);
        for (const name of ['content-type', 'www-authenticate', 'cache-control']) {
            const v = upstream.headers.get(name);
            if (v) respHeaders.set(name, v);
        }
        return new Response(upstream.body, { status: upstream.status, headers: respHeaders });
    },
};
