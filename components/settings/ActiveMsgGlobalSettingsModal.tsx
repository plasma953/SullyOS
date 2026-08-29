import React, { useEffect, useRef, useState } from 'react';
import Modal from '../os/Modal';
import { ActiveMsg2GlobalConfig, RealtimeConfig } from '../../types';
import { isAmsgServerVersionAtLeast } from '../../utils/amsgWorkerVersion';
import {
  ActiveMsgClient, ActiveMsg2PushStatus, fetchWorkerDiagnostics, readAmsgFailKind,
} from '../../utils/activeMsgClient';
import {
  AmsgDiagnosticLevel, AmsgDiagnosticsProbe,
  buildAmsgDiagnosticRows, summarizeAmsgDiagnostics,
  INSTANT_CHAT_BLOCKER_HINTS, resolveInstantChatBlocker,
  type InstantChatGateInput,
} from '../../utils/amsgDiagnostics';
import { ActiveMsgStore, maskActiveMsgUserId } from '../../utils/activeMsgStore';
import { cancelAllRemoteAmsgTasks, isWorkerUrlCleared, wipeAmsgCloudData } from '../../utils/amsgStateSync';
import {
  isInstantConfigReady,
  loadInstantConfig,
  saveInstantConfig,
} from '../../utils/instantPushClient';
import { trackEvent } from '../../utils/analytics';

// 主动消息的后端自 VPS 迁移完成后即由 VPS 宿主统一承载：前端默认指向
// 官方 VPS 端点，普通用户填一个用户 ID 就能用，不再有「自部署 Worker」这一步。
// 想自建的用户仍可把地址换成自己的实例（协议与原 amsg worker 完全一致）。
const DEFAULT_VPS_WORKER_URL = 'https://43451695.xyz/amsg';
const DEFAULT_VPS_SERVER_TOKEN = '2857e95a07e0b728b3dce8d8ce84f5e090f05d5699a73fd617d2b9f608dd72c6';
// 版本门槛：旧版 amsg 后端会静默缺席新特性（自述回写不落盘、任务重复推、时区错位等），
// 不比版本的话问题全在后端侧静默发生。官方 VPS 由宿主统一升级，普通用户无感；
// 自建实例停在旧版时，体检区会亮出升级提示。
const REQUIRED_WORKER_VERSION = '2.6.0-next.23';
const REQUIRED_WORKER_FEATURES = [
  'client-state',
  'client-state-chunking',
  'agentic-hooks',
  'agentic-scratch',
  // 后台 fire 每轮把 tools 参数带给 LLM（角色在主动消息里用得上用户自配的 MCP 工具）。
  'agentic-fire-tools',
  // hook 载荷自带 readState / writeState，配置级 hook 不用再自己攒一份写口。
  'hook-state-accessors',
  // onAfterSend 拿到本次 fire 的 scratch：自述回写按真正送出去的段数落账。
  'after-send-scratch',
  // 任务身份直接挂在 ctx 和 push 顶层，两条排程路径不用各抄一份 metadata。
  'fire-task-identity',
  'push-task-identity',
  // 库导出信封余量常量，push 体积按「库补完字段之后」的尺寸算。
  'push-envelope-reserved-bytes',
  // 角色自排撞车时回已存在那行的投影，重跑那轮也记得下账。
  'schedule-task-duplicate-row',
  // 循环任务的过期快进也回调，攒下的那几次跳过在面板上看得见。
  'recurring-stale-skip-hook',
  // 任务行带时区，daily / weekly 按角色所在时区的墙钟推进。
  'task-timezone',
  // 推送订阅按用户存一份，排程不再携带；换订阅后已排的任务自动跟上。
  'user-push-subscription',
  // 凭据存成表里的一行、任务只带引用（credRefs）。换 Key 只要覆盖那一行，已排的任务
  // ——包括角色在触发时给自己排的那些——下次触发就用新凭据。缺了它就退回「凭据冻结
  // 进每条任务」的老路：换 Key 要逐条补刷，漏一条到点就是 401。
  'llm-credentials',
];

// 体检每一行的配色与那一列小字。unknown 用灰：查不出结论时别拿颜色暗示好坏。
const DIAGNOSTIC_STYLES: Record<AmsgDiagnosticLevel, { dot: string; text: string; word: string }> = {
  ok: { dot: 'bg-emerald-500', text: 'text-emerald-600', word: '正常' },
  warn: { dot: 'bg-amber-500', text: 'text-amber-600', word: '注意' },
  bad: { dot: 'bg-rose-500', text: 'text-rose-600', word: '有问题' },
  unknown: { dot: 'bg-slate-300', text: 'text-slate-400', word: '查不到' },
};
/** 刚生成的密钥明文：输入框是 password 型，只能在这一处让用户看见并手动复制。 */
const SecretReveal: React.FC<{ value: string; className?: string }> = ({ value, className = '' }) => (
  <p className={`font-mono text-[10px] leading-relaxed text-slate-500 break-all bg-white border border-slate-200 rounded-xl px-2 py-1.5 ${className}`}>
    {value}
  </p>
);
interface ActiveMsgGlobalSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  /** 「清空云端数据」清完要立刻把工具凭据补传回去，所以这里需要当前这份配置。 */
  realtimeConfig: RealtimeConfig;
}

const ActiveMsgGlobalSettingsModal: React.FC<ActiveMsgGlobalSettingsModalProps> = ({
  isOpen,
  onClose,
  addToast,
  realtimeConfig,
}) => {
  const [config, setConfig] = useState<ActiveMsg2GlobalConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [pushStatus, setPushStatus] = useState<ActiveMsg2PushStatus | null>(null);
  // 体检：后端的 GET /debug 结果。它把「缺哪个变量、缺哪张表、缺哪几列、cron
  // 有没有停」都算好了。存原始探测结果，红绿灯在渲染时算（推送状态一变就跟着走）。
  const [diagnosticsProbe, setDiagnosticsProbe] = useState<AmsgDiagnosticsProbe | null>(null);
  const [diagnosing, setDiagnosing] = useState(false);
  // 体检摆在最上面，但默认收着：装好之后它天天是「都正常」，摊开占掉半屏。
  // 标题那一行已经把结论说了，要看是哪一项才需要点开。
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  // amsg2 之外旧版 Instant Push 若还开着，聊天会走它，2.0 挂在本地那条路上的几样东西全静默失效——设置页
  // 两道双向门通常已经拦住这种组合，这里读一次是给漏网脏配置兜底，关掉后立刻更新。
  const [instantOn, setInstantOn] = useState(false);
  // 这台后端认不认 /instant-chat。即时对话的**唯一**版本门槛就在这儿，
  // 别处不做逐调用预检——每发一条消息多探一次网络，探失败还分不清是旧版还是网抖。
  const [instantChatSupported, setInstantChatSupported] = useState(false);
  // 后端版本过旧（缺特性或版本号低于门槛）时亮牌。探测失败（断网等）不亮，避免误报。
  const [serverOutdated, setServerOutdated] = useState(false);
  // 探测结果每次会话只报一次。refresh() 在开面板、连接成功、订阅成功后都会跑一遍，一个
  // 连不上、反复点「连接」的人否则能一个人刷出十几条同样的结果，把分布带歪。
  const workerCapsReported = useRef(false);
  // 「即时对话开不了卡在哪」同样每次会话只报一次，理由同上。
  const instantChatGateReported = useRef(false);
  // 已经存过盘的那个后端地址。清空确认要用它：确认之前不能换地址，
  // 取消远端任务的那几个请求还得发到旧那台上去。
  const savedWorkerUrlRef = useRef('');

  /**
   * 拉一次体检。没填地址时不拉——那时候唯一该做的事是把地址填上，
   * 摆一排红灯只会让人以为哪儿坏了。
   */
  const runDiagnostics = async () => {
    setDiagnosing(true);
    try {
      setDiagnosticsProbe(await fetchWorkerDiagnostics());
    } finally {
      setDiagnosing(false);
    }
  };

  /**
   * 报一次「即时对话此刻能不能开、开不了卡在哪」。
   *
   * 这一格只能在这儿收：开关灰着的时候用户什么都点不动，也就不会产生任何别的事件——
   * 光看配置快照里那个开/关，被挡在门外的人和「不想要这功能的人」长得一模一样。
   * 判定跟界面上那行黄字共用 resolveInstantChatBlocker，两处不会各说各话。
   */
  const reportInstantChatGate = (gate: InstantChatGateInput, enabled: boolean) => {
    if (instantChatGateReported.current) return;
    instantChatGateReported.current = true;
    trackEvent('即时对话能不能开', {
      result: resolveInstantChatBlocker(gate) ?? '可以开',
      // 已经开着的人也报：他们卡住意味着「开的时候好好的，后来 Worker 退回旧版了」，那是一种发一条挂一条、但设置页还写着「已开启」的坏法。
      state: enabled ? '已开着' : '还没开',
    });
  };

  /**
   * 版本门槛探测（VPS 化后的等价守卫）：旧版后端会静默缺席新特性，用户不会来报，
   * 这条提示是唯一出口。官方 VPS 升级后无需用户操作；自建实例停在旧版时亮牌。
   */
  const probeServerVersion = async () => {
    const shouldReport = !workerCapsReported.current;
    if (shouldReport) workerCapsReported.current = true;
    try {
      const caps = await ActiveMsgClient.getCapabilities();
      const missingFeature = !caps || REQUIRED_WORKER_FEATURES.some((f) => !caps.features.includes(f));
      const versionTooOld = !caps || !isAmsgServerVersionAtLeast(caps.serverVersion, REQUIRED_WORKER_VERSION);
      setServerOutdated(missingFeature || versionTooOld);
      if (shouldReport) {
        trackEvent('探测 2.0 后端能力', {
          result: !caps ? '端点不存在' : missingFeature ? '缺特性' : versionTooOld ? '版本过旧' : 'ok',
        });
      }
    } catch {
      // 探测炸了（断网 / 地址不通）不亮牌免误报；它与「版本旧」是两回事。
      setServerOutdated(false);
      if (shouldReport) trackEvent('探测 2.0 后端能力', { result: '探测失败' });
    }
  };
  const refresh = async () => {
    const nextConfig = await ActiveMsgClient.getGlobalConfig();
    const nextPushStatus = await ActiveMsgClient.getPushStatus();
    savedWorkerUrlRef.current = nextConfig.workerUrl || '';
    setConfig(nextConfig);
    setPushStatus(nextPushStatus);
    setInstantOn(isInstantConfigReady());
    if (nextConfig.workerUrl?.trim()) {
      void ActiveMsgClient.probeInstantChatSupport().then((supported) => {
        setInstantChatSupported(supported);
        reportInstantChatGate({
          connected: Boolean(nextConfig.initializedAt),
          pushSubscribed: Boolean(nextPushStatus?.hasSubscription),
          workerSupportsInstantChat: supported,
          instantPushOn: isInstantConfigReady(),
        }, Boolean(nextConfig.instantChatEnabled));
      });
      void runDiagnostics();
      void probeServerVersion();
    } else {
      setInstantChatSupported(false);
      setDiagnosticsProbe(null);
    }
  };
  /** 关掉旧版 Instant Push 的开关，后端地址等配置留着——存量用户的运行时兜底，以后不用重填。 */
  const disableInstantPush = () => {
    saveInstantConfig({ ...loadInstantConfig(), enabled: false });
    setInstantOn(false);
    addToast('已关闭旧版 Instant Push，聊天回到本地直连。', 'success');
  };
  useEffect(() => {
    if (!isOpen) return;
    setAdvancedOpen(false);
    setDiagnosticsOpen(false);
    void refresh();
  }, [isOpen]);
  /**
   * 地址被清空时的收尾：先问一句，再拿**旧地址**把远端任务取消干净，最后才存空值。
   *
   * 光存空值的话，前端这边所有同步立刻停摆，云端里的任务却一条没少：cron 每分钟照常
   * 消费、照烧 LLM、照推送（推送订阅也还在），只是内容永远停在最后一次同步的样子。
   * 用户以为自己关掉了一切，实际只是把自己变成了看不见的那一方。
   */
  const confirmAndClearRemote = async (): Promise<boolean> => {
    const ok = confirm('清空后端地址会把远端还挂着的主动消息任务一并取消，确定吗？\n\n不取消的话，那些任务仍会按时触发并给你推送，而这边已经管不到它们了。');
    if (!ok) return false;
    const { total, failed, listed } = await cancelAllRemoteAmsgTasks();
    if (!listed) {
      addToast('远端任务没能取消，可能还挂在那儿照常触发。建议把地址填回去，到角色的主动消息面板里逐个处理。', 'error');
    } else if (failed > 0) {
      addToast(`还有 ${failed} 个远端任务取消失败，建议恢复地址后在面板处理。`, 'error');
    } else if (total > 0) {
      addToast(`已取消远端 ${total} 个任务。`, 'info');
    }
    return true;
  };
  const persistGlobalConfig = async () => {
    if (!config) return;
    if (isWorkerUrlCleared(savedWorkerUrlRef.current, config.workerUrl)) {
      if (!await confirmAndClearRemote()) {
        // 用户反悔：把地址填回输入框，别留一个「界面空着、库里还存着」的错位。
        patchConfig({ workerUrl: savedWorkerUrlRef.current });
        return;
      }
    }
    await ActiveMsgStore.saveGlobalConfig({
      workerUrl: config.workerUrl,
      serverToken: config.serverToken,
      instantChatEnabled: config.instantChatEnabled,
      masterKey: config.masterKey,
    });
    savedWorkerUrlRef.current = config.workerUrl || '';
  };
  useEffect(() => {
    if (!isOpen || !config) return;
    const timer = setTimeout(() => { void persistGlobalConfig(); }, 1000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.workerUrl, config?.serverToken, isOpen]);
  const patchConfig = (updates: Partial<ActiveMsg2GlobalConfig>) => {
    setConfig((prev) => ({
      ...(prev || { userId: '', workerUrl: '' }),
      ...updates,
    }));
  };
  const handleCreateSubscription = async () => {
    setLoading(true);
    try {
      // 建完浏览器订阅还要登记到后端上那一份用户级订阅——后端到点读的是它，
      // 只在浏览器建订阅的话云端仍是空的，到点会抛 PUSH_SUBSCRIPTION_MISSING，
      // 而这句 toast 已经报了「准备完成」。
      await ActiveMsgClient.registerPushSubscription();
      await refresh();
      addToast('通知权限和推送订阅已准备完成。', 'success');
      trackEvent('开启通知与推送订阅', { result: 'ok' });
    } catch (error: any) {
      addToast(error?.message || '创建推送订阅失败。', 'error');
      // 只报抛错那一刻挂上的代号（源码里写死的枚举）。错误原文可能带 push endpoint，
      // 留在 toast 和 console 里，不进上报。
      trackEvent('开启通知与推送订阅', { result: readAmsgFailKind(error) });
    } finally {
      setLoading(false);
    }
  };
  const handleConnect = async () => {
    if (!config?.workerUrl.trim()) {
      addToast('先把后端地址填进来。', 'error');
      return;
    }
    setLoading(true);
    try {
      await ActiveMsgStore.saveGlobalConfig({
        workerUrl: config.workerUrl,
        serverToken: config.serverToken,
        instantChatEnabled: config.instantChatEnabled,
      });
      const { warnings } = await ActiveMsgClient.connect();
      await refresh();
      addToast('已连接成功，主动消息可以用了。', 'success');
      // 连上了但有一块是哑的（最典型是推送通道没通：任务建得成、到点一条都推不出去，
      // 而界面上没有任何异常）。这类问题用户自己发现不了，连接这一刻不说就没人说了。
      warnings.forEach((warning) => addToast(warning.message, 'info'));
      // 只报「这次连接成没成 / 卡在哪一类」。连接串 / tenantToken / 错误原文一概不带。
      trackEvent('连接并启用主动消息 2.0', { result: 'ok' });
    } catch (error: any) {
      addToast(error?.message || '连接失败。', 'error');
      trackEvent('连接并启用主动消息 2.0', { result: readAmsgFailKind(error) });
    } finally {
      setLoading(false);
    }
  };
  const handleWipeCloudData = async () => {
    if (!confirm(
      '确定清空云端数据？后端数据库里属于你的这几样会一起删掉：\n\n'
      + '· 已排程的主动消息任务（含角色自己排的）\n'
      + '· 同步上去的角色上下文与工具凭据\n'
      + '· 登记的 API 凭据\n'
      + '· 推送订阅登记\n\n'
      + '任务删了要重新排。角色上下文下次聊天会自动传回去，API 凭据下次排程/发消息时重新登记，'
      + '工具凭据和推送订阅当场就补登记。'
    )) return;
    setLoading(true);
    try {
      const result = await wipeAmsgCloudData(realtimeConfig, {
        pushRegistered: Boolean(pushStatus?.hasSubscription),
      });
      // 没清干净的地方逐条说明白：这个按钮多半是在「云端数据已经出问题」时点的，
      // 含糊一句「部分失败」会让人不知道下一步该干嘛。
      const problems: string[] = [];
      if (!result.tasks.listed) {
        problems.push('任务清单读不出来（换过主密钥的话旧任务解不开就会这样），这些任务到点会失败，后端会在 7 天后自动清掉它们');
      } else if (result.tasks.failed > 0) {
        problems.push(`${result.tasks.failed} 个任务没取消成功，建议到角色的主动消息面板里逐个处理`);
      }
      if (result.stateDeleted === null) {
        problems.push('角色上下文没能删掉');
      } else if (!result.toolConfigRestored) {
        problems.push('工具凭据没能补传回去，请到「实时感知」里重新保存一次配置，否则已排程的 AI 任务会一直失败');
      }
      if (result.llmCredentialsDeleted === null) {
        problems.push('登记的 API 凭据没能删掉（后端版本较旧的话本来就没有这一项）');
      }
      if (result.push === 'failed') {
        problems.push('推送订阅没能收拾干净，建议到上面的推送区域重新订阅一次');
      }

      if (problems.length > 0) {
        addToast(`云端数据没能全部清干净：${problems.join('；')}。`, 'error');
      } else {
        const done = [
          `任务 ${result.tasks.total} 个`,
          `状态 ${result.stateDeleted} 条`,
          `API 凭据 ${result.llmCredentialsDeleted} 行`,
        ];
        if (result.push === 'reregistered') done.push('推送订阅已重新登记');
        addToast(`已清空云端数据（${done.join('、')}）。`, 'success');
      }
    } catch (error: any) {
      addToast(error?.message || '清空云端数据失败。', 'error');
    } finally {
      setLoading(false);
      void refresh();
    }
  };
  /**
   * 开关即时对话。直接落盘而不是走那条 1 秒去抖的自动保存：开关是一次明确的动作，
   * 点完立刻生效（下一条消息就按新路走），而不是「点完还得等一下」。
   */
  const handleToggleInstantChat = async () => {
    const next = !config?.instantChatEnabled;
    // 开了又关是这条路上最值钱的信号：能开、开过、然后放弃了，跟「压根没开」不是一回事。
    trackEvent('切换即时对话', { action: next ? '开' : '关' });
    patchConfig({ instantChatEnabled: next });
    await ActiveMsgStore.saveGlobalConfig({ instantChatEnabled: next });
    addToast(next ? '已开启即时对话，之后的聊天在你的后端上生成。' : '已关闭即时对话，聊天回到本地生成。', 'success');
  };
  if (!config) return null;
  const isConnected = Boolean(config.initializedAt);
  // 体检：探测结果 + 「这台设备订阅了没」这个只有前端知道的事实，红绿灯判定全在
  // amsgDiagnostics 那份纯函数里（那边有回归测试钉着）。
  const diagnosticRows = diagnosticsProbe
    ? buildAmsgDiagnosticRows({
      probe: diagnosticsProbe,
      localPushSubscribed: Boolean(pushStatus?.hasSubscription),
    })
    : [];
  const diagnosticLevel = diagnosticRows.length ? summarizeAmsgDiagnostics(diagnosticRows) : 'unknown';
  const instantChatBlocker = resolveInstantChatBlocker({
    connected: isConnected,
    pushSubscribed: Boolean(pushStatus?.hasSubscription),
    workerSupportsInstantChat: instantChatSupported,
    instantPushOn: instantOn,
  });
  const instantChatBlockedReason = instantChatBlocker ? INSTANT_CHAT_BLOCKER_HINTS[instantChatBlocker] : '';
  return (
    <Modal
      isOpen={isOpen}
      title="主动消息"
      onClose={onClose}
      footer={(
        <button
          onClick={onClose}
          className="flex-1 py-3 bg-slate-100 text-slate-500 font-bold rounded-2xl active:scale-95 transition-transform"
        >
          关闭
        </button>
      )}
    >
      <div className="space-y-4 text-sm text-slate-600">
        {/* 体检。主动消息坏掉的那几种方式在界面上全是隐形的：表结构是旧的、推送通道断了、
            云端没登记收件设备——任务照建、面板照常，就是一条都不发。后端的 /debug 一直
            算得出这些，这里只是把它摆到看得见的地方。 */}
        {config.workerUrl?.trim() ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
            {/* 收着时那句「都正常 / 有问题」就是全部结论，逐项细节点开再看。 */}
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setDiagnosticsOpen((prev) => !prev)}
                className="flex-1 flex items-center justify-between gap-2 text-left"
              >
                <span className="flex items-center gap-2">
                  <span className="font-bold text-slate-700">体检</span>
                  {diagnosticRows.length ? (
                    <span className={`text-xs font-bold ${DIAGNOSTIC_STYLES[diagnosticLevel].text}`}>
                      {diagnosticLevel === 'ok' ? '都正常' : diagnosticLevel === 'bad' ? '有问题' : diagnosticLevel === 'warn' ? '有提醒' : '查不全'}
                    </span>
                  ) : null}
                </span>
                <span className="text-xs font-bold text-slate-400">{diagnosticsOpen ? '收起' : '展开'}</span>
              </button>
              {diagnosticsOpen ? (
                <button
                  type="button"
                  onClick={() => void runDiagnostics()}
                  disabled={diagnosing}
                  className="shrink-0 px-3 py-1.5 text-[11px] rounded-xl font-bold bg-white border border-slate-200 text-slate-600 active:scale-95 transition-transform disabled:opacity-50"
                >
                  {diagnosing ? '检查中…' : '重新检查'}
                </button>
              ) : null}
            </div>
            {!diagnosticsOpen ? null : diagnosticRows.length ? (
              <div className="space-y-2">
                {diagnosticRows.map((row) => {
                  const style = DIAGNOSTIC_STYLES[row.level];
                  return (
                    <div key={row.key}>
                      <div className="flex items-center gap-2">
                        <span className={`shrink-0 w-1.5 h-1.5 rounded-full ${style.dot}`} />
                        <span className="flex-1 text-xs font-bold text-slate-600">{row.label}</span>
                        <span className={`shrink-0 text-[11px] font-bold ${style.text}`}>{style.word}</span>
                      </div>
                      {/* 正常的行不展开说明：全绿时这一列要短到能一眼扫完。 */}
                      {row.level === 'ok' ? null : (
                        <p className="mt-1 pl-3.5 text-[11px] leading-relaxed text-slate-500 whitespace-pre-line">
                          {row.detail}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs leading-relaxed text-slate-400">
                {diagnosing ? '正在问后端…' : '还没有结果，点右上角检查一次。'}
              </p>
            )}
          </div>
        ) : null}
        {/* 正常情况下两道双向门会拦住「两个都开」，能走到这儿全是脏配置遗留。
            脏配置照样会让聊天悄悄走 Instant，2.0 挂在本地那条路上的东西全静默失效——
            没有报错也没有提示，只会表现成「这功能怎么不响」，这张卡就是收拾它的入口。 */}
        {instantOn ? (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-2">
            <div className="font-bold text-amber-900 text-sm">旧版 Instant Push 还开着</div>
            <p className="text-xs leading-relaxed text-amber-800">
              检测到旧版 Instant Push 还开着。即时对话已经覆盖了它的能力（发完就自由、云端跑工具、断网补收），两条路只能留一条。点下面把旧版关掉，聊天就交给主动消息。
            </p>
            <button
              type="button"
              onClick={disableInstantPush}
              className="w-full py-2.5 bg-amber-500 text-white text-xs font-bold rounded-xl active:scale-95 transition-transform"
            >
              关掉旧版 Instant Push（保留它的配置）
            </button>
          </div>
        ) : null}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <span className="font-bold text-slate-700">当前状态</span>
            <span className={`text-xs font-bold ${isConnected ? 'text-emerald-600' : 'text-amber-600'}`}>
              {isConnected ? '已连接' : '未连接'}
            </span>
          </div>
          {serverOutdated ? (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 text-xs leading-relaxed text-amber-700">
              后端跑的还是旧版代码，缺少新特性（大上下文云端存储、服务端工具循环等）。
              官方 VPS 会自动保持最新；若你把地址换成了自建实例，请把它升级到
              <strong> amsg-server {REQUIRED_WORKER_VERSION}</strong> 或以上。已有数据和任务不受影响。
            </div>
          ) : null}
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block pl-1">
              后端地址（VPS）
            </label>
            <input
              type="text"
              value={config.workerUrl}
              onChange={(event) => patchConfig({ workerUrl: event.target.value })}
              placeholder={DEFAULT_VPS_WORKER_URL}
              className="w-full bg-white/70 border border-slate-200 rounded-2xl px-4 py-3 text-xs font-mono"
            />
            <p className="mt-1.5 text-[11px] text-slate-400">
              默认指向官方 VPS 后端，一般不用改。想自建的话，任何实现同套 amsg 协议的地址都能填。
            </p>
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block pl-1">
              共享密钥
            </label>
            <div className="flex gap-2">
              <input
                type="password"
                value={config.serverToken || ''}
                onChange={(event) => patchConfig({ serverToken: event.target.value })}
                placeholder={DEFAULT_VPS_SERVER_TOKEN}
                className="flex-1 bg-white/70 border border-slate-200 rounded-2xl px-4 py-3 text-sm"
              />
            </div>
            <p className="mt-1.5 text-[11px] text-slate-400">
              官方后端的默认密钥已填好；自建实例才需要换成你自己的。
            </p>
          </div>
          <button
            onClick={handleConnect}
            disabled={loading}
            className="w-full py-3 bg-slate-900 text-white font-bold rounded-2xl active:scale-95 transition-transform disabled:opacity-50"
          >
            {loading ? '处理中...' : isConnected ? '重新连接并验证' : '连接并启用'}
          </button>
          <p className="text-xs leading-relaxed text-slate-500">
            「连接」会自动在后端把表建好（幂等，重复点没关系），不用手动执行 SQL。
          </p>
        </div>
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <span className="font-bold text-slate-700">
              {pushStatus?.transport === 'unified-push' ? 'UnifiedPush 通知' : '通知权限'}
            </span>
            <span className={`text-xs font-bold ${pushStatus?.hasSubscription ? 'text-emerald-600' : 'text-amber-600'}`}>
              {pushStatus?.hasSubscription ? '已开启' : '未开启'}
            </span>
          </div>
          <p className="text-xs leading-relaxed text-slate-500">
            这是第二步。只有你真的想让角色在后台主动推送消息时，才需要点。
          </p>
          {pushStatus?.transport === 'unified-push' ? (
            <p className="text-xs leading-relaxed text-slate-500">
              Android App 通过开放的 UnifiedPush 收消息，不依赖 Firebase 或 Google 服务。
              ntfy 只负责在后台唤醒本 App，后端仍是你连接的那一台。
            </p>
          ) : (
            <p className="text-xs leading-relaxed text-slate-500">
              推送跟着「排程时所在的设备」走：每条任务到点后，推给保存这条排程时用的那台设备。
              换了设备（或者换了浏览器）之后，在新设备上把排程重新保存一次，之后的推送就发到这台。
            </p>
          )}
          {pushStatus?.needsDistributor ? (
            <a
              href="https://docs.ntfy.sh/subscribe/phone/"
              target="_blank"
              rel="noreferrer"
              className="block text-xs font-bold text-violet-600 underline"
            >
              安装并打开 ntfy（选择无 Firebase 版本）
            </a>
          ) : null}
          {pushStatus?.detail ? (
            <p className="text-xs leading-relaxed text-amber-600">{pushStatus.detail}</p>
          ) : null}
          <button
            onClick={handleCreateSubscription}
            disabled={loading}
            className="w-full py-3 bg-violet-500 text-white font-bold rounded-2xl active:scale-95 transition-transform disabled:opacity-50"
          >
            {loading ? '处理中...' : pushStatus?.transport === 'unified-push' ? '连接 ntfy 并开启通知' : '开启通知与推送'}
          </button>
        </div>
        {/* 即时对话：聊天本身也交给云端跑。四道门缺一不可，缺哪道就把哪道写出来——
            置灰而不说原因的话，用户只会反复点它。 */}
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <span className="font-bold text-slate-700">即时对话</span>
            {/* 开着但有门没过时不能只写「已开启」——那几道门是真的会让这一轮走本地生成的，
                标成绿色的「已开启」就是在骗人：用户以为聊天在云端跑，实际一直在本地。 */}
            <span className={`text-xs font-bold ${
              !config.instantChatEnabled ? 'text-slate-400'
                : instantChatBlockedReason ? 'text-amber-600' : 'text-emerald-600'
            }`}>
              {!config.instantChatEnabled ? '未开启'
                : instantChatBlockedReason ? '已开启 · 暂不生效' : '已开启'}
            </span>
          </div>
          <p className="text-xs leading-relaxed text-slate-500">
            开了以后，你发出的每一条消息都由后端去生成回复，回复走推送回来。
            发完就能切后台、关掉应用，回来时消息已经在那儿了。关掉则回到本地直连生成。
          </p>
          {instantChatBlockedReason ? (
            <p className="text-xs leading-relaxed text-amber-600">{instantChatBlockedReason}</p>
          ) : (
            <p className="text-[11px] leading-relaxed text-slate-400">
              没有逐字吐出，生成期间显示「正在输入…」；云端明确报错才会提示重发，
              只要还在生成或重试就一直等（LLM 慢不算失败）。
            </p>
          )}
          <button
            type="button"
            onClick={() => void handleToggleInstantChat()}
            disabled={loading || (!config.instantChatEnabled && !!instantChatBlockedReason)}
            className={`w-full py-3 font-bold rounded-2xl active:scale-95 transition-transform disabled:opacity-40 ${
              config.instantChatEnabled ? 'bg-slate-200 text-slate-600' : 'bg-slate-900 text-white'
            }`}
          >
            {config.instantChatEnabled ? '关闭即时对话' : '开启即时对话'}
          </button>
        </div>
        <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 text-xs leading-relaxed text-amber-700 space-y-2">
          <div className="font-bold text-amber-800">风险说明</div>
          <p>开了主动消息以后，主动消息内容、提示词、相关配置，都会进入后端服务及其数据库。</p>
          <p>自建后端的话那是你自己的库；连官方后端的话，能碰到这台服务器的人（服务运营者）就能看到这些内容。项目本身不会额外接一个中心服务器之外的中转。</p>
          <p>如果你不接受把私密提示词、API Key 放进后端服务，就不要开主动消息。</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
          <button
            type="button"
            onClick={() => setAdvancedOpen((prev) => !prev)}
            className="w-full flex items-center justify-between text-left"
          >
            <span className="font-bold text-slate-700">高级信息</span>
            <span className="text-xs font-bold text-slate-400">{advancedOpen ? '收起' : '展开'}</span>
          </button>
          {advancedOpen ? (
            <div className="space-y-3 text-xs">
              <div className="bg-violet-50 border border-violet-100 rounded-2xl p-3 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-semibold text-slate-700">X-User-Id</span>
                  <span className="font-mono text-violet-600">{maskActiveMsgUserId(config.userId)}</span>
                </div>
              </div>
              <div className="bg-rose-50 border border-rose-100 rounded-2xl p-3 space-y-2">
                <div className="font-semibold text-rose-700">清空云端数据</div>
                <p className="text-[11px] leading-relaxed text-rose-600">
                  把后端数据库里属于你的数据全部删掉：已排程的主动消息任务（含角色自己排的）、
                  同步上去的角色上下文（角色卡、最近聊天窗口等）与工具凭据、推送订阅登记。
                </p>
                <p className="text-[11px] leading-relaxed text-rose-600">
                  清完角色上下文下次聊天会自动传回去，工具凭据和推送订阅当场补登记，任务要自己重新排。
                  换过后端主密钥之后旧数据解不开，也从这里清干净。
                </p>
                <button
                  onClick={() => void handleWipeCloudData()}
                  disabled={loading}
                  className="w-full py-2.5 bg-rose-500 text-white font-bold rounded-2xl active:scale-95 transition-transform disabled:opacity-50"
                >
                  {loading ? '处理中...' : '清空云端数据'}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </Modal>
  );
};
export default React.memo(ActiveMsgGlobalSettingsModal);
