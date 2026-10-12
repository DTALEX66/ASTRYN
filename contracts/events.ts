import { ASTRYN_PROTOCOL_VERSION, type AstrynEventEnvelope, type AstrynEventSource, type AstrynTrustLevel } from './protocol';

/** 会话与交互事件。它们只能驱动对话呈现状态，不能改变任务状态。 */
export type AstrynConversationEventKind =
  | 'input.focus'
  | 'input.blur'
  | 'turn.submitted'
  | 'turn.cancelled'
  | 'stream.started'
  | 'stream.delta'
  | 'stream.completed'
  | 'stream.failed'
  | 'model.unavailable';

/** 任务事件。只有携带已校验宿主回执（trust=authoritative）时才被状态机接受。 */
export type AstrynTaskEventKind =
  | 'task.approval.requested'
  | 'task.approval.decided'
  | 'task.progress'
  | 'task.completed'
  | 'task.failed';

export type AstrynEventKind = AstrynConversationEventKind | AstrynTaskEventKind;

export const ASTRYN_CONVERSATION_EVENT_KINDS: readonly AstrynConversationEventKind[] = [
  'input.focus', 'input.blur', 'turn.submitted', 'turn.cancelled',
  'stream.started', 'stream.delta', 'stream.completed', 'stream.failed', 'model.unavailable'
];

export const ASTRYN_TASK_EVENT_KINDS: readonly AstrynTaskEventKind[] = [
  'task.approval.requested', 'task.approval.decided', 'task.progress', 'task.completed', 'task.failed'
];

export type AstrynFailureCode =
  | 'MODEL_UNAVAILABLE'
  | 'HOST_CONTRACT_MISSING'
  | 'NETWORK'
  | 'TIMEOUT'
  | 'UPSTREAM_REJECTED'
  | 'MALFORMED_STREAM'
  | 'ABORTED'
  | 'PERMISSION_DENIED'
  | 'UNKNOWN';

export interface KindToPayload {
  'input.focus': { readonly surface: 'composer' | 'chat-log' };
  'input.blur': { readonly surface: 'composer' | 'chat-log' };
  'turn.submitted': { readonly text: string; readonly characterId: string };
  'turn.cancelled': { readonly reason: 'user' | 'superseded' | 'unmount' };
  'stream.started': Record<string, never>;
  'stream.delta': { readonly text: string };
  'stream.completed': { readonly finishReason: string };
  'stream.failed': { readonly code: AstrynFailureCode; readonly message: string; readonly retryable: boolean };
  'model.unavailable': { readonly reason: string; readonly configuredSource: 'none' | 'aaos-host' | 'dev-proxy' | 'synthetic' };
  'task.approval.requested': { readonly actionSummary: string; readonly riskTier: 'low' | 'medium' | 'high' };
  'task.approval.decided': { readonly approved: boolean; readonly decidedBy: 'user' | 'policy' };
  'task.progress': { readonly step: string; readonly percent: number | null };
  'task.completed': { readonly summary: string };
  'task.failed': { readonly code: AstrynFailureCode; readonly message: string };
}

export type AstrynEventPayloadFor<K extends AstrynEventKind> = { readonly kind: K } & KindToPayload[K];
export type AstrynEventPayload = {
  readonly [K in AstrynEventKind]: AstrynEventPayloadFor<K>;
}[AstrynEventKind];

export type AstrynEvent<K extends AstrynEventKind = AstrynEventKind> = AstrynEventEnvelope<AstrynEventPayloadFor<K>>;

/** 判别联合形式的完整事件：消费侧用 event.payload.kind 收窄。 */
export type AstrynAnyEvent = AstrynEventEnvelope<AstrynEventPayload>;

export interface AstrynSourceInit {
  readonly source: AstrynEventSource;
  readonly trust: AstrynTrustLevel;
}

export function createEvent<K extends AstrynEventKind>(init: {
  readonly source: AstrynEventSource;
  readonly trust: AstrynTrustLevel;
  readonly kind: K;
  readonly payload: Omit<AstrynEventPayloadFor<K>, 'kind'>;
  readonly sessionId: string;
  readonly requestId?: string | null;
  readonly taskId?: string | null;
  readonly seq: number;
  readonly originSeq?: number | null;
  readonly eventId?: string;
  readonly emittedAt?: string;
}): AstrynEvent<K> {
  return {
    protocol: ASTRYN_PROTOCOL_VERSION,
    eventId: init.eventId ?? `${init.kind}:${init.sessionId}:${init.seq}`,
    sessionId: init.sessionId,
    requestId: init.requestId ?? null,
    taskId: init.taskId ?? null,
    seq: init.seq,
    originSeq: init.originSeq ?? null,
    source: init.source,
    trust: init.trust,
    emittedAt: init.emittedAt ?? new Date(0).toISOString(),
    payload: { kind: init.kind, ...init.payload } as AstrynEventPayloadFor<K>
  };
}
