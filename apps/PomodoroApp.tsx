import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOS } from '../context/OSContext';
import { AppID } from '../types';
import type { CharacterProfile } from '../types';
import { DB } from '../utils/db';
import { runCallMemoryPalacePostFlow } from '../utils/memoryPalace/callPostFlow';
import {
  generateEncouragement,
  generatePunishment,
  generateReportReply,
} from '../utils/pomodoroLlm';
import type { PomodoroPunishReason } from '../utils/pomodoroLlm';
import {
  appendPomodoroHistory,
  clearSession,
  createSession,
  elapsedMs,
  formatClock,
  loadPomodoroHistory,
  loadSession,
  markEncouraged,
  markSessionAbandoned,
  markSessionCompleted,
  pauseSegment,
  remainingMs,
  resolveAwayOutcome,
  saveSession,
  scheduleNextEncouragement,
  shouldEncourage,
  startSegment,
  tickProgress,
} from '../utils/pomodoroSession';
import type { PomodoroHistoryEntry, PomodoroSession } from '../utils/pomodoroSession';
import {
  Brain,
  CaretLeft,
  ChatTeardrop,
  Check,
  Clock,
  Play,
  Sparkle,
  X,
} from '@phosphor-icons/react';

// ─── 球形水波纹 ─────────────────────────────────────────────
// SVG 圆裁剪 + 双层错相位波浪（CSS keyframes 平移），水位随进度抬升。
const WaterBall: React.FC<{ progress: number; label: string; sub: string }> = ({ progress, label, sub }) => {
  const size = 228;
  const r = 104;
  const c = size / 2;
  const p = Math.min(1, Math.max(0, progress));
  const waterY = c + r - p * r * 2;
  const wave = (dx: number, amp: number) => {
    const w = size * 2;
    return `M ${-size + dx} ${waterY} ` +
      `q ${size / 8} ${-amp} ${size / 4} 0 t ${size / 4} 0 t ${size / 4} 0 t ${size / 4} 0 ` +
      `t ${size / 4} 0 t ${size / 4} 0 t ${size / 4} 0 t ${size / 4} 0 ` +
      `L ${w} ${size + 10} L ${-size} ${size + 10} Z`;
  };
  return (
    <div className="relative mx-auto" style={{ width: size, height: size }}>
      <style>{`@keyframes pomoWaveA { from { transform: translateX(0); } to { transform: translateX(-${size / 2}px); } } @keyframes pomoWaveB { from { transform: translateX(-${size / 2}px); } to { transform: translateX(0); } }`}</style>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="block drop-shadow-xl">
        <defs>
          <clipPath id="pomo-ball-clip">
            <circle cx={c} cy={c} r={r} />
          </clipPath>
          <linearGradient id="pomo-water" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#67e8f9" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.95" />
          </linearGradient>
        </defs>
        <circle cx={c} cy={c} r={r} fill="rgba(255,255,255,0.12)" />
        <g clipPath="url(#pomo-ball-clip)">
          <rect x="0" y={waterY} width={size} height={size} fill="url(#pomo-water)" opacity="0.85" />
          <g style={{ animation: 'pomoWaveA 7s linear infinite' }}>
            <path d={wave(0, 7)} fill="rgba(255,255,255,0.35)" />
          </g>
          <g style={{ animation: 'pomoWaveB 11s linear infinite' }}>
            <path d={wave(-40, 9)} fill="rgba(255,255,255,0.22)" />
          </g>
        </g>
        <circle cx={c} cy={c} r={r} fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="3" />
        <circle cx={c} cy={c} r={r - 7} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="1.5" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <div className="text-4xl font-black tabular-nums text-white drop-shadow-lg" style={{ fontFamily: `'Space Grotesk', sans-serif` }}>{label}</div>
        <div className="mt-1 max-w-[150px] truncate text-xs font-semibold text-white/90 drop-shadow">{sub}</div>
        <div className="mt-0.5 text-[10px] tabular-nums text-white/70">{Math.floor(p * 100)}%</div>
      </div>
    </div>
  );
};

const DURATION_PRESETS = [5, 15, 25, 45, 60];

interface FinishedState {
  session: PomodoroSession;
  outcome: 'completed' | 'punished';
  punishText?: string;
  recorded: boolean;
  replyText?: string;
}

const PomodoroApp: React.FC = () => {
  const {
    characters, apiConfig, userProfile, memoryPalaceConfig,
    updateCharacter, addToast, openApp, setActiveCharacterId, closeApp,
  } = useOS();

  const [session, setSession] = useState<PomodoroSession | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [finished, setFinished] = useState<FinishedState | null>(null);
  const [history, setHistory] = useState<PomodoroHistoryEntry[]>([]);

  // setup 表单
  const [topic, setTopic] = useState('');
  const [durationMin, setDurationMin] = useState(25);
  const [customMin, setCustomMin] = useState('');
  const [charId, setCharId] = useState('');
  const [encMin, setEncMin] = useState(3);
  const [encMax, setEncMax] = useState(7);
  const [awayMin, setAwayMin] = useState(5);

  // 惩罚 / 离开弹窗
  const [punish, setPunish] = useState<{ reason: PomodoroPunishReason; text: string } | null>(null);
  const [awayInfo, setAwayInfo] = useState<{ awayMs: number } | null>(null);
  const [busy, setBusy] = useState<'encourage' | 'punish' | 'record' | null>(null);

  const sessionRef = useRef<PomodoroSession | null>(null);
  sessionRef.current = session;
  const charsRef = useRef(characters);
  charsRef.current = characters;
  const busyRef = useRef<'encourage' | 'punish' | 'record' | null>(null);
  busyRef.current = busy;
  const doneKeyRef = useRef<string | null>(null);

  const activeChar: CharacterProfile | null = useMemo(() => {
    if (!session) return null;
    return characters.find((c) => c.id === session.charId) || null;
  }, [characters, session]);

  // ─── 挂载：恢复会话（计时严格绑定界面打开） ───
  useEffect(() => {
    setHistory(loadPomodoroHistory());
    const s = loadSession();
    if (!s) return;
    const t = Date.now();
    const outcome = resolveAwayOutcome(s, t);
    if (outcome.kind === 'abandoned') {
      // 超时离开：保持冻结，弹窗让用户定夺（接受惩罚 / 继续本次）
      setSession(s);
      setAwayInfo({ awayMs: outcome.awayMs });
    } else {
      const resumed = startSegment(s, t);
      setSession(resumed);
      saveSession(resumed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── 卸载：冻结计时并记录离开时刻（离开不计入专注） ───
  useEffect(() => () => {
    const s = sessionRef.current;
    if (s && s.status === 'running') {
      saveSession(pauseSegment(s, Date.now()));
    }
  }, []);

  // 配置态：角色列表就绪后自动预选第一位（省一次点击，可手动换）
  useEffect(() => {
    if (!charId && characters.length > 0) setCharId(characters[0].id);
  }, [characters, charId]);

  // 孤儿会话：存量会话的角色已被删除 → 清理回配置态
  const clearOrphan = useCallback(() => {
    clearSession();
    setSession(null);
    setAwayInfo(null);
    setPunish(null);
  }, []);

  // ─── 1s 心跳：进度 / 完成 / 鼓励 ───
  useEffect(() => {
    if (!session || session.status !== 'running') return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [session?.sessionKey, session?.status]);

  const persist = useCallback((s: PomodoroSession | null) => {
    setSession(s);
    if (s && (s.status === 'running' || s.status === 'paused')) saveSession(s);
  }, []);

  const fireEncouragement = useCallback(async (s: PomodoroSession, t: number) => {
    if (busyRef.current) return;
    const char = charsRef.current.find((c) => c.id === s.charId);
    if (!char) return;
    setBusy('encourage');
    try {
      const text = await generateEncouragement(
        { baseUrl: apiConfig.baseUrl, apiKey: apiConfig.apiKey, model: apiConfig.model },
        char, userProfile, s, t,
      );
      const cur = sessionRef.current;
      if (cur && cur.sessionKey === s.sessionKey) persist(markEncouraged(cur, text, Date.now()));
    } catch {
      // 纯 LLM 语义：失败则本次缺席，只把下次时间顺延，避免失败热循环
      const cur = sessionRef.current;
      if (cur && cur.sessionKey === s.sessionKey) persist(scheduleNextEncouragement(cur, Date.now()));
    } finally {
      setBusy(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiConfig.baseUrl, apiConfig.apiKey, apiConfig.model]);

  // 心跳驱�����：完成判定 + 鼓励到点（严格顺序，同一 tick 只做一件事）
  useEffect(() => {
    const s = session;
    if (!s || s.status !== 'running' || finished) return;
    const t = now;
    if (tickProgress(s, t).done) {
      if (doneKeyRef.current === s.sessionKey) return;
      doneKeyRef.current = s.sessionKey;
      const done = markSessionCompleted(s, t);
      clearSession();
      setSession(null);
      setFinished({ session: done, outcome: 'completed', recorded: false });
      return;
    }
    if (shouldEncourage(s, t) && !busyRef.current) {
      void fireEncouragement(s, t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, session?.sessionKey, session?.status]);

  const startRun = useCallback(() => {
    const cleanTopic = topic.trim();
    if (!cleanTopic) { addToast('先写下这次要做的事吧', 'info'); return; }
    const targetChar = characters.find((c) => c.id === charId) || characters.find((c) => c.id === session?.charId);
    if (!targetChar) { addToast('先选一位陪伴的角色', 'info'); return; }
    const mins = customMin.trim() ? parseFloat(customMin) : durationMin;
    if (!Number.isFinite(mins) || mins < 1 || mins > 240) { addToast('时长填 1～240 分钟', 'info'); return; }
    const eMin = Math.min(Math.max(1, encMin || 3), 60);
    const eMax = Math.min(Math.max(eMin, encMax || 7), 120);
    const aMin = Math.min(Math.max(1, awayMin || 5), 60);
    const t = Date.now();
    const s = createSession({
      charId: targetChar.id,
      topic: cleanTopic,
      durationMs: Math.round(mins * 60_000),
      awayLimitMs: Math.round(aMin * 60_000),
      encourageMinMs: Math.round(eMin * 60_000),
      encourageMaxMs: Math.round(eMax * 60_000),
      now: t,
    });
    doneKeyRef.current = null;
    setFinished(null);
    setNow(t);
    persist(s);
  }, [topic, charId, characters, session?.charId, customMin, durationMin, encMin, encMax, awayMin, addToast, persist]);

  // ─── 聊天落库 + 记忆沉淀（严格顺序 await，杜绝并发打架） ───
  const recordToMemory = useCallback(async (
    s: PomodoroSession,
    outcome: 'completed' | 'punished',
    assistantText: string,
    userCard: string,
  ): Promise<string | undefined> => {
    const char = charsRef.current.find((c) => c.id === s.charId);
    if (!char) return undefined;
    setBusy('record');
    try {
      await DB.saveMessage({
        charId: char.id,
        role: 'user',
        type: 'text',
        content: userCard,
        metadata: { source: 'pomodoro', pomodoroSessionKey: s.sessionKey, pomodoroOutcome: outcome },
      } as never);
      await DB.saveMessage({
        charId: char.id,
        role: 'assistant',
        type: 'text',
        content: assistantText,
        metadata: { source: 'pomodoro', pomodoroSessionKey: s.sessionKey, pomodoroOutcome: outcome },
      } as never);
      try {
        await runCallMemoryPalacePostFlow({
          char,
          getLiveChar: () => charsRef.current.find((c) => c.id === s.charId),
          memoryPalaceConfig,
          apiConfig: { baseUrl: apiConfig.baseUrl, apiKey: apiConfig.apiKey, model: apiConfig.model },
          userName: userProfile?.name,
          updateCharacter,
        });
      } catch (e) {
        console.warn('[Pomodoro] memory post flow failed:', e);
      }
      return assistantText;
    } finally {
      setBusy(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memoryPalaceConfig, apiConfig.baseUrl, apiConfig.apiKey, apiConfig.model, userProfile?.name, updateCharacter]);

  const focusedMinOf = (s: PomodoroSession) => Math.max(1, Math.round(Math.min(elapsedMs(s, Date.now()), s.durationMs) / 60000));

  // 完成 → 记入记忆
  const handleRecordCompleted = useCallback(async () => {
    const f = finished;
    if (!f || f.recorded || busyRef.current) return;
    const char = charsRef.current.find((c) => c.id === f.session.charId);
    if (!char) return;
    setBusy('record');
    try {
      const mins = focusedMinOf(f.session);
      const userCard = `【番茄钟报告】我在${mins}分钟里专注做了「${f.session.topic}」（已完成）。`;
      const reply = await generateReportReply(
        { baseUrl: apiConfig.baseUrl, apiKey: apiConfig.apiKey, model: apiConfig.model },
        char, userProfile, f.session, 'completed',
      );
      await recordToMemory(f.session, 'completed', reply, userCard);
      appendPomodoroHistory({
        sessionKey: f.session.sessionKey, charId: char.id, charName: char.name,
        topic: f.session.topic, durationMs: f.session.durationMs,
        focusedMs: Math.min(elapsedMs(f.session, Date.now()), f.session.durationMs),
        outcome: 'completed', endedAt: Date.now(), recordedToMemory: true,
      });
      setHistory(loadPomodoroHistory());
      setFinished({ ...f, recorded: true, replyText: reply });
      addToast('已记入记忆', 'success');
    } catch {
      addToast('这次没能连上模型，回应缺席了', 'info');
    } finally {
      setBusy(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished?.session.sessionKey, finished?.recorded]);

  // 完成 → 不记入（仅 App 内历史）
  const handleSkipRecord = useCallback(() => {
    const f = finished;
    if (!f || f.recorded) return;
    const char = charsRef.current.find((c) => c.id === f.session.charId);
    appendPomodoroHistory({
      sessionKey: f.session.sessionKey, charId: f.session.charId, charName: char?.name || '',
      topic: f.session.topic, durationMs: f.session.durationMs,
      focusedMs: Math.min(elapsedMs(f.session, Date.now()), f.session.durationMs),
      outcome: f.outcome === 'completed' ? 'completed' : 'quit', endedAt: Date.now(), recordedToMemory: false,
    });
    setHistory(loadPomodoroHistory());
    setFinished({ ...f, recorded: true });
  }, [finished]);

  const goChat = useCallback((cid: string) => {
    setActiveCharacterId(cid);
    openApp(AppID.Chat);
  }, [setActiveCharacterId, openApp]);

  // ─── 提前退出 → 生成惩罚 → 弹窗 ───
  const handleQuit = useCallback(async () => {
    const s = sessionRef.current;
    if (!s || busyRef.current) return;
    const char = charsRef.current.find((c) => c.id === s.charId);
    if (!char) return;
    setBusy('punish');
    try {
      const text = await generatePunishment(
        { baseUrl: apiConfig.baseUrl, apiKey: apiConfig.apiKey, model: apiConfig.model },
        char, userProfile, pauseSegment(s, Date.now()), 'quit',
      );
      setPunish({ reason: 'quit', text });
    } catch {
      addToast('这次没能连上模型，惩罚缺席了', 'info');
    } finally {
      setBusy(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── 接受惩罚并退出（纳入记忆 + 聊天立刻能看到 char 的发言） ───
  const handleAcceptPunish = useCallback(async () => {
    const s = sessionRef.current;
    const p = punish;
    if (!s || !p || busyRef.current) return;
    const char = charsRef.current.find((c) => c.id === s.charId);
    if (!char) return;
    const mins = focusedMinOf(s);
    const reason: PomodoroPunishReason = p.reason;
    const userCard = reason === 'quit'
      ? `【番茄钟报告】我没能坚持完「${s.topic}」（专注了${mins}分钟），接受了惩罚。`
      : `【番茄钟报告】我中途离开太久，「${s.topic}」算我放弃（专注了${mins}分钟），接受了惩罚。`;
    await recordToMemory(s, 'punished', p.text, userCard);
    appendPomodoroHistory({
      sessionKey: s.sessionKey, charId: char.id, charName: char.name,
      topic: s.topic, durationMs: s.durationMs,
      focusedMs: Math.min(elapsedMs(s, Date.now()), s.durationMs),
      outcome: reason === 'quit' ? 'quit' : 'away', endedAt: Date.now(), recordedToMemory: true,
    });
    setHistory(loadPomodoroHistory());
    const snapshot = markSessionAbandoned(s);
    clearSession();
    setSession(null);
    setPunish(null);
    setAwayInfo(null);
    setFinished({ session: snapshot, outcome: 'punished', punishText: p.text, recorded: true, replyText: p.text });
    addToast('已结束，去聊天里看看 TA 的惩罚吧', 'success');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [punish?.text, punish?.reason]);

  // 超时回来 → 继续本次（离开时段不计入）
  const handleAwayContinue = useCallback(() => {
    const s = sessionRef.current;
    if (!s) { setAwayInfo(null); return; }
    const t = Date.now();
    const resumed = startSegment({ ...s, awaySince: null }, t);
    setAwayInfo(null);
    setNow(t);
    persist(resumed);
    addToast('已继续，离开的时间不计入', 'info');
  }, [persist, addToast]);

  // 超时回来 → 接受惩罚并结束
  const handleAwayAccept = useCallback(async () => {
    const s = sessionRef.current;
    if (!s || busyRef.current) return;
    const char = charsRef.current.find((c) => c.id === s.charId);
    if (!char) return;
    setBusy('punish');
    try {
      const text = await generatePunishment(
        { baseUrl: apiConfig.baseUrl, apiKey: apiConfig.apiKey, model: apiConfig.model },
        char, userProfile, s, 'away',
      );
      setPunish({ reason: 'away', text });
    } catch {
      addToast('这次没能连上模型，惩罚缺席了', 'info');
    } finally {
      setBusy(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tick = useMemo(() => (session ? tickProgress(session, now) : null), [session, now]);
  const setupChar = characters.find((c) => c.id === charId) || null;

  const quitMinutes = session ? Math.max(0, Math.floor(remainingMs(session, now) / 60000)) : 0;

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-white">
      {/* 顶栏 */}
      <div className="flex items-center gap-2 px-4 pt-4 pb-2">
        <button onClick={() => closeApp()} className="rounded-full bg-white/10 p-2 backdrop-blur transition active:scale-95" aria-label="返回">
          <CaretLeft className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-orange-300" weight="duotone" />
          <span className="text-base font-extrabold tracking-wide">番茄钟</span>
        </div>
        <div className="ml-auto text-[10px] text-white/40">打开才计时·切走暂停</div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-6">
        {/* ─── 计时态 ─── */}
        {session && activeChar && !finished && (
          <div className="animate-fade-in flex flex-col items-center">
            <div className="mt-2 rounded-full bg-white/10 px-4 py-1 text-xs font-semibold text-white/85 backdrop-blur">
              {activeChar.name} 正在陪你 · {session.topic}
            </div>
            <div className="mt-4">
              <WaterBall
                progress={tick?.progress ?? 0}
                label={formatClock(tick?.remainingMs ?? session.durationMs)}
                sub={session.topic}
              />
            </div>
            <div className="mt-3 text-xs text-white/55">
              已专注 {Math.floor(elapsedMs(session, now) / 60000)} 分钟 · 还剩约 {quitMinutes} 分钟
            </div>
            {/* 鼓励气泡（只在 App 内，不写聊天流） */}
            <div className="mt-4 flex w-full flex-col gap-2">
              {busy === 'encourage' && (
                <div className="self-start rounded-2xl rounded-tl-md bg-white/10 px-3.5 py-2 text-sm text-white/70 backdrop-blur animate-pulse">正在想怎么鼓励你…</div>
              )}
              {[...session.encouragements].slice(-3).reverse().map((e, i) => (
                <div key={`${e.at}-${i}`} className="self-start rounded-2xl rounded-tl-md border border-white/10 bg-white/10 px-3.5 py-2 text-sm leading-relaxed text-white/90 backdrop-blur">
                  <span className="mr-1.5 inline-flex items-center gap-0.5 text-[10px] font-bold text-orange-200/90"><Sparkle className="h-3 w-3" />{activeChar.name}</span>
                  {e.text}
                </div>
              ))}
            </div>
            <button
              onClick={() => void handleQuit()}
              disabled={busy !== null}
              className="mt-6 flex items-center gap-1.5 rounded-full border border-red-300/30 bg-red-500/15 px-5 py-2.5 text-sm font-bold text-red-200 backdrop-blur transition active:scale-95 disabled:opacity-40"
            >
              <X className="h-4 w-4" weight="bold" />{busy === 'punish' ? '正在想惩罚…' : '提前退出'}
            </button>
          </div>
        )}

        {session && !activeChar && !finished && characters.length > 0 && (
          <div className="animate-fade-in flex flex-col items-center pt-10 text-center">
            <div className="text-sm text-white/60">之前陪伴的角色已经不在了，这次专注先到这里吧。</div>
            <button onClick={clearOrphan} className="mt-4 rounded-full bg-white/10 px-5 py-2.5 text-sm font-bold backdrop-blur transition active:scale-95">清除本次</button>
          </div>
        )}

        {/* ─── 配置态 ─── */}
        {!session && !finished && (
          <div className="animate-fade-in flex flex-col gap-4 pt-2">
            <div className="rounded-3xl border border-white/10 bg-white/10 p-4 backdrop-blur-xl">
              <div className="mb-2 text-xs font-bold tracking-widest text-white/60">这次要做的事</div>
              <input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="比如：背 50 个单词"
                maxLength={60}
                className="w-full rounded-2xl border border-white/10 bg-black/30 px-3.5 py-2.5 text-sm text-white placeholder:text-white/30 outline-none focus:border-orange-300/50"
              />
              <div className="mb-2 mt-4 text-xs font-bold tracking-widest text-white/60">专注时长</div>
              <div className="flex flex-wrap gap-2">
                {DURATION_PRESETS.map((m) => (
                  <button
                    key={m}
                    onClick={() => { setDurationMin(m); setCustomMin(''); }}
                    className={`rounded-full px-4 py-1.5 text-sm font-bold backdrop-blur transition active:scale-95 ${!customMin && durationMin === m ? 'bg-orange-400 text-slate-950' : 'bg-white/10 text-white/80'}`}
                  >{m} 分钟</button>
                ))}
              </div>
              <input
                value={customMin}
                onChange={(e) => setCustomMin(e.target.value.replace(/[^\d.]/g, ''))}
                placeholder="自定义分钟数（1～240）"
                inputMode="decimal"
                className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-3.5 py-2.5 text-sm text-white placeholder:text-white/30 outline-none focus:border-orange-300/50"
              />
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/10 p-4 backdrop-blur-xl">
              <div className="mb-2 text-xs font-bold tracking-widest text-white/60">陪伴的角色</div>
              {characters.length === 0 && <div className="text-sm text-white/50">还没有角色，先去创建一位吧。</div>}
              <div className="flex max-h-36 flex-wrap gap-2 overflow-y-auto">
                {characters.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setCharId(c.id)}
                    className={`rounded-full px-4 py-1.5 text-sm font-bold backdrop-blur transition active:scale-95 ${charId === c.id ? 'bg-orange-400 text-slate-950' : 'bg-white/10 text-white/80'}`}
                  >{c.name}</button>
                ))}
              </div>
              <div className="mb-2 mt-4 text-xs font-bold tracking-widest text-white/60">鼓励间隔（分钟）</div>
              <div className="flex items-center gap-2">
                <input value={encMin} onChange={(e) => setEncMin(parseInt(e.target.value, 10) || 0)} inputMode="numeric" className="w-20 rounded-xl border border-white/10 bg-black/30 px-3 py-1.5 text-center text-sm outline-none" />
                <span className="text-white/40">～</span>
                <input value={encMax} onChange={(e) => setEncMax(parseInt(e.target.value, 10) || 0)} inputMode="numeric" className="w-20 rounded-xl border border-white/10 bg-black/30 px-3 py-1.5 text-center text-sm outline-none" />
                <span className="text-xs text-white/40">随机一句</span>
              </div>
              <div className="mb-2 mt-4 text-xs font-bold tracking-widest text-white/60">允许离开（分钟，超时算放弃）</div>
              <input value={awayMin} onChange={(e) => setAwayMin(parseInt(e.target.value, 10) || 0)} inputMode="numeric" className="w-20 rounded-xl border border-white/10 bg-black/30 px-3 py-1.5 text-center text-sm outline-none" />
            </div>

            <button
              onClick={startRun}
              disabled={!topic.trim() || (!charId && characters.length > 0)}
              className="flex items-center justify-center gap-2 rounded-3xl bg-gradient-to-r from-orange-400 to-rose-400 py-3.5 text-base font-black text-slate-950 shadow-lg shadow-orange-500/25 transition active:scale-[0.98] disabled:opacity-40"
            >
              <Play className="h-5 w-5" weight="fill" />开始专注
            </button>
            {setupChar && <div className="text-center text-xs text-white/45">{setupChar.name} 会陪着你，记得把这个界面开着才计时。</div>}

            {history.length > 0 && (
              <div className="rounded-3xl border border-white/10 bg-white/5 p-4 backdrop-blur-xl">
                <div className="mb-2 flex items-center gap-1.5 text-xs font-bold tracking-widest text-white/60"><Brain className="h-3.5 w-3.5" />过往记录</div>
                <div className="flex flex-col gap-1.5">
                  {history.slice(0, 8).map((h) => (
                    <div key={h.sessionKey} className="flex items-center gap-2 text-xs text-white/70">
                      <span className="flex-1 truncate">「{h.topic}」· {h.charName}</span>
                      <span className="text-white/40">{h.outcome === 'completed' ? '完成' : h.outcome === 'away' ? '离开放弃' : '提前退出'}{h.recordedToMemory ? '·已记入' : ''}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ─── 结束态 ─── */}
        {finished && (
          <div className="animate-fade-in flex flex-col items-center pt-4">
            <div className="text-5xl">{finished.outcome === 'completed' ? '🎉' : '🌧'}</div>
            <div className="mt-3 text-lg font-black">
              {finished.outcome === 'completed' ? `「${finished.session.topic}」完成了！` : '这次先到这里'}
            </div>
            <div className="mt-1 text-xs text-white/55">
              专注了约 {Math.max(1, Math.round(Math.min(elapsedMs(finished.session, Date.now()), finished.session.durationMs) / 60000))} 分钟
            </div>
            {finished.outcome === 'punished' && finished.punishText && (
              <div className="mt-4 w-full rounded-2xl rounded-tl-md border border-white/10 bg-white/10 px-3.5 py-2.5 text-sm leading-relaxed backdrop-blur">{finished.punishText}</div>
            )}
            {finished.outcome === 'completed' && !finished.recorded && (
              <div className="mt-5 w-full rounded-3xl border border-white/10 bg-white/10 p-4 backdrop-blur-xl">
                <div className="mb-3 text-center text-sm font-bold text-white/85">
                  要把这次记入 {characters.find((c) => c.id === finished.session.charId)?.name || ''} 的记忆吗？
                </div>
                <div className="flex gap-2">
                  <button onClick={() => void handleRecordCompleted()} disabled={busy !== null} className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl bg-gradient-to-r from-orange-400 to-rose-400 py-2.5 text-sm font-black text-slate-950 transition active:scale-[0.98] disabled:opacity-40">
                    <Check className="h-4 w-4" weight="bold" />{busy === 'record' ? '记录中…' : '记入记忆'}
                  </button>
                  <button onClick={handleSkipRecord} className="flex-1 rounded-2xl bg-white/10 py-2.5 text-sm font-bold text-white/80 transition active:scale-[0.98]">不用了</button>
                </div>
                <div className="mt-2 text-center text-[10px] leading-relaxed text-white/40">记入后会在聊天里留一条报告，TA 也会回应你</div>
              </div>
            )}
            {finished.recorded && (
              <div className="mt-5 flex w-full flex-col gap-2">
                {finished.replyText && finished.outcome === 'completed' && (
                  <div className="rounded-2xl rounded-tl-md border border-white/10 bg-white/10 px-3.5 py-2.5 text-sm leading-relaxed backdrop-blur">{finished.replyText}</div>
                )}
                <button onClick={() => goChat(finished.session.charId)} className="flex items-center justify-center gap-2 rounded-3xl bg-white/10 py-3 text-sm font-black backdrop-blur transition active:scale-[0.98]">
                  <ChatTeardrop className="h-4 w-4" weight="duotone" />去聊天里看看 TA
                </button>
                <button
                  onClick={() => { setFinished(null); doneKeyRef.current = null; setHistory(loadPomodoroHistory()); }}
                  className="rounded-3xl py-2 text-xs font-bold text-white/50 transition active:scale-95"
                >再来一次</button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ─── 惩罚弹窗 ─── */}
      {punish && (
        <div className="absolute inset-0 z-50 flex items-end justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => busy === null && setPunish(null)}>
          <div className="w-full rounded-3xl border border-white/15 bg-slate-900/95 p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="text-center text-base font-black text-red-200">来自 {characters.find((c) => c.id === session?.charId)?.name || ''} 的惩罚</div>
            <div className="mt-3 max-h-48 overflow-y-auto rounded-2xl bg-white/5 p-3.5 text-sm leading-relaxed text-white/90">{punish.text}</div>
            <div className="mt-4 flex gap-2">
              <button onClick={() => void handleAcceptPunish()} disabled={busy !== null} className="flex-1 rounded-2xl bg-gradient-to-r from-red-400 to-rose-500 py-2.5 text-sm font-black text-white transition active:scale-[0.98] disabled:opacity-40">
                {busy === 'record' ? '记录中…' : '接受并退出'}
              </button>
              <button onClick={() => setPunish(null)} disabled={busy !== null} className="flex-1 rounded-2xl bg-white/10 py-2.5 text-sm font-bold text-white/85 transition active:scale-[0.98]">返回继续</button>
            </div>
            <div className="mt-2 text-center text-[10px] text-white/40">接受后会记入记忆，并在聊天里留下 TA 的发言</div>
          </div>
        </div>
      )}

      {/* ─── 超时离开弹窗 ─── */}
      {awayInfo && session && !finished && (
        <div className="absolute inset-0 z-50 flex items-end justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full rounded-3xl border border-white/15 bg-slate-900/95 p-5 shadow-2xl">
            <div className="text-center text-base font-black">你离开了约 {Math.max(1, Math.round(awayInfo.awayMs / 60000))} 分钟</div>
            <div className="mt-1.5 text-center text-xs leading-relaxed text-white/60">超过了允许的离开时长，这次算中途放弃，{characters.find((c) => c.id === session.charId)?.name || ''} 想给你惩罚。</div>
            <div className="mt-4 flex gap-2">
              <button onClick={() => void handleAwayAccept()} disabled={busy !== null} className="flex-1 rounded-2xl bg-gradient-to-r from-red-400 to-rose-500 py-2.5 text-sm font-black text-white transition active:scale-[0.98] disabled:opacity-40">
                {busy === 'punish' ? '正在想惩罚…' : '接受惩��并结束'}
              </button>
              <button onClick={handleAwayContinue} className="flex-1 rounded-2xl bg-white/10 py-2.5 text-sm font-bold text-white/85 transition active:scale-[0.98]">继续本次</button>
            </div>
            <div className="mt-2 text-center text-[10px] text-white/40">继续则离开的时间不计入专注</div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PomodoroApp;