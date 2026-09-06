# 终端 CORS 代理（用户自部署）

出门在外、手机和电脑不在一个网时，浏览器直连家里的 opencode serve 会被 CORS
拦住（或根本没有公网地址）。这个 Worker 部署到**你自己的 Cloudflare 账号**，
做透明转发并补上 CORS 头；Basic Auth 原样透传，Worker 不存任何凭据。

> 三种接入方式（详见 [`docs/opencode-terminal.md`](../../docs/opencode-terminal.md)）：
> 1. **直连**：同机 / 局域网 / Tailscale，serve 起 `--cors <手机源>`，代理 URL 留空
> 2. **本地代理**：`node scripts/opencode-proxy.mjs`（默认 `http://localhost:18062`）
> 3. **自己的 Cloudflare Worker**：就是本目录，出门远程办公走这条

## 前置条件

Worker 只能访问**公网**地址。家里电脑需要先有公网入口（公网 IP + 端口映射，
或 Cloudflare Tunnel），且 serve 必须设强密码：

```bash
OPENCODE_SERVER_PASSWORD=<强密码> opencode serve --hostname 0.0.0.0 --port 4096
```

## 部署

方式 A（无需装任何工具）：Cloudflare Dashboard → Workers & Pages → Create →
Quick Edit，把 `worker.js` 内容粘贴进去 → Deploy。

方式 B（命令行）：

```bash
cd worker/opencode-proxy
wrangler deploy
```

部署完会得到一个地址，形如 `https://sullyos-opencode-proxy.<你的子域>.workers.dev`。

## 防白嫖（强烈建议）

Worker 地址一旦泄露，任何人都能用它中转流量。设置一个密钥：

```bash
wrangler secret put PROXY_KEY   # 或在 Dashboard 的 Settings → Variables 里加
```

然后在 SullyOS 设置 → 终端的「代理密钥」填同一个值。

## 在 SullyOS 里使用

设置 → 终端 → 「代理 URL」填你的 Worker 地址（「代理密钥」按需填写）。
前端会自动把请求包装成 `<代理URL>?target=<opencode地址>` 转发。

## 请求协议

- `POST/GET/PATCH/DELETE <worker>/?target=<url-encoded opencode地址>`
- 透传头：`Content-Type` / `Accept` / `Authorization`（Basic Auth 给 serve）
- 鉴权头：`X-Proxy-Key`（设置了 `PROXY_KEY` 才校验；不会发给上游）
- 拒绝内网/本机目标地址（SSRF 防护，只允许公网目标）
- SSE 事件流（`/event`）原样透传
