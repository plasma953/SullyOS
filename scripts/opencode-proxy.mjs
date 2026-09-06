#!/usr/bin/env node
/**
 * opencode CORS 代理（给「终端」App 用）
 *
 * 浏览器直连 opencode serve 时，若 serve 没起 --cors 或手机与电脑不在同源，
 * 请求会被 CORS 拦住。这个代理跑在你自己的电脑上，做透明转发并补上 CORS 头，
 * 同时把 Basic Auth 原样透传给 serve。
 *
 * 用法:
 *   node scripts/opencode-proxy.mjs                            # 默认: 代理 18062 → serve 127.0.0.1:4096
 *   node scripts/opencode-proxy.mjs --port 19000               # 自定义代理端口
 *   node scripts/opencode-proxy.mjs --target http://192.168.1.5:4096  # serve 在局域网另一台机器
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

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
    const idx = args.indexOf(name);
    return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback;
};

const PROXY_PORT = parseInt(getArg('--port', '18062'), 10);
const TARGET = getArg('--target', 'http://127.0.0.1:4096');

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization, X-Proxy-Key',
    'Access-Control-Expose-Headers': 'WWW-Authenticate',
    'Access-Control-Max-Age': '86400',
};

createServer((req, res) => {
    // CORS preflight
    if (req.method === 'OPTIONS') {
        const requestedHeaders = req.headers['access-control-request-headers'];
        res.writeHead(204, {
            ...CORS_HEADERS,
            ...(requestedHeaders ? { 'Access-Control-Allow-Headers': requestedHeaders } : {}),
        });
        res.end();
        return;
    }

    // Collect body
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
        const body = Buffer.concat(chunks);

        // 通用模式: ?target=<绝对URL> 优先于 --target（与 worker/opencode-proxy 约定一致）
        const incomingUrl = new URL(req.url, TARGET);
        const targetOverride = incomingUrl.searchParams.get('target');
        let targetUrl;
        if (targetOverride) {
            try {
                targetUrl = new URL(targetOverride);
            } catch {
                res.writeHead(400, { ...CORS_HEADERS, 'Content-Type': 'text/plain' });
                res.end('Invalid ?target= URL');
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
}).listen(PROXY_PORT, () => {
    console.log(`opencode CORS Proxy started`);
    console.log(`  Proxy:  http://localhost:${PROXY_PORT}/`);
    console.log(`  Target: ${TARGET}`);
    console.log(`\nSet the proxy URL in SullyOS Settings to: http://localhost:${PROXY_PORT}`);
});
