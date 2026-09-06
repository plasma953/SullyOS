import React, { useState } from 'react';
import { CheckCircle, SpinnerGap } from '@phosphor-icons/react';
import type { OpencodeConnection } from '../../types';
import {
    tuiAppendPrompt,
    tuiClearPrompt,
    tuiExecuteCommand,
    tuiOpenModels,
    tuiOpenSessions,
    tuiShowToast,
    tuiSubmitPrompt,
} from '../../utils/opencodeClient';

/** TUI 遥控 Tab：操作电脑上正在跑的那个 opencode TUI。 */
const TuiTab: React.FC<{
    conn: OpencodeConnection;
    notify: (message: string, type?: any) => void;
}> = ({ conn, notify }) => {
    const [appendText, setAppendText] = useState('');
    const [toastText, setToastText] = useState('');
    const [cmdText, setCmdText] = useState('session.new');
    const [running, setRunning] = useState<string | null>(null);

    const run = async (key: string, fn: () => Promise<unknown>, done?: string) => {
        setRunning(key);
        try {
            await fn();
            if (done) notify(done, 'success');
        } catch { notify('TUI 没反应：确认电脑上真有个 TUI 在跑', 'error'); }
        finally { setRunning(null); }
    };

    const btn = 'flex items-center justify-center gap-1.5 rounded-xl bg-slate-800 py-2.5 text-[10px] font-bold text-white transition-transform active:scale-[0.98] disabled:opacity-50';
    const input = 'min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-2 font-mono text-[11px] text-slate-700 outline-none placeholder:text-slate-300 focus:border-emerald-400';

    const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
        <div className="rounded-2xl bg-white p-3 shadow-sm">
            <p className="mb-2 text-[10px] font-bold text-slate-500">{label}</p>
            {children}
        </div>
    );

    return (
        <div className="no-scrollbar min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3 py-3">
            <p className="rounded-xl bg-rose-50 px-3 py-2 text-[9px] leading-relaxed text-rose-600">
                这里按的是<b>电脑屏幕上那个 TUI</b>，不是手机里的会话。出门前电脑保持亮屏开着 TUI，这页才有东西可遥。
            </p>

            <Row label="往 TUI 输入框写字">
                <div className="flex gap-2">
                    <input value={appendText} onChange={e => setAppendText(e.target.value)} placeholder="要预填的文字" className={input} />
                    <button type="button" disabled={running !== null || !appendText.trim()} onClick={() => void run('append', () => tuiAppendPrompt(conn, appendText))} className={`${btn} w-16 shrink-0`}>
                        {running === 'append' ? <SpinnerGap size={13} className="animate-spin" /> : '填入'}
                    </button>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                    <button type="button" disabled={running !== null} onClick={() => void run('submit', () => tuiSubmitPrompt(conn), '已提交')} className={btn}>
                        {running === 'submit' ? <SpinnerGap size={13} className="animate-spin" /> : <><CheckCircle size={13} /> 回车提交</>}
                    </button>
                    <button type="button" disabled={running !== null} onClick={() => void run('clear', () => tuiClearPrompt(conn))} className={btn}>清空输入框</button>
                </div>
            </Row>

            <Row label="TUI 命令（如 session.new / session.interrupt / prompt.submit）">
                <div className="flex gap-2">
                    <input value={cmdText} onChange={e => setCmdText(e.target.value)} placeholder="session.new" className={input} />
                    <button type="button" disabled={running !== null || !cmdText.trim()} onClick={() => void run('exec', () => tuiExecuteCommand(conn, cmdText.trim()), '已执行')} className={`${btn} w-16 shrink-0`}>
                        {running === 'exec' ? <SpinnerGap size={13} className="animate-spin" /> : '执行'}
                    </button>
                </div>
            </Row>

            <Row label="电脑右下角弹条消息">
                <div className="flex gap-2">
                    <input value={toastText} onChange={e => setToastText(e.target.value)} placeholder="提醒自己…" className={input} />
                    <button type="button" disabled={running !== null || !toastText.trim()} onClick={() => void run('toast', () => tuiShowToast(conn, toastText.trim()), '已弹出')} className={`${btn} w-16 shrink-0`}>
                        {running === 'toast' ? <SpinnerGap size={13} className="animate-spin" /> : '弹出'}
                    </button>
                </div>
            </Row>

            <Row label="打开 TUI 面板">
                <div className="grid grid-cols-2 gap-2">
                    <button type="button" disabled={running !== null} onClick={() => void run('sessions', () => tuiOpenSessions(conn))} className={btn}>会话选择器</button>
                    <button type="button" disabled={running !== null} onClick={() => void run('models', () => tuiOpenModels(conn))} className={btn}>模型选择器</button>
                </div>
            </Row>
        </div>
    );
};

export default TuiTab;
