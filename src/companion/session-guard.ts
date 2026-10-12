import {
  ASTRYN_CONVERSATION_EVENT_KINDS,
  ASTRYN_PROTOCOL_VERSION,
  ASTRYN_TASK_EVENT_KINDS,
  isTaskAuthoritative
} from '@astryn/contracts';
import type { AstrynAnyEvent } from '@astryn/contracts';

const TASK_EVENT_KIND_SET = new Set<string>(ASTRYN_TASK_EVENT_KINDS);
const KNOWN_EVENT_KINDS = new Set<string>([...ASTRYN_CONVERSATION_EVENT_KINDS, ...ASTRYN_TASK_EVENT_KINDS]);

/** 事件被丢弃的原因。每个原因都有对应回归测试，不允许静默吞掉。 */
export const ASTRYN_REJECTION_REASONS = [
  'PROTOCOL_MISMATCH',
  'INACTIVE_SESSION',
  'INVALID_EVENT_KIND',
  'UNKNOWN_REQUEST',
  'SETTLED_REQUEST',
  'NON_MONOTONIC_SEQ',
  'OUT_OF_ORDER_ORIGIN_SEQ',
  'TASK_EVENT_NOT_AUTHORITATIVE',
  'TASK_EVENT_MISSING_TASK_ID'
] as const;
export type AstrynRejectionReason = (typeof ASTRYN_REJECTION_REASONS)[number];

export type AstrynAcceptResult = {
  readonly accepted: boolean;
  readonly reason: AstrynRejectionReason | null;
};

function seqKey(sessionId: string, requestId: string | null): string {
  return `${sessionId}|${requestId ?? '-'}`;
}

/**
 * 会话/请求/序号三重守卫：保证旧会话、已取消或已完成的请求、重复与乱序事件
 * 都不会写入当前状态。这是"取消与快速切换不串台"的唯一实现点。
 */
export class AstrynEventGuard {
  private activeSessionId: string;
  private readonly pending = new Set<string>();
  private readonly settled = new Set<string>();
  private readonly lastSeq = new Map<string, number>();
  private readonly lastOriginSeq = new Map<string, number>();
  private readonly rejectedCounts = new Map<AstrynRejectionReason, number>();

  constructor(sessionId: string) {
    this.activeSessionId = sessionId;
  }

  get session(): string {
    return this.activeSessionId;
  }

  get pendingRequestIds(): readonly string[] {
    return [...this.pending];
  }

  openRequest(requestId: string): void {
    this.pending.add(requestId);
    this.lastSeq.set(seqKey(this.activeSessionId, requestId), -1);
  }

  settleRequest(requestId: string): void {
    if (this.pending.delete(requestId)) this.settled.add(requestId);
  }

  /** 切换会话时，所有在途请求立即结清，其后续事件一律作废。 */
  switchSession(nextSessionId: string): void {
    for (const requestId of this.pending) this.settled.add(requestId);
    this.pending.clear();
    for (const key of [...this.lastSeq.keys()]) {
      if (key.startsWith(`${this.activeSessionId}|`)) this.lastSeq.delete(key);
    }
    for (const key of [...this.lastOriginSeq.keys()]) {
      if (key.startsWith(`${this.activeSessionId}|`)) this.lastOriginSeq.delete(key);
    }
    this.activeSessionId = nextSessionId;
  }

  rejectionCounts(): Readonly<Record<string, number>> {
    return Object.fromEntries(this.rejectedCounts);
  }

  private reject(reason: AstrynRejectionReason): AstrynAcceptResult {
    this.rejectedCounts.set(reason, (this.rejectedCounts.get(reason) ?? 0) + 1);
    return { accepted: false, reason };
  }

  accept(event: AstrynAnyEvent): AstrynAcceptResult {
    if (event.protocol !== ASTRYN_PROTOCOL_VERSION) return this.reject('PROTOCOL_MISMATCH');
    if (event.sessionId !== this.activeSessionId) return this.reject('INACTIVE_SESSION');

    // 判别字段缺失的信封（例如手工拼装的回执）必须先被挡下，
    // 否则它会绕过任务权威检查、在 reducer 里静默落空。
    const kind = (event.payload as { readonly kind?: unknown } | null | undefined)?.kind;
    if (typeof kind !== 'string' || !KNOWN_EVENT_KINDS.has(kind)) return this.reject('INVALID_EVENT_KIND');

    // 来源与可信级别先于关联身份判定：伪造的权威声明要报"不权威"，而不是"未知请求"。
    if (TASK_EVENT_KIND_SET.has(kind)) {
      if (!isTaskAuthoritative(event)) return this.reject('TASK_EVENT_NOT_AUTHORITATIVE');
      if (event.taskId === null) return this.reject('TASK_EVENT_MISSING_TASK_ID');
    }

    if (event.requestId !== null) {
      if (this.settled.has(event.requestId)) return this.reject('SETTLED_REQUEST');
      if (!this.pending.has(event.requestId)) return this.reject('UNKNOWN_REQUEST');
    }

    const key = seqKey(event.sessionId, event.requestId);
    const previous = this.lastSeq.get(key) ?? -1;
    if (!Number.isInteger(event.seq) || event.seq <= previous) return this.reject('NON_MONOTONIC_SEQ');

    // 宿主原始序号单独判序：本地重编号只能证明"我们没重复投递"，
    // 证明不了宿主没有乱序发来。
    if (typeof event.originSeq === 'number') {
      const previousOrigin = this.lastOriginSeq.get(key) ?? -1;
      if (event.originSeq <= previousOrigin) return this.reject('OUT_OF_ORDER_ORIGIN_SEQ');
      this.lastOriginSeq.set(key, event.originSeq);
    }

    this.lastSeq.set(key, event.seq);
    return { accepted: true, reason: null };
  }
}
