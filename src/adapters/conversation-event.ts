import { createEvent } from '@astryn/contracts';
import type { AstrynAnyEvent, AstrynEventKind, AstrynEventPayloadFor } from '@astryn/contracts';

/**
 * 会话传输层事件的统一构造点：source 恒为 conversation、trust 恒为 observed，
 * 因此任何模型输出都不可能携带任务权威。
 */
export function conversationEvent<K extends AstrynEventKind>(input: {
  readonly kind: K;
  readonly payload: Omit<AstrynEventPayloadFor<K>, 'kind'>;
  readonly sessionId: string;
  readonly requestId: string | null;
  readonly seq: number;
}): AstrynAnyEvent {
  return createEvent({
    source: 'conversation',
    trust: 'observed',
    kind: input.kind,
    payload: input.payload,
    sessionId: input.sessionId,
    requestId: input.requestId,
    taskId: null,
    seq: input.seq,
    emittedAt: new Date().toISOString()
  }) as AstrynAnyEvent;
}
