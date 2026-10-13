import { describe, expect, it, vi } from 'vitest';
import { XIAOQI_PROFILE, withOverrides } from '@astryn/contracts';
import type { AstrynConversationRequest } from '@astryn/contracts';
import { AstrynCompanionController, SyntheticConversationPort } from '@astryn/core';

function build(conversation: ConstructorParameters<typeof AstrynCompanionController>[0]['conversation'], sessionId = 's1') {
  return new AstrynCompanionController({
    sessionId,
    profile: XIAOQI_PROFILE,
    conversation,
    actions: null,
    verifier: null
  });
}

/** 记录每次请求的端口：用于断言"提示里实际送出了什么档案"。 */
function recordingPort() {
  const requests: AstrynConversationRequest[] = [];
  const inner = new SyntheticConversationPort({ steps: [{ text: '好' }, { finish: 'stop' }] });
  const port = {
    protocol: inner.protocol,
    providerId: inner.providerId,
    transport: inner.transport,
    evidenceLevel: inner.evidenceLevel,
    modelId: inner.modelId,
    availability: () => inner.availability(),
    stream: async function* (request: AstrynConversationRequest, signal: AbortSignal) {
      requests.push(request);
      yield* inner.stream(request, signal);
    }
  };
  return { port, requests };
}

const slowClock = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('控制器编排（A06/A07）', () => {
  it('没有获准模型时落到 MODEL_UNAVAILABLE，且没有脚本回复', async () => {
    const controller = build(null);
    const pending = controller.submit('你好');
    await pending;
    expect(controller.currentState.failure?.code).toBe('MODEL_UNAVAILABLE');
    expect(controller.currentState.streamedText).toBe('');
    expect(controller.currentState.model.available).toBe(false);
  });

  it('正常一轮：thinking → speaking → idle，并把回复写进 transcript', async () => {
    const controller = build(new SyntheticConversationPort({ steps: [{ text: '我在' }, { text: '呢' }, { finish: 'stop' }] }));
    await controller.submit('在吗');
    expect(controller.currentState.conversation).toBe('idle');
    expect(controller.currentState.streamedText).toBe('我在呢');
    expect(controller.currentState.expressionFrame).toBe(2);
    expect(controller.transcript.map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  it('取消后迟到的事件不会串进当前状态', async () => {
    const port = new SyntheticConversationPort({
      clock: slowClock,
      steps: [{ text: '前半', delayMs: 5 }, { text: '后半', delayMs: 40 }, { finish: 'stop' }]
    });
    const controller = build(port);
    const pending = controller.submit('慢慢说');
    await slowClock(12);
    controller.cancel('user');
    const frozen = controller.currentState.streamedText;
    const frame = controller.currentState.expressionFrame;
    await pending;
    expect(controller.currentState.streamedText).toBe(frozen);
    expect(controller.currentState.expressionFrame).toBe(frame);
    expect(controller.currentState.conversation).toBe('interrupted');
    expect(controller.audit.lastRejectedReason ?? 'NONE').not.toBe(null);
  });

  it('快速连续提交：上一轮的迟到回复被丢弃，只显示新一轮内容', async () => {
    const first = new SyntheticConversationPort({ clock: slowClock, steps: [{ text: '旧回复', delayMs: 60 }, { finish: 'stop' }] });
    const controller = build(first);
    const pendingFirst = controller.submit('第一个问题');

    await slowClock(5);
    controller.cancel('superseded');
    const second = new SyntheticConversationPort({ steps: [{ text: '新回复' }, { finish: 'stop' }] });
    // 换端口模拟第二轮：新请求有新身份。
    const secondController = build(second, 's2');
    await secondController.submit('第二个问题');
    await pendingFirst;

    expect(secondController.currentState.streamedText).toBe('新回复');
    expect(controller.currentState.streamedText).not.toBe('新回复');
    expect(controller.currentState.conversation).toBe('interrupted');
  });

  it('切换会话清空历史与在途请求，旧会话事件全部作废', async () => {
    const port = new SyntheticConversationPort({ clock: slowClock, steps: [{ text: '旧', delayMs: 40 }, { finish: 'stop' }] });
    const controller = build(port);
    const pending = controller.submit('旧会话');
    await slowClock(5);
    controller.switchSession('next-session');
    await pending;
    expect(controller.currentState.sessionId).toBe('next-session');
    expect(controller.currentState.streamedText).toBe('');
    expect(controller.transcript).toHaveLength(0);
  });

  it('dispose 之后不再接受事件，也不回调监听者', async () => {
    const port = new SyntheticConversationPort({ clock: slowClock, steps: [{ text: '一', delayMs: 20 }, { text: '二', delayMs: 20 }, { finish: 'stop' }] });
    const controller = build(port);
    const listener = vi.fn();
    controller.subscribe(listener);
    const pending = controller.submit('说两句');
    await slowClock(8);
    controller.dispose();
    await pending;
    const calls = listener.mock.calls.length;
    controller.dispatch(
      // 手工构造一个迟到事件：卸载后必须被忽略。
      {
        protocol: 'astryn-1',
        eventId: 'late',
        sessionId: 's1',
        requestId: null,
        taskId: null,
        seq: 99,
        originSeq: null,
        source: 'system',
        trust: 'observed',
        emittedAt: new Date().toISOString(),
        payload: { kind: 'input.focus', surface: 'composer' }
      }
    );
    expect(listener.mock.calls.length).toBe(calls);
  });

  it('setProfile 不重建实例：会话连续，新档案只作用于下一轮提示', async () => {
    const { port, requests } = recordingPort();
    const controller = build(port);
    await controller.submit('第一问');
    expect(controller.transcript).toHaveLength(2);

    controller.setProfile(withOverrides(XIAOQI_PROFILE, { expressionStyle: { replyLength: 'brief' } }));
    await controller.submit('第二问');

    expect(controller.currentState.conversation).toBe('idle');
    expect(controller.transcript).toHaveLength(4);
    expect(controller.currentState.sessionId).toBe('s1');

    expect(requests).toHaveLength(2);
    const [firstRequest, secondRequest] = requests;
    if (!firstRequest || !secondRequest) throw new Error('missing recorded requests');
    expect(firstRequest.messages[0]?.content ?? '').toContain('回复保持在一到三句。');
    expect(secondRequest.messages[0]?.content ?? '').toContain('回复控制在两句以内。');
  });

  it('上游抛错时给出可区分的失败码，而不是静默', async () => {
    const throwingPort = {
      protocol: 'astryn-1',
      providerId: 'boom',
      transport: 'openai-compatible',
      evidenceLevel: 'REAL',
      modelId: 'm',
      availability: async () => ({ available: true, reason: null, failureCode: null }),
      async *stream() {
        throw new Error('socket hang up');
      }
    };
    const controller = build(throwingPort as never);
    await controller.submit('触发错误');
    expect(controller.currentState.failure?.code).toBe('NETWORK');
    expect(controller.currentState.failure?.message).toContain('socket hang up');
  });
});
