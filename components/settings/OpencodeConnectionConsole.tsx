import React, { useState } from 'react';
import {
    CaretDown,
    CheckCircle,
    DesktopTower,
    LockKey,
    SpinnerGap,
    Trash,
    WarningCircle,
} from '@phosphor-icons/react';
import {
    OpencodeAuthError,
    OpencodeNetworkError,
    clearOpencodeConnection,
    createOpencodeConnection,
    loadOpencodeConnection,
    saveOpencodeConnection,
    testOpencodeConnection,
    type OpencodeConnection,
} from '../../utils/opencodeClient';
import { classifyFetchFailure } from '../../utils/networkFailureDiagnosis';

type TestState = {
    tone: 'running' | 'ok' | 'error';
    message: string;
};

const FieldLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <label className="mb-1.5 block text-[10px] font-bold text-slate-500">
        {children}
    </label>
);

const PortToggle: React.FC<{
    checked: boolean;
    onChange: (checked: boolean) => void;
    label: string;
}> = ({ checked, onChange, label }) => (
    <label className="relative inline-flex shrink-0 cursor-pointer items-center">
        <span className="sr-only">{label}</span>
        <input
            type="checkbox"
            checked={checked}
            onChange={event => onChange(event.target.checked)}
            className="peer sr-only"
        />
        <span className="h-6 w-11 rounded-full bg-slate-200 transition-colors peer-checked:bg-emerald-500" />
        <span className="absolute left-[3px] h-[18px] w-[18px] rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-5" />
    </label>
);

const networkHint = (error: unknown, url: string): string => {
    const startedAt = Date.now();
    const kind = classifyFetchFailure({ url, method: 'GET', error, durationMs: Date.now() - startedAt });
    switch (kind) {
        case 'offline': return '手机没网：先确认 Wi-Fi / 流量可用。';
        case 'mixed-content': return 'https 页面打 http 地址被浏览器拦了：手机页用 http 打开，或给电脑配 https。';
        case 'bad-url': return '地址不合法：检查是否写全 http(s):// 与端口。';
        case 'timeout': return '连接超时：电脑关机/休眠、opencode serve 已退出，或防火墙拦了端口。';
        case 'blocked': return '请求没拿到响应：多半是 CORS（serve 起 --cors 允许手机源）或经代理时代理地址不对。';
        default: return '连接失败：确认电脑开机、serve 在跑、地址与代理填对。';
    }
};

/**
 * 终端 App 的连接配置（只连一台电脑）。
 *
 * 没有「保存」按钮：改一个字就落盘。连接参数变化后强制重新测试，
 * 测试通过前保持禁用，避免终端 App 拿着旧地址发请求。
 */
const OpencodeConnectionConsole: React.FC<{
    addToast: (message: string, type?: any) => void;
}> = ({ addToast }) => {
    const [conn, setConn] = useState<OpencodeConnection | null>(() => loadOpencodeConnection());
    const [testing, setTesting] = useState(false);
    const [testState, setTestState] = useState<TestState | null>(null);
    const [showProxy, setShowProxy] = useState(() => !!loadOpencodeConnection()?.proxyUrl?.trim());

    const persist = (next: OpencodeConnection | null) => {
        setConn(next);
        if (next) saveOpencodeConnection(next);
        else clearOpencodeConnection();
    };

    const update = (patch: Partial<OpencodeConnection>) => {
        if (!conn) return;
        const endpointChanged = ['baseUrl', 'username', 'password', 'proxyUrl', 'proxyKey'].some(key =>
            Object.prototype.hasOwnProperty.call(patch, key));
        persist({
            ...conn,
            ...patch,
            // 连接参数变了，旧的「已连通」结论作废：先禁用，测通再开。
            ...(endpointChanged ? { enabled: false } : {}),
            updatedAt: Date.now(),
        });
        if (endpointChanged) {
            setTestState({ tone: 'error', message: '连接参数已变化，请重新测试后再启用。' });
        }
    };

    const create = () => {
        persist(createOpencodeConnection('http://127.0.0.1:4096'));
        setTestState(null);
    };

    const remove = () => {
        if (!conn) return;
        if (!window.confirm(`删除「${conn.name || '我的电脑'}」的连接？\n\n本机保存的地址与密码会一并删除。`)) return;
        persist(null);
        setTestState(null);
        setShowProxy(false);
    };

    const test = async () => {
        if (!conn) return;
        if (!conn.baseUrl.trim()) {
            addToast('先填写 opencode serve 的地址', 'error');
            return;
        }
        setTesting(true);
        setTestState({ tone: 'running', message: '正在连接 opencode serve…' });
        try {
            const { version } = await testOpencodeConnection({ ...conn, baseUrl: conn.baseUrl.trim() });
            persist({ ...conn, baseUrl: conn.baseUrl.trim(), enabled: true, updatedAt: Date.now() });
            setTestState({ tone: 'ok', message: `已连通（serve v${version}），终端 App 可用。` });
            addToast('已连上你的电脑', 'success');
        } catch (error) {
            const message = error instanceof OpencodeAuthError
                ? '用户名/密码不对：检查是否与电脑上 OPENCODE_SERVER_PASSWORD 一致。'
                : error instanceof OpencodeNetworkError
                    ? networkHint(error, conn.baseUrl)
                    : 'serve 拒绝了请求：确认版本与地址（GET /global/health 应返回 healthy）。';
            setTestState({ tone: 'error', message });
        } finally {
            setTesting(false);
        }
    };

    const inputClass = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-700 outline-none transition placeholder:text-slate-300 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100';

    return (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-700">
            <header className="border-b border-emerald-100 bg-emerald-50/60 px-4 py-4">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
                            <DesktopTower size={15} className="text-emerald-600" /> 我的电脑
                        </h3>
                        <p className="mt-1 max-w-[250px] text-[10px] leading-relaxed text-slate-500">
                            连上你电脑上的 opencode，终端 App 就能远程遥控它写代码、跑命令。
                        </p>
                    </div>
                    <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${conn?.enabled ? 'bg-emerald-500' : 'border border-slate-300'}`} />
                </div>
            </header>

            {!conn ? (
                <div className="px-6 py-10 text-center">
                    <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                        <DesktopTower size={20} />
                    </div>
                    <p className="text-xs font-bold text-slate-700">还没有连接</p>
                    <p className="mt-1 text-[10px] leading-relaxed text-slate-400">电脑上先跑起 opencode serve，再回来填地址。</p>
                    <button
                        type="button"
                        onClick={create}
                        className="mt-4 rounded-xl bg-emerald-500 px-5 py-2.5 text-[10px] font-bold text-white transition-transform active:scale-[0.98]"
                    >添加我的电脑</button>
                </div>
            ) : (
                <div className="space-y-3 px-4 pb-5 pt-4">
                    <div>
                        <FieldLabel>名称</FieldLabel>
                        <input className={inputClass} value={conn.name} onChange={event => update({ name: event.target.value })} placeholder="我的电脑" />
                    </div>
                    <div>
                        <FieldLabel>opencode 地址</FieldLabel>
                        <input className={`${inputClass} font-mono`} value={conn.baseUrl} onChange={event => update({ baseUrl: event.target.value.trim() })} placeholder="http://127.0.0.1:4096" inputMode="url" />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <FieldLabel>用户名 · 可选</FieldLabel>
                            <input className={`${inputClass} font-mono`} value={conn.username || ''} onChange={event => update({ username: event.target.value.trim() })} placeholder="opencode" autoComplete="off" />
                        </div>
                        <div>
                            <FieldLabel>密码 · 可选</FieldLabel>
                            <input type="password" className={`${inputClass} font-mono`} value={conn.password || ''} onChange={event => update({ password: event.target.value })} placeholder="OPENCODE_SERVER_PASSWORD" autoComplete="new-password" />
                        </div>
                    </div>
                    <p className="-mt-1 flex items-center gap-1.5 text-[9px] leading-relaxed text-slate-400">
                        <LockKey size={12} className="shrink-0" /> 不设密码 = 局域网裸奔，只在可信网络用；出门远程请设强密码。
                    </p>

                    <details
                        className="group rounded-xl border border-dashed border-slate-200 px-3 py-2.5"
                        open={showProxy}
                        onToggle={event => setShowProxy((event.target as HTMLDetailsElement).open)}
                    >
                        <summary className="flex cursor-pointer list-none items-center gap-2 text-[10px] font-bold text-slate-500">
                            跨域代理（可选）
                            <CaretDown size={12} className="ml-auto transition-transform group-open:rotate-180" />
                        </summary>
                        <div className="mt-3 space-y-3 pb-1">
                            <div>
                                <FieldLabel>代理 URL · 留空为直连</FieldLabel>
                                <input className={`${inputClass} font-mono`} value={conn.proxyUrl || ''} onChange={event => update({ proxyUrl: event.target.value.trim() })} placeholder="http://localhost:18062 或你的 Worker" inputMode="url" />
                            </div>
                            {!!conn.proxyUrl?.trim() && (
                                <div>
                                    <FieldLabel>代理密钥 · 可选</FieldLabel>
                                    <input type="password" className={`${inputClass} font-mono`} value={conn.proxyKey || ''} onChange={event => update({ proxyKey: event.target.value.trim() })} placeholder="PROXY_KEY" autoComplete="new-password" />
                                </div>
                            )}
                            <p className="text-[9px] leading-relaxed text-slate-400">解决浏览器 CORS 拦截。代理跑在你自己电脑或你自己的 Cloudflare 账号，不经过项目方服务器。</p>
                        </div>
                    </details>

                    <div className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2.5">
                        <div className="text-[11px] font-bold">在终端 App 中启用</div>
                        <PortToggle
                            label="启用终端连接"
                            checked={conn.enabled}
                            onChange={next => {
                                if (next && testState?.tone !== 'ok') {
                                    addToast('请先测试连接，通了再启用', 'error');
                                    return;
                                }
                                update({ enabled: next });
                            }}
                        />
                    </div>

                    <div className="flex gap-2">
                        <button
                            type="button"
                            disabled={testing}
                            onClick={test}
                            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-500 py-2.5 text-[10px] font-bold text-white transition-transform active:scale-[0.98] disabled:opacity-60"
                        >
                            {testing ? <SpinnerGap size={14} className="animate-spin" /> : <CheckCircle size={14} weight="bold" />}
                            {testing ? '正在测试连接' : '测试连接'}
                        </button>
                        <button type="button" onClick={remove} className="flex w-11 items-center justify-center rounded-xl border border-rose-200 bg-white text-rose-500" aria-label="删除连接"><Trash size={15} /></button>
                    </div>

                    {testState && (
                        <div className={`flex items-start gap-2 rounded-lg px-3 py-2 text-[9px] leading-relaxed ${testState.tone === 'ok' ? 'bg-emerald-50 text-emerald-700' : testState.tone === 'running' ? 'bg-sky-50 text-sky-700' : 'bg-rose-50 text-rose-600'}`}>
                            {testState.tone === 'ok' ? <CheckCircle size={13} className="mt-0.5 shrink-0" /> : testState.tone === 'running' ? <SpinnerGap size={13} className="mt-0.5 shrink-0 animate-spin" /> : <WarningCircle size={13} className="mt-0.5 shrink-0" />}
                            <span>{testState.message}</span>
                        </div>
                    )}
                </div>
            )}

            <footer className="border-t border-slate-100 bg-slate-50/60 px-4 py-3 text-[9px] leading-relaxed text-slate-400">
                地址与密码只保存在本机。电脑端命令：设密码后跑 <span className="font-mono">OPENCODE_SERVER_PASSWORD=… opencode serve --cors &lt;手机源&gt;</span>。
            </footer>
        </div>
    );
};

export default OpencodeConnectionConsole;
