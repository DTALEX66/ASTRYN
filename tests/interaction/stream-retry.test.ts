import { describe, expect, it } from 'vitest';
import { XIAOQI_PROFILE, createEvent } from '@astryn/contracts';
import type {
  AstrynAnyEvent,
  AstrynContextFragment,
  AstrynConversationPort,
  AstrynConversationRequest,
  AstrynFailureCode,
  AstrynRequestLookup
} from '@astryn/contracts';
import { AstrynCompanionController, CompanionSessionManager, SyntheticConversationPort } from '@astryn/core';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const FRAGMENT: AstrynContextFragment = {
  scope: 'active-document-selection',
  sourceId: 'doc-1',
  sourceTitle: '夹具文档',
  sourceVersion: 'v1',
  excerpt: '选中的一段',
  provenance: 'synthetic-fixture',
  authorizationId: 'auth-1',
  evidenceLevel: 'SYNTHETIC'
};

interface RunScript {
  readonly deltas?: readonly string[];
  readonly delayMs?: number;
  readonly failCode?: AstrynFailureCode;
  readonly ignoreAbort?: boolean;
}

interface PortHarness {
  readonly port: AstrynConversationPort;
  readonly streamCalls: AstrynConversationRequest[];
  readonly lookupArgs: string[];
  readonly order: string[];
}

/** 可控脚本端口：按 run 依次播放（最后一个 run 会重复用于后续调用），可选查询能力。 */
function makePort(options: {
  readonly runs: readonly RunScript[];
  readonly lookup?: (requestId: string) => AstrynRequestLookup | Promise<AstrynRequestLookup>;
}): PortHarness {
  const streamCalls: AstrynConversationRequest[] = [];
  const lookupArgs: string[] = [];
  const order: string[] = [];
  let runIndex = 0;

  const base: AstrynConversationPort = {
    protocol: 'astryn-1',
    providerId: 'test-scripted',
    transport: 'scripted-synthetic',
    evidenceLevel: 'SYNTHETIC',
    modelId: 'scripted-only',
    availability: async () => ({ available: true, reason: null, failureCode: null }),
    async *stream(request: AstrynConversationRequest, signal: AbortSignal): AsyncGenerator<AstrynAnyEvent> {
      order.push('stream');
      streamCalls.push(request);
      const run = options.runs[Math.min(runIndex, options.runs.length - 1)] ?? {};
      runIndex += 1;
      let seq = 0;
      const base_ = {
        sessionId: request.sessionId,
        requestId: request.requestId
      } as const;

      yield createEvent({ source: 'conversation', trust: 'observed', kind: 'stream.started', payload: {}, ...base_, seq: seq++ }) as unknown as AstrynAnyEvent;
      for (const delta of run.deltas ?? []) {
        if (run.delayMs) await sleep(run.delayMs);
        if (signal.aborted && !run.ignoreAbort) {
          yield createEvent({ source: 'conversation', trust: 'observed', kind: 'stream.failed', payload: { code: 'ABORTED', message: '请求已取消', retryable: false }, ...base_, seq: seq++ }) as unknown as AstrynAnyEvent;
          return;
        }
        yield createEvent({ source: 'conversation', trust: 'observed', kind: 'stream.delta', payload: { text: delta }, ...base_, seq: seq++ }) as unknown as AstrynAnyEvent;
      }
      if (run.failCode) {
        yield createEvent({
          source: 'conversation',
          trust: 'observed',
          kind: 'stream.failed',
          payload: { code: run.failCode, message: '脚本失败', retryable: run.failCode === 'NETWORK' },
          ...base_,
          seq: seq++
        }) as unknown as AstrynAnyEvent;
        return;
      }
      yield createEvent({ source: 'conversation', trust: 'observed', kind: 'stream.completed', payload: { finishReason: 'stop' }, ...base_, seq: seq++ }) as unknown as AstrynAnyEvent;
    }
  };

  if (!options.lookup) return { port: base, streamCalls, lookupArgs, order };
  const lookup = options.lookup;
  const port: AstrynConversationPort = {
    ...base,
    lookupRequest: async (requestId: string) => {
      order.push('lookup');
      lookupArgs.push(requestId);
      return lookup(requestId);
    }
  };
  return { port, streamCalls, lookupArgs, order };
}

function build(conversation: AstrynConversationPort | null, sessionId = 's1'): AstrynCompanionController {
  return new AstrynCompanionController({
    sessionId,
    profile: XIAOQI_PROFILE,
    conversation,
    actions: null,
    verifier: null
  });
}

describe('GF07 重试与取消恢复', () => {
  it('失败后重试保留输入与材料标签，并以新请求身份重发（端口无查询能力时如实标注）', async () => {
    const { port, streamCalls } = makePort({ runs: [{ failCode: 'NETWORK' }, { deltas: ['复活了'] }] });
    const controller = build(port);
    controller.attachContext([FRAGMENT]);

    await controller.submit('帮我解释下');
    expect(controller.retryCandidate).toEqual({
      requestId: streamCalls[0]?.requestId,
      text: '帮我解释下',
      cause: 'failed',
      failureCode: 'NETWORK',
      outcomeUnknown: true
    });

    const result = await controller.retry();
    expect(result.ok).toBe(true);
    if (!result.ok || result.disposition.kind !== 'RESENT_WITHOUT_LOOKUP') throw new Error(`unexpected: ${JSON.stringify(result)}`);
    expect(streamCalls).toHaveLength(2);
    expect(streamCalls[1]?.requestId).toBe(result.disposition.requestId);
    expect(streamCalls[1]?.requestId).not.toBe(streamCalls[0]?.requestId);
    expect(streamCalls[1]?.messages.at(-1)?.content).toBe('帮我解释下');
    expect(streamCalls[0]?.contextFragments).toEqual([FRAGMENT]);
    expect(streamCalls[1]?.contextFragments).toEqual([FRAGMENT]);
    expect(controller.currentState.streamedText).toBe('复活了');
    expect(controller.retryCandidate).toBeNull();
  });

  it('未知执行结果：先查询原请求再重发（顺序可断言），not-found 按新请求重发', async () => {
    const { port, streamCalls, lookupArgs, order } = makePort({
      runs: [{ failCode: 'NETWORK' }, { deltas: ['重发成功'] }],
      lookup: (requestId) => ({ requestId, outcome: 'not-found', detail: '宿主无该请求记录' })
    });
    const controller = build(port);
    await controller.submit('崩了的一轮');

    const result = await controller.retry();
    expect(order).toEqual(['stream', 'lookup', 'stream']);
    expect(lookupArgs).toEqual([streamCalls[0]?.requestId]);
    expect(result.ok).toBe(true);
    if (!result.ok || result.disposition.kind !== 'RESENT') throw new Error(`unexpected: ${JSON.stringify(result)}`);
    expect(result.disposition.lookup?.outcome).toBe('not-found');
    expect(streamCalls).toHaveLength(2);
    expect(controller.currentState.streamedText).toBe('重发成功');
  });

  it('查询显示原请求已完成或仍在执行：扣留不重发（防重复执行），候选保留', async () => {
    for (const outcome of ['completed', 'in-progress'] as const) {
      const { port, streamCalls } = makePort({
        runs: [{ failCode: 'TIMEOUT' }],
        lookup: (requestId) => ({ requestId, outcome, detail: `宿主报告 ${outcome}` })
      });
      const controller = build(port);
      await controller.submit('怕重复的一轮');

      const result = await controller.retry();
      expect(result.ok).toBe(true);
      if (!result.ok || result.disposition.kind !== 'HELD_BACK') throw new Error(`unexpected(${outcome}): ${JSON.stringify(result)}`);
      expect(result.disposition.lookup.outcome).toBe(outcome);
      expect(streamCalls).toHaveLength(1);
      expect(controller.retryCandidate?.text).toBe('怕重复的一轮');
    }
  });

  it('已知结果（上游拒绝=未执行）：不查询、直接重发', async () => {
    const { port, lookupArgs, order } = makePort({
      runs: [{ failCode: 'UPSTREAM_REJECTED' }, { deltas: ['好'] }],
      lookup: (requestId) => ({ requestId, outcome: 'completed', detail: '不会用到' })
    });
    const controller = build(port);
    await controller.submit('被拒的一轮');

    const result = await controller.retry();
    expect(order).toEqual(['stream', 'stream']);
    expect(lookupArgs).toEqual([]);
    expect(result.ok).toBe(true);
    if (!result.ok || result.disposition.kind !== 'RESENT') throw new Error(`unexpected: ${JSON.stringify(result)}`);
    expect(result.disposition.lookup).toBeNull();
  });

  it('取消后：候选记为已停止（结果未知），重试先查询原请求并重发', async () => {
    const { port, streamCalls, lookupArgs, order } = makePort({
      runs: [{ deltas: ['前半'], delayMs: 40 }, { deltas: ['重来'] }],
      lookup: (requestId) => ({ requestId, outcome: 'not-found', detail: '宿主无该请求记录' })
    });
    const controller = build(port);
    const pending = controller.submit('慢慢说');
    await sleep(8);
    controller.cancel('user');
    const { requestId: originalId } = await pending;

    expect(controller.currentState.conversation).toBe('interrupted');
    expect(controller.retryCandidate).toEqual({
      requestId: originalId,
      text: '慢慢说',
      cause: 'cancelled',
      failureCode: 'ABORTED',
      outcomeUnknown: true
    });

    const result = await controller.retry();
    expect(order).toEqual(['stream', 'lookup', 'stream']);
    expect(lookupArgs).toEqual([originalId]);
    expect(result.ok).toBe(true);
    if (!result.ok || result.disposition.kind !== 'RESENT') throw new Error(`unexpected: ${JSON.stringify(result)}`);
    expect(streamCalls).toHaveLength(2);
    expect(controller.currentState.streamedText).toBe('重来');
  });

  it('取消后晚到片段不能继续回复或动作：静默丢弃并计入守卫审计', async () => {
    const { port, streamCalls } = makePort({ runs: [{ deltas: ['前半'], delayMs: 40 }] });
    const controller = build(port);
    const pending = controller.submit('慢慢说');
    await sleep(8);
    controller.cancel('user');
    const { requestId: originalId } = await pending;
    const frozenText = controller.currentState.streamedText;

    // 迟到的增量（值守卫路径）与迟到的权威任务完成（若被接受就会改变任务状态或回复）。
    controller.dispatch(
      createEvent({
        source: 'conversation',
        trust: 'observed',
        kind: 'stream.delta',
        payload: { text: '后半' },
        sessionId: 's1',
        requestId: originalId,
        seq: 999,
        eventId: 'late-delta'
      }) as unknown as AstrynAnyEvent
    );
    controller.dispatch(
      createEvent({
        source: 'host-task',
        trust: 'authoritative',
        kind: 'task.completed',
        payload: { summary: '趁乱完成' },
        sessionId: 's1',
        requestId: originalId,
        taskId: 'task-late',
        seq: 1000,
        eventId: 'late-task'
      }) as unknown as AstrynAnyEvent
    );

    expect(controller.currentState.streamedText).toBe(frozenText);
    expect(controller.currentState.task.taskId).toBeNull();
    expect(controller.audit.rejected['SETTLED_REQUEST']).toBe(2);
    expect(controller.currentState.conversation).toBe('interrupted');
    expect(streamCalls).toHaveLength(1);
  });

  it('端口忽略中止信号：循环断开后到达的文本不再派发', async () => {
    const { port } = makePort({ runs: [{ deltas: ['前半', '后半', '结尾'], delayMs: 40, ignoreAbort: true }] });
    const controller = build(port);
    const pending = controller.submit('说三句');
    await sleep(50); // 第一段已到达
    controller.cancel('user');
    await pending;

    expect(controller.currentState.streamedText).toBe('前半');
    expect(controller.currentState.conversation).toBe('interrupted');
    expect(controller.retryCandidate?.cause).toBe('cancelled');
  });

  it('没有模型端口：MODEL_UNAVAILABLE 也是已知结果，重试直接重发（同样失败但输入不丢）', async () => {
    const controller = build(null);
    await controller.submit('在吗');
    expect(controller.retryCandidate?.failureCode).toBe('MODEL_UNAVAILABLE');
    expect(controller.retryCandidate?.outcomeUnknown).toBe(false);
    const originalId = controller.retryCandidate?.requestId;

    const result = await controller.retry();
    expect(result.ok).toBe(true);
    if (!result.ok || result.disposition.kind !== 'RESENT') throw new Error(`unexpected: ${JSON.stringify(result)}`);
    expect(result.disposition.requestId).not.toBe(originalId);
    // 重试后仍是 MODEL_UNAVAILABLE 候选（端口依旧缺席），输入保持可再次重试。
    expect(controller.retryCandidate?.failureCode).toBe('MODEL_UNAVAILABLE');
  });

  it('成功一轮清空候选；管理器快照同步暴露候选与材料标签', async () => {
    const { port } = makePort({ runs: [{ failCode: 'NETWORK' }, { deltas: ['好了'] }] });
    const manager = new CompanionSessionManager({
      sessionId: 's1',
      profile: XIAOQI_PROFILE,
      conversation: port,
      actions: null,
      verifier: null
    });

    expect(await manager.retry()).toEqual({ accepted: false, reason: 'NO_RETRY_CANDIDATE' });
    manager.attachContext([FRAGMENT]);
    expect(manager.snapshot.pendingAttachments).toEqual([FRAGMENT]);

    const first = await manager.submit('第一问');
    expect(first.accepted).toBe(true);
    expect(manager.snapshot.pendingAttachments).toEqual([]);
    expect(manager.snapshot.retry?.text).toBe('第一问');

    const retried = await manager.retry();
    expect(retried.accepted).toBe(true);
    expect(manager.snapshot.retry).toBeNull();

    const blocked = manager.submit('第二问');
    const busy = await manager.retry();
    expect(busy).toEqual({ accepted: false, reason: 'SESSION_BUSY' });
    await blocked;
  });

  it('合成夹具：已结束请求查无记录（不写正式记录），在途请求报 in-progress', async () => {
    const port = new SyntheticConversationPort({ steps: [{ text: '嗯', delayMs: 30 }, { finish: 'stop' }] });
    expect((await port.lookupRequest('never-seen')).outcome).toBe('not-found');

    const request: AstrynConversationRequest = {
      protocol: 'astryn-1',
      sessionId: 's1',
      requestId: 'req-active',
      characterId: 'xiaoqi',
      messages: [],
      contextFragments: []
    };
    const consume = (async () => {
      for await (const _event of port.stream(request, new AbortController().signal)) {
        // 同步消费整条流
      }
    })();
    await sleep(5);
    expect((await port.lookupRequest('req-active')).outcome).toBe('in-progress');
    await consume;
    expect((await port.lookupRequest('req-active')).outcome).toBe('not-found');
  });
});
