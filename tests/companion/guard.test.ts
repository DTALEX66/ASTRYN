import { describe, expect, it } from 'vitest';
import { ASTRYN_PROTOCOL_VERSION, createEvent } from '@astryn/contracts';
import type { AstrynAnyEvent, AstrynEventKind, AstrynEventSource, AstrynTrustLevel } from '@astryn/contracts';
import { AstrynEventGuard } from '@astryn/core';

interface EvOverrides {
  readonly sessionId?: string;
  readonly requestId?: string | null;
  readonly seq?: number;
  readonly kind?: AstrynEventKind;
  readonly payload?: Record<string, unknown>;
  readonly source?: AstrynEventSource;
  readonly trust?: AstrynTrustLevel;
  readonly taskId?: string | null;
}

function ev(overrides: EvOverrides = {}): AstrynAnyEvent {
  return createEvent({
    source: overrides.source ?? 'conversation',
    trust: overrides.trust ?? 'observed',
    kind: (overrides.kind ?? 'stream.delta') as never,
    payload: (overrides.payload ?? { text: 'x' }) as never,
    sessionId: overrides.sessionId ?? 's1',
    requestId: overrides.requestId ?? null,
    taskId: overrides.taskId ?? null,
    seq: overrides.seq ?? 0
  }) as unknown as AstrynAnyEvent;
}

describe('事件守卫（A07 串台防线）', () => {
  it('旧会话事件被拒绝，不写当前状态', () => {
    const guard = new AstrynEventGuard('s2');
    guard.openRequest('r1');
    expect(guard.accept(ev({ sessionId: 's1', requestId: 'r1', seq: 0 })).accepted).toBe(false);
    expect(guard.accept(ev({ sessionId: 's1', requestId: 'r1', seq: 0 })).reason).toBe('INACTIVE_SESSION');
  });

  it('协议版本不符直接拒收', () => {
    const guard = new AstrynEventGuard('s1');
    guard.openRequest('r1');
    const bad = { ...ev({ requestId: 'r1', seq: 0 }), protocol: 'astryn-0' } as unknown as AstrynAnyEvent;
    expect(guard.accept(bad).reason).toBe('PROTOCOL_MISMATCH');
    expect(ASTRYN_PROTOCOL_VERSION).toBe('astryn-1');
  });

  it('重复与乱序序号被丢弃，单调递增被接受', () => {
    const guard = new AstrynEventGuard('s1');
    guard.openRequest('r1');
    expect(guard.accept(ev({ requestId: 'r1', seq: 3 })).accepted).toBe(true);
    expect(guard.accept(ev({ requestId: 'r1', seq: 3 })).reason).toBe('NON_MONOTONIC_SEQ');
    expect(guard.accept(ev({ requestId: 'r1', seq: 2 })).reason).toBe('NON_MONOTONIC_SEQ');
    expect(guard.accept(ev({ requestId: 'r1', seq: 4 })).accepted).toBe(true);
  });

  it('已结清请求的迟到事件被丢弃（取消后不串台）', () => {
    const guard = new AstrynEventGuard('s1');
    guard.openRequest('r1');
    guard.accept(ev({ requestId: 'r1', seq: 0 }));
    guard.settleRequest('r1');
    expect(guard.accept(ev({ requestId: 'r1', seq: 1 })).reason).toBe('SETTLED_REQUEST');
  });

  it('未知请求身份被丢弃', () => {
    const guard = new AstrynEventGuard('s1');
    expect(guard.accept(ev({ requestId: 'ghost', seq: 0 })).reason).toBe('UNKNOWN_REQUEST');
  });

  it('切换会话后一切旧请求作废，但新会话可用', () => {
    const guard = new AstrynEventGuard('s1');
    guard.openRequest('r1');
    guard.accept(ev({ requestId: 'r1', seq: 0 }));
    guard.switchSession('s2');
    expect(guard.accept(ev({ requestId: 'r1', seq: 1 })).reason).toBe('INACTIVE_SESSION');
    guard.openRequest('r2');
    expect(guard.accept(ev({ sessionId: 's2', requestId: 'r2', seq: 0 })).accepted).toBe(true);
    // 新会话里序号独立计数，旧会话的 0 不影响它。
    expect(guard.accept(ev({ sessionId: 's2', requestId: 'r2', seq: 1 })).accepted).toBe(true);
  });

  it('任务事件必须有权威可信级别与任务标识', () => {
    const guard = new AstrynEventGuard('s1');
    guard.openRequest('a1');
    const nonAuthoritative = ev({ requestId: 'a1', seq: 0, kind: 'task.completed', payload: { summary: '完成了' } });
    expect(guard.accept(nonAuthoritative).reason).toBe('TASK_EVENT_NOT_AUTHORITATIVE');

    const trusted = ev({ requestId: 'a1', seq: 1, kind: 'task.completed', payload: { summary: '完成了' }, source: 'host-task', trust: 'authoritative', taskId: 't1' });
    expect(guard.accept(trusted).accepted).toBe(true);

    const missingTaskId = ev({ requestId: 'a1', seq: 2, kind: 'task.completed', payload: { summary: 'x' }, source: 'host-task', trust: 'authoritative', taskId: null });
    expect(guard.accept(missingTaskId).reason).toBe('TASK_EVENT_MISSING_TASK_ID');
  });

  it('拒绝计数可用于审计', () => {
    const guard = new AstrynEventGuard('s1');
    guard.accept(ev({ requestId: 'ghost', seq: 0 }));
    guard.accept(ev({ requestId: 'ghost', seq: 1 }));
    expect(guard.rejectionCounts()['UNKNOWN_REQUEST']).toBe(2);
  });

  it('settled 有界：FIFO 淘汰最旧，最近结清仍被拒，不随请求数无界增长（A9）', () => {
    const guard = new AstrynEventGuard('s1');
    guard.openRequest('oldest');
    guard.settleRequest('oldest');
    for (let index = 0; index < 300; index += 1) {
      guard.openRequest(`r-${index}`);
      guard.settleRequest(`r-${index}`);
    }
    // 最旧的已随 FIFO 淘汰：不再被认作"已结清"，但也不在途——仍被拒（UNKNOWN_REQUEST）。
    expect(guard.accept(ev({ requestId: 'oldest', seq: 0 })).reason).toBe('UNKNOWN_REQUEST');
    // 最近结清的仍在 settled 中：迟到事件仍报 SETTLED_REQUEST。
    expect(guard.accept(ev({ requestId: 'r-299', seq: 0 })).reason).toBe('SETTLED_REQUEST');
  });
});
