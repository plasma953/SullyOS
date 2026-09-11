# 酷狗概念版音乐来源 · 设计 Spec（2026-09-08）

## 目标

小手机「音乐」App 新增酷狗概念版来源，酷狗为默认来源、网易云保留可切换。范围：搜歌 / 播放 / 歌词 / 音质 / 酷狗登录（扫码 + 验证码）/ 歌单 / 我喜欢 / 最近在听 / 每日推荐 / 私人 FM。本地生成歌（写歌 App）链路不动。

## 背景与现状

- 音乐 App 目前是网易云硬编码，无来源抽象：浏览器 → `POST /netease/<action>`（`context/MusicContext.tsx:234-313` musicApi）→ 自建 CF Worker（`worker/index.js:4561-4647` 路由，648-860 常量与构建器）→ api-enhanced（Vercel）→ music.163.com。
- `Song` 类型无来源概念（`MusicContext.tsx:29-52`），唯一非网易分支是本地歌 `song.local`（`playSong` 664-743 行）。
- 用户自建 CF Worker：`https://sully-proxy.plasmavendorlia.workers.dev`（2026-09-08 已探测确认跑 ethernet 版代码、/netease 链路健康、CORS 预检正常）。代码默认值 `sullymeow.ccwu.cc` 是上游作者的公共实例，与本方案无关。

## 上游选型（已核实）

**MakcRe/KuGouMusicApi**（github.com/MakcRe/KuGouMusicApi，936 star，MIT，仿 NeteaseCloudMusicApi 风格，Vercel 一键部署）：

- 环境变量 `platform=lite` 即**酷狗概念版**模式（token 与标准版不通用，用户手机用的就是概念版）。
- 用户自己 fork 部署到 Vercel（与 api-enhanced 同样的部署方式），不使用第三方公开实例。
- 登录：二维码（`/login/qr/key` → `/login/qr/create` → `/login/qr/check` 轮询，status=4 返回 token）+ 手机验证码（`/captcha/sent` → `/login/cellphone`，请求带 `support_multi:1` 多登录态并存，**不会把手机上的概念版挤下线**；设备管理是独立的 get_dev / dev_logout 接口，均为显式操作）。
- 播放 URL：`/song/url/auth/merge`（聚合 `/song/auth` + `/song/url/auth`，登录后非会员可取完整 128k，VIP 按权益），参数 `hash`（必）+ `album_id` + `album_audio_id` + `quality`（128/320/flac/high）。不传 dfid 服务端自动生成随机 dfid。
- 搜索：`/search`（`keywords`/`page`/`pagesize`），**必须带 cookie（至少 dfid）否则 error_code 152**。
- 歌词：两步链 `/search/lyric?hash=` 拿 `id`+`accesskey` → `/lyric?id&accesskey&fmt=lrc&decode=true` 返回 `body.decodeContent`（LRC 明文，现有 parseLyric 直接可用）。酷狗无翻译歌词，tlyric 置空。
- 歌单：`/user/playlist`（登录用户创建+收藏的歌单）→ `/playlist/track/all/new?listid=`（用户歌单曲目）。**「我喜欢」没有独立 like 接口**，走用户歌单里的特殊歌单（Phase 0 探针确认标记方式，确认不了就降级只展示普通歌单）。
- 推荐：`/everyday/recommend`（每日推荐）、`/personal/fm`（私人 FM）、`/user/listen`（听歌排行）、`/lastest/songs/listen`（最近在听）。

## 架构

```
浏览器（不变）
  POST /kugou/<action> + Header X-Kugou-Cookie: token=..;userid=..;dfid=..;auth=..
    → 自建 CF Worker（新增 /kugou/* 路由，镜像 /netease 的白名单+缓存+多上游）
      → KuGouMusicApi（用户自己的 Vercel, platform=lite）
        → 酷狗服务器
```

前端不做通用来源抽象（只有两个在线来源，抽象是过度设计）：新增 `kugouApi` 与 `musicApi` 并列（同款 `_raw`/`call` 结构，复用 `_cachedCall`），在 `doSearch`/`playSong`/个人页等调用点按 `cfg.source` 分发。纯函数（搜索结果映射、hash→id、音质映射、cookie 拼装）下沉到新文件 `utils/kugouCore.ts`，便于单测。

## 关键设计决策

| 决策点 | 方案 |
|---|---|
| 来源默认值 | `MusicCfg.source?: 'kugou'\|'netease'`，缺省 = `'kugou'`（存量配置自动落酷狗，符合用户偏好；网易 `cookie` 字段原样保留） |
| Song 来源标识 | `Song` 增加可选字段 `source?: 'kugou'\|'netease'`、`hash?: string`、`kugouAlbumId?: string`、`albumAudioId?: number`。**不写 source = 网易**，存量收藏/最近播放/本地相册零迁移 |
| 酷狗歌曲 id | `Song.id`（number）= `albumAudioId`，缺失用 `mixSongID`，再缺失用 `parseInt(hash 前 12 位 hex, 16)`（`hashToId`）。`hash` 恒必有；去重/队列比较沿用现有 `s.id === song.id`（队列不会混来源，可行） |
| 登录态 | `MusicCfg.kugouCookie` 存 `token=..;userid=..;dfid=..;auth=..`（登录后串 `/register/dev` 拿 dfid、`/user/verify` 拿 auth）。worker 把 `X-Kugou-Cookie` 头转成上游 `cookie` query 参数 |
| 音质映射 | 现有 5 档 UI 保留：standard→128、higher/exhigh→320、lossless→flac、hires→high（`kugouQuality`） |
| worker 上游配置 | `KUGOU_UPSTREAMS` 常量数组（镜像 NETEASE_UPSTREAMS）+ `env.KUGOU_UPSTREAMS`（逗号分隔，CF 面板配，优先于常量）——用户粘贴自己的 Vercel 地址即可，不用改代码 |
| worker 缓存 | `KUGOU_CACHE_TTL`：lyric/search/lyric 7 天、search 10 分、playlist/track/all(+new) 10 分、user/playlist 10 分、song/url 3 分、everyday/recommend 5 分；带 cookie 请求分 `user` 桶（镜像网易 vip/anon） |
| 前端缓存 | `utils/musicCache.ts` **零改动**——现有 TTL 规则按 path 前缀匹配，酷狗的 `/lyric`（24h）、`/song/url`（90s）、`/user/playlist`（5min）、`/playlist/track/all*`（10min）自动命中正确档位；`/search`、`/everyday/recommend` 不在规则内 = 不缓存，符合预期 |
| 每日推荐 / FM / 最近在听 | 酷狗版个人页直接提供入口，数据映射在 KugouProfilePage 内做 |

## 接口契约（worker `/kugou/*`）

- 请求：`POST /kugou/<action>`，JSON body，`X-Kugou-Cookie` 头可选。
- worker 翻译成 `GET <upstream>/<action>?<params>&cookie=<X-Kugou-Cookie>&timestamp=<ms>` 转发（KuGouMusicApi 按 URL 做了 2 分钟缓存，timestamp 防 URL 级缓存）。
- action 白名单（全部对应 KuGouMusicApi 模块，命名即上游路径）：`search`、`search/lyric`、`lyric`、`song/url`（重写→`/song/url/auth/merge`）、`user/verify`、`user/detail`、`user/vip/detail`、`user/playlist`、`playlist/track/all`、`playlist/track/all/new`、`everyday/recommend`、`personal/fm`、`user/listen`、`lastest/songs/listen`、`register/dev`、`refresh/login`、`login/qr/key`、`login/qr/create`、`login/qr/check`、`login/cellphone`、`captcha/sent`。
- 边缘缓存/多上游/`X-Sully-Cache` 头：复用网易段机制，`fetchFromAnyUpstream` 与 `buildCacheKey` 参数化（加 upstreams / namespace 参数），网易行为不变（cache key host 变更导致旧网易缓存条目一次性失效，TTL 短无感知）。

## 明确的限制（用户已知情）

- VIP 歌：不登录只能播免费歌；登录后需概念版 VIP 权益（与手机 App 体验一致）。未登录时酷狗搜索不可用（error 152），登录前搜索页给出明确提示。
- 扫码必须用概念版 App 扫（platform=lite）。
- 搜索结果与播放 URL 的响应字段名以 Phase 0 探针实测为准；映射代码写成多 key 兜底（`s.SongName || s.name` 风格），探针后按 fixture 校准并固化单测。
- 酷狗无歌词翻译、无 like 写接口（「我喜欢」读取走特殊歌单；收藏/取消收藏等写操作本期不做）。

## 范围外（本期不做）

对歌单添加/删除歌曲等写操作、MV/听书/评论/电台乐库页、酷狗云盘、逐字 krc 歌词、双来源聚合搜索。

## 本次实施会触碰的文件（多窗口协调用）

| 文件 | 动作 |
|---|---|
| `worker/index.js` | 修改：kugou 常量区+构建器（648-860 区）、参数化 `fetchFromAnyUpstream`/`buildCacheKey`、新增 `/kugou` 路由（4561 前）、新增 `__kugouProxyTest` 导出（2428 旁） |
| `worker/kugouProxy.test.ts` | 新建 |
| `utils/kugouCore.ts` | 新建（纯函数：mapKugouSearchItem / hashToId / kugouQuality / composeKugouCookie） |
| `utils/kugouCore.test.ts` | 新建 |
| `context/MusicContext.tsx` | 修改：类型（21-52）、默认配置（90-94）、`kugouApi`（313 后）、`playSong` 酷狗分支（743/745 之间） |
| `apps/MusicApp.tsx` | 修改：`doSearch`（119-142）、登录 pill（189-199）、设置页（450-545）、profile 分发（552-560）、诊断按钮 |
| `apps/music/KugouLoginPanel.tsx` | 新建 |
| `apps/music/KugouProfilePage.tsx` | 新建 |
| `notes/music-app.md`、`notes/ethernet-branch-context.md`、`README.md` | 文档收尾一并改 |

**明确不碰**：`utils/musicCache.ts`（无需改）、`utils/musicWorkerUrl.test.ts`、其他 App、vps-backend、amsg worker。

## 部署与验证

1. 用户 fork KuGouMusicApi → Vercel（env `platform=lite`）→ 得到地址。
2. worker：CF 面板给 sully-proxy 配 env `KUGOU_UPSTREAMS=<vercel地址>`（或改代码常量后按 2026-09-07 的通道重新部署 worker/index.js）。
3. worker 部署后探针：`POST <worker>/kugou/search` 应返回 `status:1` + 歌曲列表；`X-Sully-Cache` HIT/MISS 生效。
4. 真机回归：酷狗登录→搜歌→播放→歌词滚动→歌单/我喜欢/每日推荐；切回网易搜「晴天」播放不回归（网易链路零改动，回归风险极低）。

## 工程护栏（沿用仓库既有约定）

- UI/动效严格延续音乐 App 现有玻璃风（`docs/design-system.md` + `apps/music/` 既有组件 SongRow/MiniPlayer/MizuHeader/shizuku-glass），不引入新视觉语言。
- 零新增 LLM 调用（计费红线）。
- 编码纪律：写文件只用 Write/Edit 工具、UTF-8 无 BOM、commit message 英文、动过含中文文件后跑 `utils/mojibakeGuard.test.ts`。
- 全量门禁：`corepack pnpm@9.15.9 vitest run` + `tsc --noEmit`（触碰文件零命中，全量 48 个存量错误不新增）。
