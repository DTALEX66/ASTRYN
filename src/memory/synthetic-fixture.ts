import { ASTRYN_PROTOCOL_VERSION } from '@astryn/contracts';
import type {
  AstrynCandidateInput,
  AstrynMemoryCandidate,
  AstrynMemoryDenialReason,
  AstrynMemoryMutationReceipt,
  AstrynMemoryPort,
  AstrynMemoryQuery,
  AstrynMemoryReadResult,
  AstrynMemoryScope,
  AstrynMemoryScopeGrant,
  AstrynMemoryWriteResult
} from '@astryn/contracts';
import { decideLifecycle, decideRead, decideWrite } from './policy';

export interface FixtureOptions {
  readonly grants?: readonly AstrynMemoryScopeGrant[];
  readonly trustedIssuers?: readonly string[];
  readonly now?: () => string;
  readonly hostId?: string;
}

function defaultGrants(): AstrynMemoryScopeGrant[] {
  const grantedAt = new Date(0).toISOString();
  const scopes: AstrynMemoryScope[] = ['user_preference', 'companion_private', 'character_fiction', 'verified_fact'];
  return scopes.map((scope) => ({
    scope,
    read: true,
    write: true,
    grantedBy: 'user' as const,
    grantedAt,
    expiresAt: null
  }));
}

/**
 * 进程内可销毁记忆夹具。证据级别恒为 SYNTHETIC：
 * 它不是第二套长期记忆库，不落盘、不联网、dispose() 后即清空，
 * 生产记忆只能由 AAOS 权威存储承载。
 */
export class SyntheticMemoryFixture implements AstrynMemoryPort {
  readonly protocol = ASTRYN_PROTOCOL_VERSION;
  readonly hostId: string;
  readonly evidenceLevel = 'SYNTHETIC' as const;

  private readonly records = new Map<string, AstrynMemoryCandidate>();
  private readonly grants: readonly AstrynMemoryScopeGrant[];
  private readonly trustedIssuers: readonly string[];
  private readonly now: () => string;
  private counter = 0;
  private disposed = false;

  constructor(options: FixtureOptions = {}) {
    this.grants = options.grants ?? defaultGrants();
    this.trustedIssuers = options.trustedIssuers ?? ['aaos-core'];
    this.now = options.now ?? (() => new Date().toISOString());
    this.hostId = options.hostId ?? 'synthetic-memory-fixture';
  }

  get size(): number {
    return this.records.size;
  }

  async probe(): Promise<{ available: boolean; reason: string | null }> {
    return { available: false, reason: '合成夹具仅用于测试，不声称宿主记忆接口已接通。' };
  }

  async grantsFor(consumer: 'companion' | 'task' | 'knowledge' | 'ui'): Promise<readonly AstrynMemoryScopeGrant[]> {
    void consumer;
    return this.grants;
  }

  async propose(input: AstrynCandidateInput): Promise<AstrynMemoryWriteResult> {
    if (this.disposed) return { ok: false, reason: 'HOST_CONTRACT_MISSING' };
    const writeDecision = decideWrite(input.scope, this.grants, this.now());
    if (!writeDecision.allowed) return { ok: false, reason: writeDecision.reason };

    this.counter += 1;
    const candidate: AstrynMemoryCandidate = {
      schemaVersion: 1,
      id: `cand-${this.counter}`,
      scope: input.scope,
      origin: input.origin,
      lifecycle: 'candidate',
      summary: input.summary,
      sessionId: input.sessionId,
      requestId: input.requestId ?? null,
      createdAt: this.now(),
      confidence: input.confidence ?? null,
      confirmedByReceiptId: null,
      consentRecordId: null
    };
    this.records.set(candidate.id, candidate);
    return { ok: true, candidate };
  }

  async query(query: AstrynMemoryQuery): Promise<AstrynMemoryReadResult> {
    if (this.disposed) return { ok: false, reason: 'HOST_CONTRACT_MISSING', consumer: query.consumer, scope: query.scopes[0] ?? 'user_preference' };
    const readable: AstrynMemoryCandidate[] = [];
    for (const scope of query.scopes) {
      const decision = decideRead(query.consumer, scope, this.grants, this.now());
      if (!decision.allowed) {
        return { ok: false, reason: decision.reason, consumer: query.consumer, scope };
      }
    }
    const lifecycle = query.includeLifecycle;
    for (const record of this.records.values()) {
      if (!query.scopes.includes(record.scope)) continue;
      if (lifecycle && !lifecycle.includes(record.lifecycle)) continue;
      readable.push(record);
    }
    return { ok: true, records: readable, evidenceLevel: 'SYNTHETIC' };
  }

  private mutate(receipt: AstrynMemoryMutationReceipt, patch: Partial<AstrynMemoryCandidate>): AstrynMemoryWriteResult {
    const record = this.records.get(receipt.candidateId);
    if (!record) return { ok: false, reason: 'HOST_CONTRACT_MISSING' };
    const decision = decideLifecycle(record, receipt.to, this.trustedIssuers);
    if (!decision.allowed) return { ok: false, reason: decision.reason };
    const next: AstrynMemoryCandidate = {
      ...record,
      ...patch,
      lifecycle: receipt.to,
      confirmedByReceiptId: receipt.to === 'confirmed' ? receipt.receiptId : record.confirmedByReceiptId
    };
    this.records.set(next.id, next);
    return { ok: true, candidate: next };
  }

  async confirm(receipt: AstrynMemoryMutationReceipt): Promise<AstrynMemoryWriteResult> {
    return this.mutate(receipt, {});
  }

  async revoke(receipt: AstrynMemoryMutationReceipt): Promise<AstrynMemoryWriteResult> {
    return this.mutate(receipt, { confirmedByReceiptId: null });
  }

  async delete(receipt: AstrynMemoryMutationReceipt): Promise<{ readonly ok: boolean; readonly reason?: AstrynMemoryDenialReason }> {
    const record = this.records.get(receipt.candidateId);
    if (!record) return { ok: false, reason: 'HOST_CONTRACT_MISSING' };
    const decision = decideLifecycle(record, 'deleted', this.trustedIssuers);
    if (!decision.allowed) return { ok: false, reason: decision.reason };
    this.records.delete(receipt.candidateId);
    return { ok: true };
  }

  async listForReview(sessionId: string): Promise<readonly AstrynMemoryCandidate[]> {
    return [...this.records.values()].filter((record) => record.sessionId === sessionId);
  }

  dispose(): void {
    this.records.clear();
    this.disposed = true;
  }
}
