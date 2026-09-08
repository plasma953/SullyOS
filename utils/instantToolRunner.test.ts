import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Regression tests for the /continue dual-channel verdict
// (docs/instant-push-dual-channel.md):
// the only trusted delivery signal is the SW broadcast
// 'active-msg-received'. An SSE transport rejection must be absorbed and must
// never flip the outcome straight to failed.

const { reiMocks } = vi.hoisted(() => ({
  reiMocks: {
    deliver: vi.fn(),
    consumeInstantStream: vi.fn(),
  },
}));
vi.mock('@rei-standard/amsg-client', () => ({
  ReiClient: vi.fn(() => reiMocks),
}));

const { storeMocks } = vi.hoisted(() => ({
  storeMocks: {
    consumePendingToolCalls: vi.fn(),
    getOutboundSession: vi.fn(),
    saveXhsSessionNotes: vi.fn(),
  },
}));
vi.mock('./activeMsgStore', () => ({
  ActiveMsgStore: {
    consumePendingToolCalls: (...a: unknown[]) => storeMocks.consumePendingToolCalls(...a),
    getOutboundSession: (...a: unknown[]) => storeMocks.getOutboundSession(...a),
    saveXhsSessionNotes: (...a: unknown[]) => storeMocks.saveXhsSessionNotes(...a),
  },
}));

const { dbMocks } = vi.hoisted(() => ({
  dbMocks: {
    getAllCharacters: vi.fn(),
    getUserProfile: vi.fn(),
  },
}));
vi.mock('./db', () => ({
  DB: {
    getAllCharacters: (...a: unknown[]) => dbMocks.getAllCharacters(...a),
    getUserProfile: (...a: unknown[]) => dbMocks.getUserProfile(...a),
  },
}));

const { toolMocks } = vi.hoisted(() => ({
  toolMocks: {
    dispatchAgenticTool: vi.fn(),
  },
}));
vi.mock('./agenticTools', () => ({
  dispatchAgenticTool: (...a: unknown[]) => toolMocks.dispatchAgenticTool(...a),
}));

const { pushClientMocks } = vi.hoisted(() => ({
  pushClientMocks: {
    loadInstantConfig: vi.fn(),
    isInstantConfigReady: vi.fn(),
    getOrCreateInstantSubscription: vi.fn(),
    getInstantOversizeTransport: vi.fn(),
    postSsePayloadToServiceWorker: vi.fn(),
  },
}));
vi.mock('./instantPushClient', () => ({
  loadInstantConfig: (...a: unknown[]) => pushClientMocks.loadInstantConfig(...a),
  isInstantConfigReady: (...a: unknown[]) => pushClientMocks.isInstantConfigReady(...a),
  getOrCreateInstantSubscription: (...a: unknown[]) => pushClientMocks.getOrCreateInstantSubscription(...a),
  getInstantOversizeTransport: (...a: unknown[]) => pushClientMocks.getInstantOversizeTransport(...a),
  postSsePayloadToServiceWorker: (...a: unknown[]) => pushClientMocks.postSsePayloadToServiceWorker(...a),
}));

vi.mock('./activeMsgRuntime', () => ({
  pushXhsCaches: {
    xsecTokenCache: new Map(),
    noteTitleCache: new Map(),
    commentUserIdCache: new Map(),
    commentAuthorNameCache: new Map(),
    commentParentIdCache: new Map(),
  },
  pushLastXhsNotesRef: { current: [] },
}));

vi.mock('./amsgToolTrace', () => ({
  describeToolForUser: (name: string) => name,
}));

import { runPendingToolCalls } from './instantToolRunner';

const ITEM = {
  sessionId: 'sess-continue-1',
  charId: 'char-1',
  toolCalls: [
    { id: 'call-1', type: 'function' as const, function: { name: 'recall', arguments: '{}' } },
  ],
  llmOutputText: '',
  iteration: 2,
  createdAt: 1_700_000_000_000,
};

function stubWindowBus(): void {
  const listeners = new Map<string, Set<(e: unknown) => void>>();
  vi.stubGlobal('window', {
    addEventListener: (type: string, handler: (e: unknown) => void) => {
      let set = listeners.get(type);
      if (!set) {
        set = new Set();
        listeners.set(type, set);
      }
      set.add(handler);
    },
    removeEventListener: (type: string, handler: (e: unknown) => void) => {
      listeners.get(type)?.delete(handler);
    },
    dispatchEvent: (event: { type: string }) => {
      const set = listeners.get(event.type);
      if (set) {
        for (const handler of Array.from(set)) handler(event);
      }
      return true;
    },
    setTimeout: setTimeout.bind(globalThis),
    clearTimeout: clearTimeout.bind(globalThis),
  });
}

function readToolStatusPhase(charId: string): string | undefined {
  const raw = localStorage.getItem(`instant_tool_status_${charId}`);
  if (!raw) return undefined;
  try {
    return (JSON.parse(raw) as { phase?: string }).phase;
  } catch {
    return undefined;
  }
}

function readToolStatusText(charId: string): string | undefined {
  const raw = localStorage.getItem(`instant_tool_status_${charId}`);
  if (!raw) return undefined;
  try {
    return (JSON.parse(raw) as { text?: string }).text;
  } catch {
    return undefined;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  stubWindowBus();

  storeMocks.consumePendingToolCalls.mockResolvedValue([ITEM]);
  storeMocks.getOutboundSession.mockResolvedValue({
    sessionId: ITEM.sessionId,
    charId: ITEM.charId,
    messages: [{ role: 'user', content: 'hi' }],
    apiCredentials: {
      baseUrl: 'https://api.example.com',
      apiKey: 'sk-test',
      model: 'gpt-test',
    },
    createdAt: Date.now(),
  });
  storeMocks.saveXhsSessionNotes.mockResolvedValue(undefined);

  dbMocks.getAllCharacters.mockResolvedValue([{ id: 'char-1', name: 'TestChar', avatar: '' }]);
  dbMocks.getUserProfile.mockResolvedValue({ name: 'User', avatar: '', bio: '' });

  toolMocks.dispatchAgenticTool.mockResolvedValue({ ok: true });

  pushClientMocks.loadInstantConfig.mockReturnValue({
    enabled: true,
    workerUrl: 'https://worker.example.com',
    clientToken: 'token-test',
  });
  pushClientMocks.isInstantConfigReady.mockReturnValue(true);
  pushClientMocks.getOrCreateInstantSubscription.mockResolvedValue({
    sub: { endpoint: 'https://push.example.com/e', keys: { p256dh: 'p', auth: 'a' } },
  });
  pushClientMocks.getInstantOversizeTransport.mockReturnValue('multipart');
  pushClientMocks.postSsePayloadToServiceWorker.mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('/continue dual-channel verdict', () => {
  it('transport rejection is absorbed: observed active-msg-received still yields done, never failed', async () => {
    // Fake deliver() emulates the real library: the SSE transport dies with
    // 'Load failed' (captured into detail.transportError) but the observed
    // channel still wins, so the outcome is delivered.
    reiMocks.deliver.mockImplementation(async (_payload: unknown, opts: any) => {
      const receipt = await opts.delivery.observed;
      return {
        ok: true,
        outcome: 'delivered',
        detail: {
          waitedMs: 5,
          transportEnded: false,
          transportError: new Error('Load failed'),
          receipt,
        },
      };
    });
    reiMocks.consumeInstantStream.mockRejectedValue(new Error('should not be used'));

    const pending = runPendingToolCalls();
    // Let the runner reach deliver() and start awaiting the observed promise,
    // then land the SW broadcast for this session.
    await new Promise((r) => setTimeout(r, 10));
    (window as unknown as { dispatchEvent: (e: unknown) => void }).dispatchEvent({
      type: 'active-msg-received',
      detail: { sessionId: ITEM.sessionId, charId: ITEM.charId },
    } as unknown as Event);
    const result = await pending;

    expect(result).toEqual({ processed: 1, ok: 1 });
    expect(reiMocks.consumeInstantStream).not.toHaveBeenCalled();
    expect(reiMocks.deliver).toHaveBeenCalledTimes(1);
    const deliverOpts = reiMocks.deliver.mock.calls[0][1];
    expect(deliverOpts.endpointPath).toBe('/continue');
    expect(deliverOpts.delivery?.mode).toBe('observed');
    expect(readToolStatusPhase(ITEM.charId)).toBe('done');
  });

  it('terminal non-delivery keeps failed but preserves the SW self-report as a hint', async () => {
    pushClientMocks.postSsePayloadToServiceWorker.mockResolvedValue({
      ok: true,
      businessError: 'inbox write failed: QuotaExceededError',
    });
    reiMocks.deliver.mockImplementation(async (_payload: unknown, opts: any) => {
      await opts.onChunk?.({ messageKind: 'chat' });
      return {
        ok: false,
        outcome: 'send-failed',
        detail: { waitedMs: 5, transportEnded: false, transportError: new Error('boom') },
      };
    });

    const result = await runPendingToolCalls();

    expect(result).toEqual({ processed: 1, ok: 0 });
    expect(readToolStatusPhase(ITEM.charId)).toBe('failed');
    // SW self-report is kept as a diagnostic hint, not an outcome override.
    expect(readToolStatusText(ITEM.charId)).toContain('QuotaExceededError');
  });
});
