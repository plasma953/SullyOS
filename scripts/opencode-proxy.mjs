#!/usr/bin/env node
/**
 * opencode CORS 代理（给「终端」App 用）
 *
 * 浏览器直连 opencode serve 时，若 serve 没起 --cors 或手机与电脑不在同源，
 * 请求会被 CORS 拦住。这个代理跑在你自己的电脑上，做透明转发并补上 CORS 头，
 * 同时把 Basic Auth 原样透传给 serve。
 *
 * 用法:
 *   node scripts/opencode-proxy.mjs                            # 默认: 只绑 127.0.0.1，代理 18062 → serve 127.0.0.1:4096
 *   node scripts/opencode-proxy.mjs --port 19000               # 自定义代理端口
 *   node scripts/opencode-proxy.mjs --target http://192.168.1.5:4096  # serve 在局域网另一台机器
 *   node scripts/opencode-proxy.mjs --host 0.0.0.0             # 允许局域网设备连本代理（仅可信网络）
 *
 * 然后在 SullyOS 设置 → 终端 里把「代理 URL」填 http://localhost:18062，
 * 「opencode 地址」照常填 serve 的真实地址。
 *
 * 通用模式（与 worker/opencode-proxy 的 Cloudflare Worker 同一套约定）:
 *   请求带 ?target=<url-encoded serve URL> 时，转发到该地址而不是 --target。
 *   例: http://localhost:18062/?target=http%3A%2F%2F127.0.0.1%3A4096%2Fglobal%2Fhealth
 */

import { createServer, request as httpRequest } from 'http';
import { request as httpsRequest } from 'https';
import { pathToFileURL } from 'url';

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
    const idx = args.indexOf(name);
    return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback;
};

const PROXY_PORT = parseInt(getArg('--port', '18062'), 10);
const TARGET = getArg('--target', 'http://127.0.0.1:4096');
// 默认只绑回环：0.0.0.0 会把无鉴权转发暴露给整个局域网/Wi-Fi。
// 确实需要局域网另一台设备连时再显式 --host 0.0.0.0。
const LISTEN_HOST = getArg('--host', '127.0.0.1');
const UPSTREAM_TIMEOUT_MS = 30000;
const MAX_BODY_BYTES = 10 * 1024 * 1024;

const CORS_BASE_HEADERS = 'Content-Type, Accept, Authorization, X-Proxy-Key';
const CORS_BASE_METHODS = 'POST, GET, PATCH, DELETE, OPTIONS';

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': CORS_BASE_METHODS,
    'Access-Control-Allow-Headers': CORS_BASE_HEADERS,
    'Access-Control-Expose-Headers': 'WWW-Authenticate',
    'Access-Control-Max-Age': '86400',
};

/** CORS 契约：净化回显浏览器声明的请求头/方法（与 worker/opencode-proxy 行为一致）。 */
export function corsHeadersFor(req) {
    const raw = String(req.headers['access-control-request-headers'] || '');
    const picked = raw.split(',').map(s => s.trim()).filter(Boolean)
        .slice(0, 16)
        .filter(s => s.length <= 64 && /^[A-Za-z0-9-]+$/.test(s));
    const method = String(req.headers['access-control-request-method'] || '').trim();
    const allowMethods = Array.from(new Set([...CORS_BASE_METHODS.split(',').map(s => s.trim()), ...(method.length <= 16 && /^[A-Z]+$/.test(method) ? [method] : [])]));
    const allowHeaders = Array.from(new Set([...CORS_BASE_HEADERS.split(',').map(s => s.trim()), ...picked]));
    return {
        ...CORS_HEADERS,
        'Access-Control-Allow-Methods': allowMethods.join(', '),
        'Access-Control-Allow-Headers': allowHeaders.join(', '),
    };
}

/** ?target= 只允许回环/局域网目标：本代理无鉴权，任意公网 target 等于帮任意网页做跳板。 */
function targetOverrideAllowed(url) {
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (host === 'localhost' || host.endsWith('.localhost')) return true;
    if (host === '::1') return true;
    const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!v4) return false;
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

function deny(res, message) {
    res.writeHead(400, { ...CORS_HEADERS, 'Content-Type': 'text/plain' });
    res.end(message);
}

const server = createServer((req, res) => {
    // CORS preflight：净化回显浏览器声明的请求头/方法。
    if (req.method === 'OPTIONS') {
        res.writeHead(204, corsHeadersFor(req));
        res.end();
        return;
    }

    // Collect body（封顶防内存炸弹）
    const chunks = [];
    let bodyBytes = 0;
    let bodyTooLarge = false;
    req.on('data', (c) => {
        if (bodyTooLarge) return;
        bodyBytes += c.length;
        if (bodyBytes > MAX_BODY_BYTES) {
            bodyTooLarge = true;
            return;
        }
        chunks.push(c);
    });
    req.on('end', () => {
        if (bodyTooLarge) {
            res.writeHead(413, { ...CORS_HEADERS, 'Content-Type': 'text/plain' });
            res.end('Body too large');
            return;
        }
        const body = Buffer.concat(chunks);

        // 通用模式: ?target=<绝对URL> 优先于 --target（与 worker/opencode-proxy 约定一致）
        const incomingUrl = new URL(req.url, TARGET);
        const targetOverride = incomingUrl.searchParams.get('target');
        let targetUrl;
        if (targetOverride) {
            try {
                targetUrl = new URL(targetOverride);
            } catch {
                deny(res, 'Invalid ?target= URL');
                return;
            }
            if (!targetOverrideAllowed(targetUrl)) {
                deny(res, '?target= 只允许回环/局域网地址');
                return;
            }
        } else {
            targetUrl = incomingUrl;
        }
        if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
            res.writeHead(400, { ...CORS_HEADERS, 'Content-Type': 'text/plain' });
            res.end('Only http/https targets are allowed');
            return;
        }

        // 只透传业务头：Basic Auth 必须到 serve；代理密钥不往上游送。
        const fwdHeaders = {};
        if (req.headers['content-type']) fwdHeaders['Content-Type'] = req.headers['content-type'];
        if (req.headers['accept']) fwdHeaders['Accept'] = req.headers['accept'];
        if (req.headers['authorization']) fwdHeaders['Authorization'] = req.headers['authorization'];

        // Forward（https 目标走 https 模块；SSE 流式响应直接 pipe）
        const requestFn = targetUrl.protocol === 'https:' ? httpsRequest : httpRequest;
        const proxyReq = requestFn(
            {
                hostname: targetUrl.hostname,
                port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
                path: targetUrl.pathname + targetUrl.search,
                method: req.method,
                headers: fwdHeaders,
                timeout: UPSTREAM_TIMEOUT_MS,
            },
            (proxyRes) => {
                const respHeaders = { ...CORS_HEADERS };
                const ct = proxyRes.headers['content-type'];
                if (ct) respHeaders['Content-Type'] = ct;
                const wwwAuth = proxyRes.headers['www-authenticate'];
                if (wwwAuth) respHeaders['WWW-Authenticate'] = wwwAuth;
                res.writeHead(proxyRes.statusCode || 200, respHeaders);
                proxyRes.pipe(res);
            },
        );

        proxyReq.on('error', (e) => {
            console.error(`[opencode-proxy] Error forwarding to ${targetUrl.host}: ${e.message}`);
            res.writeHead(502, { ...CORS_HEADERS, 'Content-Type': 'text/plain' });
            res.end(`Proxy error: ${e.message}`);
        });

        if (body.length > 0) proxyReq.write(body);
        proxyReq.end();
    });
});

// 直接运行才监听端口；被测试 import 时不启动服务。
const isDirectRun = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (isDirectRun) {
    server.listen(PROXY_PORT, LISTEN_HOST, () => {
        console.log(`opencode CORS Proxy started`);
        console.log(`  Proxy:  http://${LISTEN_HOST === '0.0.0.0' ? 'localhost' : LISTEN_HOST}:${PROXY_PORT}/`);
        console.log(`  Target: ${TARGET}`);
        if (LISTEN_HOST === '0.0.0.0') {
            console.log(`  注意：正在监听全网卡，本代理无鉴权，仅建议在可信局域网使用。`);
        }
        console.log(`\nSet the proxy URL in SullyOS Settings to: http://localhost:${PROXY_PORT}`);
    });
}
