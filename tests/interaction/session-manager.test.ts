import { describe, expect, it } from 'vitest';
import { ASTRYN_PROTOCOL_VERSION, XIAOQI_PROFILE, withOverrides } from '@astryn/contracts';
import type { AstrynConversationPort, AstrynConversationRequest } from '@astryn/contracts';
import {
  SyntheticConversationPort,
  SyntheticHostSimulator,
  createCompanionSessionManager,
  createEphemeralProfileStore
} from '@astryn/core';
import type { CompanionManagerDeps, CompanionSessionManagerOptions } from '@astryn/core';

const slowClock = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function recordingPort(inner: SyntheticConversationPort) {
  const requests: AstrynConversationRequest[] = [];
  let streamCalls = 0;
  const port: AstrynConversationPort = {
    protocol: inner.protocol,
    providerId: inner.providerId,
    transport: inner.transport,
    evidenceLevel: inner.evidenceLevel,
    modelId: inner.modelId,
    availability: () => inner.availability(),
    stream: async function* (request: AstrynConversationRequest, signal: AbortSignal) {
      streamCalls += 1;
      requests.push(request);
      yield* inner.stream(request, signal);
    }
  };
  return { port, requests, streamCalls: () => streamCalls };
}

function buildManager(
  conversation: AstrynConversationPort | null,
  overrides: Partial<Pick<CompanionManagerDeps, 'actions' | 'verifier' | 'sessionId'>> = {},
  options: CompanionSessionManagerOptions = {}
) {
  return createCompanionSessionManager(
    {
      sessionId: overrides.sessionId ?? 's1',
      profile: XIAOQI_PROFILE,
      conversation,
      actions: overrides.actions ?? null,
      verifier: overrides.verifier ?? null
    },
    options
  );
}

function hostRequest(simulator: SyntheticHostSimulator, requestId: string, summary: string): void {
  void simulator.submit({
    protocol: ASTRYN_PROTOCOL_VERSION,
    requestId,
    sessionId: 's1',
    actionKind: 'workspace.cleanup',
    summary,
    riskTier: 'high',
    argumentsDigest: 'sha256:demo'
  });
}

describe('会话管理器（GF02）', () => {
  it('同一请求只执行一次：单飞提交拒绝并发，空输入得到可区分结果', async () => {
    const { port, streamCalls } = recordingPort(
      new SyntheticConversationPort({ clock: slowClock, steps: [{ text: '回', delayMs: 15 }, { finish: 'stop' }] })
    );
    const manager = buildManager(port);
    const release = manager.retainView('panel');

    const empty = await manager.submit('   ');
    expect(empty).toEqual({ accepted: false, reason: 'EMPTY_INPUT' });

    const first = manager.submit('第一问');
    const second = await manager.submit('第二问');
    expect(second).toEqual({ accepted: false, reason: 'SESSION_BUSY' });

    const firstOutcome = await first;
    expect(firstOutcome.accepted).toBe(true);
    expect(streamCalls()).toBe(1);
    expect(manager.snapshot.transcript.map((m) => m.content)).toEqual(['第一问', '回']);

    release();
    manager.dispose();
  });

  it('构造与挂载分离：首个视图 retain 之前不订阅宿主，retain 之后权威回执入账', async () => {
    const simulator = new SyntheticHostSimulator();
    const manager = buildManager(new SyntheticConversationPort({ steps: [{ finish: 'stop' }] }), {
      actions: simulator,
      verifier: simulator
    });

    // 未挂载期间发出的回执不应被消费（构造必须是纯的，被丢弃的实例不得订阅宿主）。
    hostRequest(simulator, 'act-early', '未挂载期间的宿主请求');
    await settle();
    await settle();
    const release = manager.retainView('panel');
    await settle();
    await settle();
    expect(manager.snapshot.state.task.status).toBe('none');

    hostRequest(simulator, 'act-after', '挂载后的宿主请求');
    await settle();
    await settle();
    expect(manager.snapshot.state.task.status).toBe('awaiting_approval');
    expect(manager.snapshot.state.task.actionSummary ?? '').toContain('挂载后');

    release();
    manager.dispose();
  });

  it('零视图：渲染推送暂停，在途请求与宿主权威回执照常入账', async () => {
    const simulator = new SyntheticHostSimulator();
    const { port } = recordingPort(
      new SyntheticConversationPort({ clock: slowClock, steps: [{ text: '慢', delayMs: 20 }, { finish: 'stop' }] })
    );
    const manager = buildManager(port, { actions: simulator, verifier: simulator });
    const release = manager.retainView('panel');
    const pushes: number[] = [];
    const unsubscribe = manager.subscribe(() => pushes.push(manager.viewCount));

    const pending = manager.submit('慢慢说');
    await slowClock(3);
    release();
    expect(manager.viewCount).toBe(0);
    expect(manager.snapshot.renderingPaused).toBe(true);
    const pushesAtZero = pushes.length;

    hostRequest(simulator, 'act-zero-view', '零视图期间的宿主请求');
    await pending;
    await settle();
    await settle();

    expect(pushes.length).toBe(pushesAtZero);
    const snapshot = manager.snapshot;
    expect(snapshot.renderingPaused).toBe(true);
    expect(snapshot.transcript.map((m) => m.content)).toEqual(['慢慢说', '慢']);
    expect(snapshot.state.task.status).toBe('awaiting_approval');
    expect(snapshot.state.task.actionSummary ?? '').toContain('零视图期间');

    unsubscribe();
    const releaseAgain = manager.retainView('panel');
    expect(manager.snapshot.renderingPaused).toBe(false);
    releaseAgain();
    manager.dispose();
  });

  it('风格变化在途不丢会话：新档案只作用于下一轮提示', async () => {
    const { port, requests } = recordingPort(
      new SyntheticConversationPort({ clock: slowClock, steps: [{ text: '一', delayMs: 8 }, { text: '二', delayMs: 8 }, { finish: 'stop' }] })
    );
    const manager = buildManager(port);
    const release = manager.retainView('panel');

    const pending = manager.submit('口吻测试');
    await slowClock(3);
    manager.setProfile(withOverrides(XIAOQI_PROFILE, { expressionStyle: { replyLength: 'brief' } }));
    await pending;

    expect(manager.snapshot.state.conversation).toBe('idle');
    expect(manager.snapshot.transcript.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(manager.snapshot.profile.expressionStyle.replyLength).toBe('brief');

    await manager.submit('第二问');
    expect(requests).toHaveLength(2);
    const [firstRequest, secondRequest] = requests;
    if (!firstRequest || !secondRequest) throw new Error('missing recorded requests');
    expect(firstRequest.messages[0]?.content ?? '').toContain('回复保持在一到三句。');
    expect(secondRequest.messages[0]?.content ?? '').toContain('回复控制在两句以内。');

    release();
    manager.dispose();
  });

  it('换端口只替换运行时：管理器对象不变，同值调用是无操作', async () => {
    const first = recordingPort(new SyntheticConversationPort({ steps: [{ text: '旧', finish: 'stop' }] }));
    const second = recordingPort(new SyntheticConversationPort({ steps: [{ text: '新', finish: 'stop' }] }));
    const manager = buildManager(first.port);
    const release = manager.retainView('panel');

    await manager.submit('一');
    expect(manager.snapshot.transcript).toHaveLength(2);

    manager.configurePorts({ sessionId: 's1', conversation: second.port, actions: null, verifier: null });
    expect(manager.snapshot.transcript).toHaveLength(0);

    await manager.submit('二');
    expect(first.streamCalls()).toBe(1);
    expect(second.streamCalls()).toBe(1);
    expect(manager.snapshot.transcript.map((m) => m.content)).toEqual(['二', '新']);

    manager.configurePorts({ sessionId: 's1', conversation: second.port, actions: null, verifier: null });
    expect(manager.snapshot.transcript).toHaveLength(2);

    release();
    manager.dispose();
  });

  it('档案读取按存储实例去重：重复挂载只读一次，不覆盖后续修改', async () => {
    const store = createEphemeralProfileStore();
    const manager = buildManager(null);

    const [a, b] = await Promise.all([manager.ensureProfileLoaded(store), manager.ensureProfileLoaded(store)]);
    expect(a).toBe(b);
    expect(a.note).toBe('EMPTY_DEFAULT');

    manager.setProfile(withOverrides(XIAOQI_PROFILE, { expressionStyle: { replyLength: 'brief' } }));
    const again = await manager.ensureProfileLoaded(store);
    expect(again).toBe(a);
    expect(manager.snapshot.profile.expressionStyle.replyLength).toBe('brief');

    manager.dispose();
  });

  it('dispose 幂等；销毁后的提交被拒而不是抛错', async () => {
    const manager = buildManager(new SyntheticConversationPort({ steps: [{ finish: 'stop' }] }));
    manager.retainView('panel');
    manager.dispose();
    expect(manager.disposed).toBe(true);
    manager.dispose();

    const outcome = await manager.submit('在吗');
    expect(outcome).toEqual({ accepted: false, reason: 'DISPOSED' });
  });

  it('disposeWhenUnobserved：同批次重新挂载取消销毁，真实离开后销毁', async () => {
    const manager = buildManager(new SyntheticConversationPort({ steps: [{ finish: 'stop' }] }), {}, { disposeWhenUnobserved: true });
    const release = manager.retainView('panel');
    release();
    expect(manager.disposed).toBe(false);

    const releaseAgain = manager.retainView('panel');
    await settle();
    expect(manager.disposed).toBe(false);

    releaseAgain();
    await settle();
    expect(manager.disposed).toBe(true);
  });
});
