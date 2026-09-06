import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOS } from '../context/OSContext';
import { AppID } from '../types';
import type { CharacterProfile } from '../types';
import { DB } from '../utils/db';
import { useBlobRefUrl } from '../utils/blobRef';
import { runCallMemoryPalacePostFlow } from '../utils/memoryPalace/callPostFlow';
import { canSynthesizeSpeech, synthesizeSpeechDetailed } from '../utils/ttsRouter';
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
  formatMinutes,
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
  loadPomodoroPrefs,
  nextMessageMode,
  savePomodoroPrefs,
  type PomodoroMessageMode,
  type PomodoroPrefs,
} from '../utils/pomodoroPrefs';
import {
  Brain,
  CaretLeft,
  ChatTeardrop,
  Check,
  Clock,
  Gear,
  Play,
  Stop,
} from '@phosphor-icons/react';
import {
  SKETCH_INK,
  SKETCH_LINE,
  SKETCH_MUTED,
  SKETCH_PAPER,
  SketchBox,
  SketchButton,
  SketchKeyframes,
  SketchLabel,
} from './pomodoro/SketchKit';
import WaterBallSketch from './pomodoro/WaterBallSketch';
import CompanionBall, { type CompanionBubble } from './pomodoro/CompanionBall';
import PomodoroSettings from './pomodoro/PomodoroSettings';
import UsageHeatmap from './pomodoro/UsageHeatmap';

const DURATION_PRESETS = [5, 15, 25, 45, 60];

const MODE_LABEL: Record<PomodoroMessageMode, string> = {
  text: '纯文字',
  voice: '纯语音',
  mixed: '混合',
};

interface FinishedState {
  session: PomodoroSession;
  outcome: 'completed' | 'punished';
  punishText?: string;
  /** 中止结局的后台惩罚进度：loading=生成/落库中，done=已进聊天，failed=没连上 */
  punishStatus?: 'loading' | 'done' | 'failed';
  recorded: boolean;
  replyText?: string;
}

const bubbleId = () => `pomo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

const PomodoroApp: React.FC = () => {
  const {
    characters, apiConfig, userProfile, memoryPalaceConfig,
    updateCharacter, addToast, openApp, setActiveCharacterId, closeApp,
  } = useOS();

  const [session, setSession] = useState<PomodoroSession | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [finished, setFinished] = useState<FinishedState | null>(null);
  const [history, setHistory] = useState<PomodoroHistoryEntry[]>([]);

  // 纸面偏好（背景图 / 配色 / 水色 / 消息形态）
  const [prefs, setPrefs] = useState<PomodoroPrefs>(() => loadPomodoroPrefs());
  const prefsRef = useRef(prefs);
  const [showSettings, setShowSettings] = useState(false);
  const bgUrl = useBlobRefUrl(prefs.bgImage);

  // setup 表单
  const [topic, setTopic] = useState('');
  const [durationMin, setDurationMin] = useState(25);
  const [customMin, setCustomMin] = useState('');
  const [charId, setCharId] = useState('');
  const [encMin, setEncMin] = useState(3);
  const [encMax, setEncMax] = useState(7);
  const [awayMin, setAwayMin] = useState(5);

  // 停止轻确认 / 气泡 / 生成中
  const [stopConfirm, setStopConfirm] = useState(false);
  const [bubbles, setBubbles] = useState<CompanionBubble[]>([]);
  const [typing, setTyping] = useState(false);
  const [awayInfo, setAwayInfo] = useState<{ awayMs: number } | null>(null);
  const [busy, setBusy] = useState<'encourage' | 'punish' | 'record' | null>(null);

  const sessionRef = useRef<PomodoroSession | null>(null);
  sessionRef.current = session;
  const charsRef = useRef(characters);
  charsRef.current = characters;
  const busyRef = useRef<'encourage' | 'punish' | 'record' | null>(null);
  busyRef.current = busy;
  const doneKeyRef = useRef<string | null>(null);
  const voiceHintShownRef = useRef(false);

  const activeChar: CharacterProfile | null = useMemo(() => {
    if (!session) return null;
    return characters.find((c) => c.id === session.charId) || null;
  }, [characters, session]);

  const updatePrefs = useCallback((patch: Partial<PomodoroPrefs>) => {
    const next = savePomodoroPrefs(patch);
    prefsRef.current = next;
    setPrefs(next);
  }, []);

  const cycleMode = useCallback(() => {
    const next = nextMessageMode(prefsRef.current.messageMode);
    updatePrefs({ messageMode: next });
    addToast(`消息模式：${MODE_LABEL[next]}`, 'info');
  }, [updatePrefs, addToast]);

  const dismissBubble = useCallback((id: string) => {
    setBubbles((list) => list.filter((b) => b.id !== id));
  }, []);

  // ─── 挂载：恢复会话（计时严格绑定界面打开） ───
  useEffect(() => {
    setHistory(loadPomodoroHistory());
    const s = loadSession();
    if (!s) return;
    const t = Date.now();
    const outcome = resolveAwayOutcome(s, t);
    if (outcome.kind === 'abandoned') {
      // 超时离开：保持冻结，弹窗让用户定夺（就这样结束 / 继续本次）
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
    setBubbles([]);
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
    setTyping(true);
    try {
      const text = await generateEncouragement(
        { baseUrl: apiConfig.baseUrl, apiKey: apiConfig.apiKey, model: apiConfig.model },
        char, userProfile, s, t,
      );
      const cur = sessionRef.current;
      if (cur && cur.sessionKey === s.sessionKey) persist(markEncouraged(cur, text, Date.now()));
      // 按偏好决定气泡形态：混合=每句随机
      const p = prefsRef.current;
      let kind: 'text' | 'voice' =
        p.messageMode === 'voice' ? 'voice'
          : p.messageMode === 'mixed' && Math.random() < 0.5 ? 'voice' : 'text';
      let audioUrl: string | undefined;
      if (kind === 'voice') {
        try {
          if (!canSynthesizeSpeech(char, apiConfig)) throw new Error('voice-unavailable');
          const r = await synthesizeSpeechDetailed(text, char, apiConfig);
          audioUrl = r.url;
        } catch {
          kind = 'text';
          if (!voiceHintShownRef.current) {
            voiceHintShownRef.current = true;
            addToast('角色还没配好音色或语音 Key，语音先用文字代替', 'info');
          }
        }
      }
      const still = sessionRef.current;
      if (still && still.sessionKey === s.sessionKey) {
        setBubbles((list) => [...list.slice(-4), { id: bubbleId(), kind, text, audioUrl, at: Date.now() }]);
      }
    } catch {
      // 纯 LLM 语义：失败则本次缺席，只把下次时间顺延，避免失败热循环
      const cur = sessionRef.current;
      if (cur && cur.sessionKey === s.sessionKey) persist(scheduleNextEncouragement(cur, Date.now()));
    } finally {
      setBusy(null);
      setTyping(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiConfig.baseUrl, apiConfig.apiKey, apiConfig.model]);

  // 心跳驱动：完成判定 + 鼓励到点（严格顺序，同一 tick 只做一件事）
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
      setBubbles([]);
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
    setBubbles([]);
    setStopConfirm(false);
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

  // ─── 中止（停止 / 超时结束）：立即结束 + 惩罚后台生成、自动落聊天 ───
  // 界面零等待：落库续跑，即使开新局或切走也不丢（UI 层用 sessionKey 守卫）。
  const abortRun = useCallback(async (s: PomodoroSession, reason: PomodoroPunishReason) => {
    const char = charsRef.current.find((c) => c.id === s.charId);
    const t = Date.now();
    const mins = Math.max(1, Math.round(Math.min(elapsedMs(s, t), s.durationMs) / 60000));
    const userCard = reason === 'quit'
      ? `【番茄钟报告】我没能坚持完「${s.topic}」（专注了${mins}分钟），接受了惩罚。`
      : `【番茄钟报告】我中途离开太久，「${s.topic}」算我放弃（专注了${mins}分钟），接受了惩罚。`;
    const snapshot = markSessionAbandoned(pauseSegment(s, t));
    clearSession();
    setSession(null);
    setBubbles([]);
    setStopConfirm(false);
    setAwayInfo(null);
    doneKeyRef.current = null;
    const fKey = s.sessionKey;
    setFinished({ session: snapshot, outcome: 'punished', punishStatus: 'loading', recorded: false });
    setBusy('punish');
    let text: string | undefined;
    let recorded = false;
    try {
      if (char) {
        text = await generatePunishment(
          { baseUrl: apiConfig.baseUrl, apiKey: apiConfig.apiKey, model: apiConfig.model },
          char, userProfile, snapshot, reason,
        );
        await recordToMemory(s, 'punished', text, userCard);
        recorded = true;
      }
    } catch {
      text = undefined;
      recorded = false;
    } finally {
      setBusy(null);
    }
    appendPomodoroHistory({
      sessionKey: s.sessionKey, charId: s.charId, charName: char?.name || '',
      topic: s.topic, durationMs: s.durationMs,
      focusedMs: Math.min(elapsedMs(s, Date.now()), s.durationMs),
      outcome: reason, endedAt: Date.now(), recordedToMemory: recorded,
    });
    setHistory(loadPomodoroHistory());
    setFinished((f) => (f && f.session.sessionKey === fKey
      ? { ...f, punishText: text, punishStatus: text ? 'done' : 'failed', recorded, replyText: text }
      : f));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiConfig.baseUrl, apiConfig.apiKey, apiConfig.model]);

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

  const tick = useMemo(() => (session ? tickProgress(session, now) : null), [session, now]);
  const setupChar = characters.find((c) => c.id === charId) || null;

  const quitMinutes = session ? Math.max(0, Math.floor(remainingMs(session, now) / 60000)) : 0;
  const accent = prefs.accent;

  const inputCls = 'w-full px-3.5 py-2.5 text-sm outline-none';
  const inputStyle: React.CSSProperties = {
    background: SKETCH_PAPER,
    color: SKETCH_INK,
    fontFamily: "'Kaiti SC','STKaiti','KaiTi',serif",
    border: `2px dashed ${SKETCH_LINE}`,
    borderRadius: '12px 14px 13px 15px / 14px 12px 15px 13px',
  };

  return (
    <div
      className="relative flex h-full flex-col overflow-hidden"
      style={{ background: SKETCH_PAPER, color: SKETCH_INK, fontFamily: "'Kaiti SC','STKaiti','KaiTi',serif" }}
    >
      <SketchKeyframes />
      {/* 背景图 + 纸纱 */}
      {bgUrl && <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url("${bgUrl}")` }} />}
      {bgUrl && <div className="absolute inset-0" style={{ background: `rgba(245,240,232,${prefs.bgDim})` }} />}

      {/* 顶栏 */}
      <div className="relative z-10 flex items-center gap-2 px-4 pt-4 pb-2">
        <button
          onClick={() => closeApp()}
          className="p-2 transition active:scale-90"
          style={{ background: SKETCH_PAPER, border: `2px dashed ${SKETCH_INK}`, borderRadius: '48% 52% 46% 54% / 52% 48% 54% 46%' }}
          aria-label="返回"
        >
          <CaretLeft className="h-4 w-4" weight="bold" />
        </button>
        <div className="flex items-center gap-1.5">
          <Clock className="h-5 w-5" weight="duotone" style={{ color: accent }} />
          <span className="text-base font-bold tracking-widest">番茄钟</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[10px]" style={{ color: SKETCH_MUTED }}>打开才计时·切走暂停</span>
          <button
            onClick={() => setShowSettings((v) => !v)}
            className="p-2 transition active:scale-90"
            style={{
              background: showSettings ? accent : SKETCH_PAPER,
              color: showSettings ? SKETCH_PAPER : SKETCH_INK,
              border: showSettings ? `2px solid ${accent}` : `2px dashed ${SKETCH_INK}`,
              borderRadius: '52% 48% 54% 46% / 48% 52% 46% 54%',
            }}
            aria-label="纸面装扮"
          >
            <Gear className="h-4 w-4" weight="bold" />
          </button>
        </div>
      </div>

      <div className="relative z-10 flex-1 overflow-y-auto px-4 pb-6">
        {/* ─── 计时态 ─── */}
        {session && activeChar && !finished && (
          <div className="flex flex-col items-center" style={{ animation: 'skPop 160ms ease' }}>
            <div
              className="mt-2 px-4 py-1 text-xs font-bold"
              style={{ background: SKETCH_PAPER, border: `2px dashed ${accent}`, borderRadius: '255px 15px 225px 15px / 15px 225px 15px 255px' }}
            >
              {activeChar.name} 正在陪你 · {session.topic}
            </div>
            <div className="mt-4">
              <WaterBallSketch
                progress={tick?.progress ?? 0}
                label={formatClock(tick?.remainingMs ?? session.durationMs)}
                sub={session.topic}
                waterColor={prefs.waterColor}
              />
            </div>
            <div className="mt-3 text-xs" style={{ color: SKETCH_MUTED }}>
              已专注 {Math.floor(elapsedMs(session, now) / 60000)} 分钟 · 还剩约 {quitMinutes} 分钟
            </div>
            {/* 停止（含轻确认） */}
            {!stopConfirm ? (
              <SketchButton
                tone="danger"
                onClick={() => setStopConfirm(true)}
                className="mt-6 flex items-center gap-1.5 px-5 py-2.5 text-sm"
              >
                <Stop className="h-4 w-4" weight="fill" />停止
              </SketchButton>
            ) : (
              <SketchBox line={accent} style={{ marginTop: 24, padding: '12px 14px', animation: 'skPop 160ms ease' }}>
                <div className="text-center text-sm font-bold">这次就到这里？</div>
                <div className="mt-1 text-center text-[11px]" style={{ color: SKETCH_MUTED }}>TA 会有点失落，但不会拦你</div>
                <div className="mt-3 flex gap-2">
                  <SketchButton tone="danger" onClick={() => void abortRun(session, 'quit')} className="flex-1 px-4 py-2 text-sm">
                    结束
                  </SketchButton>
                  <SketchButton onClick={() => setStopConfirm(false)} className="flex-1 px-4 py-2 text-sm">
                    继续专注
                  </SketchButton>
                </div>
              </SketchBox>
            )}
            <div className="mt-2 text-[10px]" style={{ color: SKETCH_MUTED }}>点底部悬浮球可切换文字 / 语音 / 混合</div>
          </div>
        )}

        {session && !activeChar && !finished && characters.length > 0 && (
          <div className="flex flex-col items-center pt-10 text-center">
            <div className="text-sm" style={{ color: SKETCH_MUTED }}>之前陪伴的角色已经不在了，这次专注先到这里吧。</div>
            <SketchButton onClick={clearOrphan} className="mt-4 px-5 py-2.5 text-sm">清除本次</SketchButton>
          </div>
        )}

        {/* ─── 配置态 ─── */}
        {!session && !finished && (
          <div className="flex flex-col gap-4 pt-2" style={{ animation: 'skPop 160ms ease' }}>
            {showSettings && <PomodoroSettings prefs={prefs} onChange={updatePrefs} />}

            <SketchBox style={{ padding: 14 }}>
              <SketchLabel accent={accent}>这次要做的事</SketchLabel>
              <input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="比如：背 50 个单词"
                maxLength={60}
                className={`${inputCls} mt-2`}
                style={inputStyle}
              />
              <div className="mb-2 mt-4"><SketchLabel accent={accent}>专注时长</SketchLabel></div>
              <div className="flex flex-wrap gap-2">
                {DURATION_PRESETS.map((m) => (
                  <button
                    key={m}
                    onClick={() => { setDurationMin(m); setCustomMin(''); }}
                    className="px-4 py-1.5 text-sm font-bold transition active:scale-95"
                    style={
                      !customMin && durationMin === m
                        ? { background: accent, color: SKETCH_PAPER, border: `2px solid ${accent}`, borderRadius: '255px 15px 225px 15px / 15px 225px 15px 255px' }
                        : { background: SKETCH_PAPER, color: SKETCH_INK, border: `2px dashed ${SKETCH_LINE}`, borderRadius: '255px 15px 225px 15px / 15px 225px 15px 255px' }
                    }
                  >{m} 分钟</button>
                ))}
              </div>
              <input
                value={customMin}
                onChange={(e) => setCustomMin(e.target.value.replace(/[^\d.]/g, ''))}
                placeholder="自定义分钟数（1～240）"
                inputMode="decimal"
                className={`${inputCls} mt-2`}
                style={inputStyle}
              />
            </SketchBox>

            <SketchBox style={{ padding: 14 }}>
              <SketchLabel accent={accent}>陪伴的角色</SketchLabel>
              {characters.length === 0 && <div className="mt-2 text-sm" style={{ color: SKETCH_MUTED }}>还没有角色，先去创建一位吧。</div>}
              <div className="mt-2 flex max-h-36 flex-wrap gap-2 overflow-y-auto">
                {characters.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setCharId(c.id)}
                    className="px-4 py-1.5 text-sm font-bold transition active:scale-95"
                    style={
                      charId === c.id
                        ? { background: accent, color: SKETCH_PAPER, border: `2px solid ${accent}`, borderRadius: '15px 255px 15px 225px / 225px 15px 255px 15px' }
                        : { background: SKETCH_PAPER, color: SKETCH_INK, border: `2px dashed ${SKETCH_LINE}`, borderRadius: '15px 255px 15px 225px / 225px 15px 255px 15px' }
                    }
                  >{c.name}</button>
                ))}
              </div>
              <div className="mb-2 mt-4"><SketchLabel accent={accent}>鼓励间隔（分钟）</SketchLabel></div>
              <div className="flex items-center gap-2">
                <input value={encMin} onChange={(e) => setEncMin(parseInt(e.target.value, 10) || 0)} inputMode="numeric" className="w-20 px-3 py-1.5 text-center text-sm outline-none" style={inputStyle} />
                <span style={{ color: SKETCH_MUTED }}>～</span>
                <input value={encMax} onChange={(e) => setEncMax(parseInt(e.target.value, 10) || 0)} inputMode="numeric" className="w-20 px-3 py-1.5 text-center text-sm outline-none" style={inputStyle} />
                <span className="text-xs" style={{ color: SKETCH_MUTED }}>随机一句</span>
              </div>
              <div className="mb-2 mt-4"><SketchLabel accent={accent}>允许离开（分钟，超时算放弃）</SketchLabel></div>
              <input value={awayMin} onChange={(e) => setAwayMin(parseInt(e.target.value, 10) || 0)} inputMode="numeric" className="w-20 px-3 py-1.5 text-center text-sm outline-none" style={inputStyle} />
            </SketchBox>

            <SketchButton
              tone="primary"
              accent={accent}
              onClick={startRun}
              disabled={!topic.trim() || (!charId && characters.length > 0)}
              className="flex items-center justify-center gap-2 py-3.5 text-base"
              style={{ boxShadow: `4px 4px 0 ${accent}55` }}
            >
              <Play className="h-5 w-5" weight="fill" />开始专注
            </SketchButton>
            {setupChar && <div className="text-center text-xs" style={{ color: SKETCH_MUTED }}>{setupChar.name} 会陪着你，记得把这个界面开着才计时。</div>}

            <SketchBox style={{ padding: 14 }}>
              <UsageHeatmap
                history={history}
                accent={accent}
                onPickDay={(dateKey, sessions, focusedMs) => addToast(`${dateKey}：${sessions} 次 · 共 ${formatMinutes(focusedMs)} 分钟`, 'info')}
              />
            </SketchBox>

            {history.length > 0 && (
              <SketchBox style={{ padding: 14 }}>
                <div className="mb-2 flex items-center gap-1.5">
                  <Brain className="h-3.5 w-3.5" style={{ color: accent }} />
                  <SketchLabel accent={accent}>过往记录</SketchLabel>
                </div>
                <div className="flex flex-col">
                  {history.slice(0, 8).map((h) => (
                    <div key={h.sessionKey} className="flex items-center gap-2 py-1.5 text-xs" style={{ borderBottom: `1px dashed ${SKETCH_LINE}55` }}>
                      <span className="flex-1 truncate">「{h.topic}」· {h.charName}</span>
                      <span style={{ color: SKETCH_MUTED }}>{h.outcome === 'completed' ? '完成' : h.outcome === 'away' ? '离开放弃' : '提前退出'}{h.recordedToMemory ? '·已记入' : ''}</span>
                    </div>
                  ))}
                </div>
              </SketchBox>
            )}
          </div>
        )}

        {/* ─── 结束态 ─── */}
        {finished && (
          <div className="flex flex-col items-center pt-4" style={{ animation: 'skPop 160ms ease' }}>
            <div
              className="flex h-16 w-16 items-center justify-center text-2xl font-bold"
              style={{
                background: SKETCH_PAPER,
                color: accent,
                border: `2.5px dashed ${accent}`,
                borderRadius: '48% 52% 46% 54% / 52% 48% 54% 46%',
              }}
            >
              {finished.outcome === 'completed' ? '完' : '止'}
            </div>
            <div className="mt-3 text-lg font-bold">
              {finished.outcome === 'completed' ? `「${finished.session.topic}」完成了！` : '这次先到这里'}
            </div>
            <div className="mt-1 text-xs" style={{ color: SKETCH_MUTED }}>
              专注了约 {Math.max(1, Math.round(Math.min(elapsedMs(finished.session, Date.now()), finished.session.durationMs) / 60000))} 分钟
            </div>
            {finished.outcome === 'punished' && (
              <SketchBox line={accent} style={{ marginTop: 16, width: '100%', padding: '12px 14px' }}>
                <SketchLabel accent={accent}>TA 说</SketchLabel>
                {finished.punishStatus === 'loading' && (
                  <div className="mt-2 text-sm" style={{ color: SKETCH_MUTED }}>
                    <span style={{ display: 'inline-flex', gap: 3 }}>
                      {[0, 1, 2].map((i) => (
                        <span key={i} style={{ animation: `skDots 1s ${i * 0.15}s infinite` }}>•</span>
                      ))}
                    </span>
                    <span className="ml-2">TA 正在组织语言…</span>
                  </div>
                )}
                {finished.punishStatus === 'done' && finished.punishText && (
                  <div className="mt-2 text-sm leading-relaxed">{finished.punishText}</div>
                )}
                {finished.punishStatus === 'failed' && (
                  <div className="mt-2 text-sm" style={{ color: SKETCH_MUTED }}>TA 想说点什么，但这次没连上模型。</div>
                )}
                {finished.recorded && (
                  <div className="mt-2 text-[11px]" style={{ color: SKETCH_MUTED }}>已记入聊天，TA 会记得这次</div>
                )}
              </SketchBox>
            )}
            {finished.outcome === 'completed' && !finished.recorded && (
              <SketchBox style={{ marginTop: 20, width: '100%', padding: 14 }}>
                <div className="mb-3 text-center text-sm font-bold">
                  要把这次记入 {characters.find((c) => c.id === finished.session.charId)?.name || ''} 的记忆吗？
                </div>
                <div className="flex gap-2">
                  <SketchButton tone="primary" accent={accent} onClick={() => void handleRecordCompleted()} disabled={busy !== null} className="flex flex-1 items-center justify-center gap-1.5 py-2.5 text-sm">
                    <Check className="h-4 w-4" weight="bold" />{busy === 'record' ? '记录中…' : '记入记忆'}
                  </SketchButton>
                  <SketchButton onClick={handleSkipRecord} className="flex-1 py-2.5 text-sm">不用了</SketchButton>
                </div>
                <div className="mt-2 text-center text-[10px] leading-relaxed" style={{ color: SKETCH_MUTED }}>记入后会在聊天里留一条报告，TA 也会回应你</div>
              </SketchBox>
            )}
            {finished.recorded && (
              <div className="mt-5 flex w-full flex-col gap-2">
                {finished.replyText && finished.outcome === 'completed' && (
                  <SketchBox style={{ padding: '10px 14px' }}>
                    <div className="text-sm leading-relaxed">{finished.replyText}</div>
                  </SketchBox>
                )}
                <SketchButton onClick={() => goChat(finished.session.charId)} className="flex items-center justify-center gap-2 py-3 text-sm">
                  <ChatTeardrop className="h-4 w-4" weight="duotone" />去聊天里看看 TA
                </SketchButton>
                <button
                  onClick={() => { setFinished(null); doneKeyRef.current = null; setHistory(loadPomodoroHistory()); }}
                  className="py-2 text-xs font-bold transition active:scale-95"
                  style={{ color: SKETCH_MUTED }}
                >再来一次</button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 悬浮球（仅计时态） */}
      {session && activeChar && !finished && (
        <CompanionBall
          char={activeChar}
          mode={prefs.messageMode}
          accent={accent}
          bubbles={bubbles}
          typing={typing}
          onCycleMode={cycleMode}
          onDismissBubble={dismissBubble}
        />
      )}

      {/* ─── 超时离开弹窗 ─── */}
      {awayInfo && session && !finished && (
        <div className="absolute inset-0 z-50 flex items-end justify-center bg-black/40 p-4" onClick={handleAwayContinue}>
          <SketchBox style={{ width: '100%', padding: 20, animation: 'skPop 160ms ease' }} >
            <div className="text-center text-base font-bold">你离开了约 {Math.max(1, Math.round(awayInfo.awayMs / 60000))} 分钟</div>
            <div className="mt-1.5 text-center text-xs leading-relaxed" style={{ color: SKETCH_MUTED }}>超过了允许的离开时长，这次算中途放弃，{characters.find((c) => c.id === session.charId)?.name || ''} 有点失落。</div>
            <div className="mt-4 flex gap-2" onClick={(e) => e.stopPropagation()}>
              <SketchButton tone="danger" onClick={() => void abortRun(session, 'away')} className="flex-1 py-2.5 text-sm">
                就这样结束
              </SketchButton>
              <SketchButton onClick={handleAwayContinue} className="flex-1 py-2.5 text-sm">继续本次</SketchButton>
            </div>
            <div className="mt-2 text-center text-[10px]" style={{ color: SKETCH_MUTED }}>结束则立即结算，TA 的回应随后落到聊天里；继续则离开的时间不计入专注</div>
          </SketchBox>
        </div>
      )}
    </div>
  );
};

export default PomodoroApp;
