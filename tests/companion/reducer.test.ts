import { describe, expect, it } from 'vitest';
import { ASTRYN_TASK_STATES_REQUIRING_RECEIPT, createEvent, initialState, toVisibleState } from '@astryn/contracts';
import type { AstrynAnyEvent, AstrynCompanionState, AstrynTaskStateName } from '@astryn/contracts';
import { reduceCompanionState } from '@astryn/core';

const model = {
  kind: 'synthetic',
  providerId: 'test',
  modelId: 'test',
  available: true,
  reason: null,
  evidenceLevel: 'SYNTHETIC'
} as const;

function start(sessionId = 's1'): { state: AstrynCompanionState; seq: { n: number } } {
  return { state: initialState(sessionId, model), seq: { n: 0 } };
}

const conv = (sessionId: string, requestId: string | null, kind: string, payload: Record<string, unknown>, seq: number) =>
  createEvent({
    source: 'conversation',
    trust: 'observed',
    kind: kind as never,
    payload: payload as never,
    sessionId,
    requestId,
    taskId: null,
    seq
  }) as unknown as AstrynAnyEvent;

describe('对话状态机', () => {
  it('输入聚焦进入 listening，失焦回到 idle', () => {
    const { state, seq } = start();
    const focused = reduceCompanionState(state, conv('s1', null as never, 'input.focus', { surface: 'composer' }, seq.n++));
    expect(focused.applied).toBe(true);
    expect(focused.state.conversation).toBe('listening');
    expect(toVisibleState(focused.state)).toBe('listening');

    const blurred = reduceCompanionState(focused.state, conv('s1', null as never, 'input.blur', { surface: 'composer' }, seq.n++));
    expect(blurred.state.conversation).toBe('idle');
  });

  it('说话中聚焦输入框不应打断 speaking', () => {
    const { state, seq } = start();
    const submitted = reduceCompanionState(state, conv('s1', 'r1', 'turn.submitted', { text: '你好', characterId: 'xiaoqi' }, seq.n++));
    const delta = reduceCompanionState(submitted.state, conv('s1', 'r1', 'stream.delta', { text: '我在' }, seq.n++));
    expect(delta.state.conversation).toBe('speaking');
    const focus = reduceCompanionState(delta.state, conv('s1', null as never, 'input.focus', { surface: 'composer' }, seq.n++));
    expect(focus.applied).toBe(false);
    expect(focus.state.conversation).toBe('speaking');
  });

  it('每个真实 delta 递增口型帧；序号去重是守卫的职责而非状态机的', () => {
    const { state, seq } = start();
    let current = reduceCompanionState(state, conv('s1', 'r1', 'turn.submitted', { text: 'a', characterId: 'xiaoqi' }, seq.n++)).state;
    current = reduceCompanionState(current, conv('s1', 'r1', 'stream.delta', { text: '一' }, seq.n++)).state;
    expect(current.expressionFrame).toBe(1);
    current = reduceCompanionState(current, conv('s1', 'r1', 'stream.delta', { text: '二' }, seq.n++)).state;
    expect(current.expressionFrame).toBe(2);
    expect(current.streamedText).toBe('一二');
    // 状态机不读 seq（乱序/去重在 session-guard 层，见 guard.test.ts）：即便序号回退，
    // 到达 reduceCompanionState 的 delta 仍会推进口型帧。守卫一旦被绕过，这里会先变红。
    current = reduceCompanionState(current, conv('s1', 'r1', 'stream.delta', { text: '三' }, 0)).state;
    expect(current.expressionFrame).toBe(3);
    expect(current.streamedText).toBe('一二三');
  });

  it('说完一句话不等于任务完成（A08 核心）', () => {
    const { state, seq } = start();
    let current = reduceCompanionState(state, conv('s1', 'r1', 'turn.submitted', { text: '帮我删掉临时文件', characterId: 'xiaoqi' }, seq.n++)).state;
    current = reduceCompanionState(current, conv('s1', 'r1', 'stream.delta', { text: '好的，任务已完成。' }, seq.n++)).state;
    const done = reduceCompanionState(current, conv('s1', 'r1', 'stream.completed', { finishReason: 'stop' }, seq.n++));
    expect(done.state.conversation).toBe('idle');
    expect(done.state.task.status).toBe('none');
    expect(done.note).toBe('utterance-end-is-not-task-completion');
    expect(toVisibleState(done.state)).toBe('idle');
  });

  it('取消进入 interrupted 并清空在途请求身份', () => {
    const { state, seq } = start();
    const submitted = reduceCompanionState(state, conv('s1', 'r1', 'turn.submitted', { text: 'a', characterId: 'xiaoqi' }, seq.n++));
    const cancelled = reduceCompanionState(submitted.state, conv('s1', 'r1', 'turn.cancelled', { reason: 'user' }, seq.n++));
    expect(cancelled.state.conversation).toBe('interrupted');
    expect(cancelled.state.activeRequestId).toBeNull();
  });

  it('缺模型时明确落到 MODEL_UNAVAILABLE 而不是脚本回复', () => {
    const { state, seq } = start();
    const unavailable = reduceCompanionState(
      state,
      conv('s1', 'r1', 'model.unavailable', { reason: '未配置获准模型接口', configuredSource: 'none' }, seq.n++)
    );
    expect(unavailable.state.failure?.code).toBe('MODEL_UNAVAILABLE');
    expect(unavailable.state.model.available).toBe(false);
    expect(unavailable.state.streamedText).toBe('');
  });

  it('非权威任务事件被 reducer 二次拒绝', () => {
    const { state, seq } = start();
    const forged = reduceCompanionState(state, conv('s1', 'r1', 'task.completed', { summary: '任务已完成' }, seq.n++));
    expect(forged.applied).toBe(false);
    expect(forged.note).toBe('task-event-requires-authoritative-receipt');
    expect(forged.state.task.status).toBe('none');
  });

  it('需回执任务状态不变量：契约表的每个状态都只能经权威事件写入且 receiptId 非空（A15）', () => {
    const authoritative = (kind: string, payload: Record<string, unknown>, seq: number) =>
      createEvent({
        source: 'host-task',
        trust: 'authoritative',
        kind: kind as never,
        payload: payload as never,
        sessionId: 's1',
        requestId: 'a1',
        taskId: 't1',
        seq
      }) as unknown as AstrynAnyEvent;

    // 每个需回执状态各配一条能写入它的权威事件；表驱动防止契约表与 reducer 硬编码漂移。
    const cases = new Map<AstrynTaskStateName, AstrynAnyEvent>([
      ['awaiting_approval', authoritative('task.approval.requested', { actionSummary: '删除临时文件', riskTier: 'high' }, 0)],
      ['executing', authoritative('task.progress', { step: '执行中', percent: 30 }, 1)],
      ['completed', authoritative('task.completed', { summary: '已删除' }, 2)],
      ['failed', authoritative('task.failed', { code: 'TASK_EXECUTION_FAILED', message: '执行失败' }, 3)]
    ]);
    expect([...cases.keys()].sort()).toEqual([...ASTRYN_TASK_STATES_REQUIRING_RECEIPT].sort());

    for (const expected of ASTRYN_TASK_STATES_REQUIRING_RECEIPT) {
      const event = cases.get(expected);
      if (!event) throw new Error(`missing authoritative case for ${expected}`);
      const { state } = start();
      const result = reduceCompanionState(state, event);
      expect(result.applied).toBe(true);
      expect(result.state.task.status).toBe(expected);
      expect(result.state.task.receiptId).not.toBeNull();
      expect(toVisibleState(result.state)).toBe(expected);
    }

    // 对照腿：同表语义经观测通道必然被拒，状态不动、无回执。
    const forged = reduceCompanionState(start().state, conv('s1', 'r1', 'task.progress', { step: '伪造', percent: 99 }, 0));
    expect(forged.applied).toBe(false);
    expect(ASTRYN_TASK_STATES_REQUIRING_RECEIPT.includes(forged.state.task.status)).toBe(false);
    expect(forged.state.task.receiptId).toBeNull();
  });

  it('提交新一轮会保留仍在进行的权威任务', () => {
    const { state, seq } = start();
    const running = reduceCompanionState(
      state,
      createEvent({
        source: 'host-task',
        trust: 'authoritative',
        kind: 'task.progress',
        payload: { step: '执行中', percent: 30 },
        sessionId: 's1',
        requestId: 'a1',
        taskId: 't1',
        seq: 0
      })
    );
    expect(running.state.task.status).toBe('executing');
    const next = reduceCompanionState(running.state, conv('s1', 'r2', 'turn.submitted', { text: 'b', characterId: 'xiaoqi' }, seq.n++));
    expect(next.note).toBe('authoritative-task-preserved');
    expect(next.state.task.taskId).toBe('t1');
  });
});
