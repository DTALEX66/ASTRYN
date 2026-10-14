import { ASTRYN_PROTOCOL_VERSION } from '@astryn/contracts';
import type {
  AstrynActionPort,
  AstrynActionReceipt,
  AstrynActionRequest,
  AstrynActionSubmitResult,
  AstrynReceiptOutcome,
  AstrynReceiptVerifier,
  AstrynVerificationResult
} from '@astryn/contracts';

/**
 * 合成宿主模拟器：让"请求授权 → 审批 → 执行 → 完成/失败"这条权威回执链路
 * 可以在开发宿主与测试里被真正驱动。
 *
 * 每条回执都带 authority='synthetic-fixture'，界面必须显示 SYNTHETIC；
 * 它不是 AAOS，不构成任何真实集成证据（A17 仍为 UNVERIFIED）。
 */
export class SyntheticHostSimulator implements AstrynActionPort, AstrynReceiptVerifier {
  readonly protocol = ASTRYN_PROTOCOL_VERSION;
  readonly hostId = 'synthetic-host-simulator';
  readonly evidenceLevel = 'SYNTHETIC' as const;

  private readonly listeners = new Set<(receipt: AstrynActionReceipt) => void>();
  private readonly tasks = new Map<string, AstrynActionRequest>();
  private readonly seenReceiptIds = new Set<string>();
  private counter = 0;

  async probe(): Promise<{ available: boolean; reason: string | null }> {
    return { available: false, reason: '合成模拟器仅服务开发宿主与测试，不代表宿主动作接口已接通。' };
  }

  submit(request: AstrynActionRequest): Promise<AstrynActionSubmitResult> {
    this.counter += 1;
    const taskId = `syn-task-${this.counter}`;
    this.tasks.set(taskId, request);
    queueMicrotask(() => {
      this.emit(taskId, 'approval-requested', `需要授权：${request.summary}`, null, request.riskTier);
    });
    return Promise.resolve({ ok: true, taskId });
  }

  /** 每一步都走同一条"回执 → 校验 → 权威事件"路径。 */
  advance(taskId: string, outcome: Exclude<AstrynReceiptOutcome, 'approval-requested'>, detail?: string): void {
    if (!this.tasks.has(taskId)) return;
    if (outcome === 'approval-denied') {
      this.emit(taskId, outcome, detail ?? '用户拒绝授权', null, null);
      return;
    }
    if (outcome === 'approval-granted') {
      this.emit(taskId, outcome, '合成宿主：已按演示策略放行', null, null);
      return;
    }
    if (outcome === 'started') {
      this.emit(taskId, outcome, '正在执行（合成步骤 1/2）', null, null);
      return;
    }
    if (outcome === 'completed') {
      this.emit(taskId, outcome, '执行完成', null, null);
      this.tasks.delete(taskId);
      return;
    }
    this.emit(taskId, 'failed', `执行失败：${detail ?? '合成错误'}`, 'UNKNOWN', null);
    this.tasks.delete(taskId);
  }

  cancel(taskId: string): Promise<{ ok: boolean; reason?: string }> {
    if (!this.tasks.has(taskId)) return Promise.resolve({ ok: false, reason: 'UNKNOWN_TASK' });
    this.advance(taskId, 'failed', '已取消');
    return Promise.resolve({ ok: true });
  }

  subscribe(handler: (receipt: AstrynActionReceipt) => void): () => void {
    this.listeners.add(handler);
    return () => {
      this.listeners.delete(handler);
    };
  }

  /** 原样重放一条回执：验证校验器可拒重复。 */
  replay(receipt: AstrynActionReceipt): void {
    this.listeners.forEach((listener) => listener(receipt));
  }

  openTaskIds(): readonly string[] {
    return [...this.tasks.keys()];
  }

  private emit(
    taskId: string,
    outcome: AstrynReceiptOutcome,
    summary: string,
    failureCode: AstrynActionReceipt['failureCode'],
    riskTier: AstrynActionRequest['riskTier'] | null
  ): void {
    const request = this.tasks.get(taskId);
    this.counter += 1;
    const receipt: AstrynActionReceipt = {
      receiptId: `synr-${this.counter}`,
      taskId,
      actionRequestId: request?.requestId ?? taskId,
      sessionId: request?.sessionId ?? null,
      outcome,
      issuedBy: this.hostId,
      issuedAt: new Date().toISOString(),
      summary,
      failureCode,
      riskTier,
      authority: 'synthetic-fixture',
      signature: `sig-synr-${this.counter}`
    };
    for (const listener of this.listeners) listener(receipt);
  }

  async verify(receipt: AstrynActionReceipt): Promise<AstrynVerificationResult> {
    if (receipt.authority !== 'synthetic-fixture') return { ok: false, reason: 'UNKNOWN_ISSUER', issuer: receipt.issuedBy };
    if (this.seenReceiptIds.has(receipt.receiptId)) return { ok: false, reason: 'REPLAYED', issuer: receipt.issuedBy };
    if (receipt.issuedBy !== this.hostId) return { ok: false, reason: 'UNKNOWN_ISSUER', issuer: receipt.issuedBy };
    if (receipt.signature.length === 0) return { ok: false, reason: 'BAD_SIGNATURE', issuer: receipt.issuedBy };
    this.seenReceiptIds.add(receipt.receiptId);
    return { ok: true, reason: 'SIGNED_BY_TRUSTED_HOST', issuer: receipt.issuedBy };
  }
}
