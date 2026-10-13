import {
  ASTRYN_PROTOCOL_VERSION,
  createEvent,
  initialState
} from '@astryn/contracts';
import type {
  AstrynActionPort,
  AstrynActionReceipt,
  AstrynAnyEvent,
  AstrynCharacterProfile,
  AstrynChatMessage,
  AstrynCompanionState,
  AstrynContextFragment,
  AstrynConversationPort,
  AstrynConversationRequest,
  AstrynEventKind,
  AstrynEventPayloadFor,
  AstrynHostPort,
  AstrynReceiptVerifier,
  AstrynTrustLevel
} from '@astryn/contracts';
import { reduceCompanionState } from '../companion/reducer';
import { buildConversationMessages } from '../companion/prompt-composer';
import { AstrynEventGuard } from '../companion/session-guard';
import type { AstrynRejectionReason } from '../companion/session-guard';

export interface CompanionControllerDeps {
  readonly sessionId: string;
  readonly profile: AstrynCharacterProfile;
  readonly conversation: AstrynConversationPort | null;
  readonly actions: AstrynActionPort | null;
  readonly verifier: AstrynReceiptVerifier | null;
  readonly host?: AstrynHostPort | null;
  readonly nextId?: (prefix: string) => string;
}

export interface ControllerAudit {
  readonly applied: number;
  readonly rejected: Readonly<Record<string, number>>;
  readonly lastRejectedReason: AstrynRejectionReason | null;
  /** 回执校验结果：定位"为什么这条任务事件不算权威"。 */
  readonly lastVerification: { readonly ok: boolean; readonly reason: string; readonly hasVerifier: boolean } | null;
}

type Listener = (state: AstrynCompanionState) => void;

const SESSION_SCOPED_KEY = '\u0000session';

/**
 * 编排 ports + guard + reducer 的运行时核心。不依赖 React，可单独测试。
 * 卸载时必须 dispose()：中止在途请求、退订宿主事件、阻止后续状态推送。
 */
export class AstrynCompanionController {
  private state: AstrynCompanionState;
  private readonly guard: AstrynEventGuard;
  private readonly seqByKey = new Map<string, number>();
  private readonly listeners = new Set<Listener>();
  private readonly abortByRequest = new Map<string, AbortController>();
  private readonly unsubscribes: Array<() => void> = [];
  private appliedCount = 0;
  private lastRejectedReason: AstrynRejectionReason | null = null;
  private lastVerification: ControllerAudit['lastVerification'] = null;
  private disposed = false;
  private idCounter = 0;
  private history: AstrynChatMessage[] = [];
  private pendingContextFragments: AstrynContextFragment[] = [];

  constructor(private deps: CompanionControllerDeps) {
    this.guard = new AstrynEventGuard(deps.sessionId);
    this.state = initialState(deps.sessionId, {
      kind: deps.conversation ? (deps.conversation.transport === 'aaos-host' ? 'aaos-host' : deps.conversation.transport === 'openai-compatible' ? 'openai-compatible-dev' : 'synthetic') : 'none',
      providerId: deps.conversation?.providerId ?? null,
      modelId: deps.conversation?.modelId ?? null,
      available: deps.conversation !== null,
      reason: deps.conversation ? null : '未配置获准模型接口',
      evidenceLevel: deps.conversation?.evidenceLevel ?? 'NO_EVIDENCE'
    });
  }

  /**
   * 构造必须是纯的：React 会重复调用 useState 初始化器，被丢弃的实例若已订阅宿主，
   * 就会消耗掉一次性回执（校验器按 receiptId 去重），让真正在用的实例收到 REPLAYED。
   * 因此宿主订阅只在 attach() 建立，并由返回的 detach 或 dispose() 解除。
   */
  attach(): () => void {
    if (this.unsubscribes.length > 0 || this.disposed) return () => undefined;
    if (this.deps.actions) {
      this.unsubscribes.push(
        this.deps.actions.subscribe((receipt) => {
          void this.ingestReceipt(receipt);
        })
      );
    }
    if (this.deps.host) {
      this.unsubscribes.push(
        this.deps.host.onAuthoritativeEvent((event) => {
          this.dispatch(event);
        })
      );
    }
    // 启动即探测：代理没起来时应在用户发消息之前就把 MODEL_UNAVAILABLE 摆出来。
    if (this.deps.conversation) void this.refreshModelAvailability();

    return () => {
      this.detachHost();
    };
  }

  /** 向端口做一次真实可用性探测，并把结果落成事件而不是靠界面文案猜。 */
  async refreshModelAvailability(): Promise<void> {
    const port = this.deps.conversation;
    if (!port) return;
    let availability;
    try {
      availability = await port.availability();
    } catch (error) {
      availability = { available: false, reason: error instanceof Error ? error.message : String(error), failureCode: 'NETWORK' as const };
    }
    if (this.disposed) return;
    if (availability.available) {
      this.state = { ...this.state, model: { ...this.state.model, available: true, reason: null } };
      this.publish();
      return;
    }
    this.dispatch(this.emit({
      kind: 'model.unavailable',
      payload: {
        reason: availability.reason ?? '模型接口不可用',
        configuredSource: port.transport === 'openai-compatible' ? 'dev-proxy' : port.transport === 'aaos-host' ? 'aaos-host' : 'none'
      },
      source: 'system',
      trust: 'observed'
    }));
  }

  private detachHost(): void {
    for (const unsubscribe of this.unsubscribes) unsubscribe();
    this.unsubscribes.length = 0;
  }

  get currentState(): AstrynCompanionState {
    return this.state;
  }

  /** 已完成轮次的只读记录。进行中的回复只在 state.streamedText 里，不重复计一份。 */
  get transcript(): readonly AstrynChatMessage[] {
    return this.history;
  }

  get audit(): ControllerAudit {
    return {
      applied: this.appliedCount,
      rejected: this.guard.rejectionCounts(),
      lastRejectedReason: this.lastRejectedReason,
      lastVerification: this.lastVerification
    };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private nextId(prefix: string): string {
    if (this.deps.nextId) return this.deps.nextId(prefix);
    this.idCounter += 1;
    return `${prefix}-${this.deps.sessionId}-${this.idCounter}`;
  }

  private nextSeq(key: string): number {
    const next = (this.seqByKey.get(key) ?? -1) + 1;
    this.seqByKey.set(key, next);
    return next;
  }

  private emit<K extends AstrynEventKind>(input: {
    readonly kind: K;
    readonly payload: Omit<AstrynEventPayloadFor<K>, 'kind'>;
    readonly source: 'user' | 'character' | 'conversation' | 'system';
    readonly trust: AstrynTrustLevel;
    readonly requestId?: string | null;
  }): AstrynAnyEvent {
    const key = input.requestId ? `req:${input.requestId}` : SESSION_SCOPED_KEY;
    return createEvent({
      source: input.source,
      trust: input.trust,
      kind: input.kind,
      payload: input.payload,
      sessionId: this.deps.sessionId,
      requestId: input.requestId ?? null,
      taskId: null,
      seq: this.nextSeq(key),
      eventId: this.nextId('evt'),
      emittedAt: new Date().toISOString()
    }) as unknown as AstrynAnyEvent;
  }

  /** 守卫 + reducer 的唯一入口。被拒事件不改变状态，但计入审计。 */
  dispatch(event: AstrynAnyEvent): void {
    if (this.disposed) return;
    const verdict = this.guard.accept(event);
    if (!verdict.accepted) {
      this.lastRejectedReason = verdict.reason;
      return;
    }
    const result = reduceCompanionState(this.state, event);
    if (!result.applied) return;
    this.appliedCount += 1;
    this.state = result.state;
    this.publish();
  }

  private publish(): void {
    for (const listener of this.listeners) listener(this.state);
  }

  notifyFocus(surface: 'composer' | 'chat-log' = 'composer'): void {
    this.dispatch(this.emit({ kind: 'input.focus', payload: { surface }, source: 'user', trust: 'observed' }));
  }

  notifyBlur(surface: 'composer' | 'chat-log' = 'composer'): void {
    this.dispatch(this.emit({ kind: 'input.blur', payload: { surface }, source: 'user', trust: 'observed' }));
  }

  /** 提交一轮对话。快速连续提交会先把上一轮标记为被取代，避免旧回复串台。 */
  async submit(text: string): Promise<{ requestId: string }> {
    if (this.disposed) throw new Error('controller disposed');
    const trimmed = text.trim();
    if (trimmed.length === 0) throw new Error('empty input');

    const requestId = this.nextId('req');
    this.guard.openRequest(requestId);
    this.dispatch(this.emit({ kind: 'turn.submitted', payload: { text: trimmed, characterId: this.deps.profile.characterId }, source: 'user', trust: 'observed', requestId }));

    if (!this.deps.conversation) {
      this.dispatch(this.emit({ kind: 'model.unavailable', payload: { reason: '未配置获准模型接口，星栖不使用脚本回复冒充 AI。', configuredSource: 'none' }, source: 'system', trust: 'observed', requestId }));
      this.guard.settleRequest(requestId);
      return { requestId };
    }

    const abort = new AbortController();
    this.abortByRequest.set(requestId, abort);
    const priorHistory = this.history;
    this.history = [...priorHistory, { role: 'user', content: trimmed, sessionId: this.deps.sessionId, requestId }];

    const request: AstrynConversationRequest = {
      protocol: ASTRYN_PROTOCOL_VERSION,
      sessionId: this.deps.sessionId,
      requestId,
      characterId: this.deps.profile.characterId,
      messages: buildConversationMessages(this.deps.profile, priorHistory, trimmed, this.deps.sessionId),
      contextFragments: this.pendingContextFragments
    };
    this.pendingContextFragments = [];

    try {
      for await (const event of this.deps.conversation.stream(request, abort.signal)) {
        if (this.disposed || abort.signal.aborted) break;
        this.dispatch(this.rebase(event, requestId));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.dispatch(this.emit({
        kind: 'stream.failed',
        payload: { code: abort.signal.aborted ? 'ABORTED' : 'NETWORK', message, retryable: !abort.signal.aborted },
        source: 'system',
        trust: 'observed',
        requestId
      }));
    } finally {
      this.abortByRequest.delete(requestId);
      this.guard.settleRequest(requestId);
      if (!abort.signal.aborted && this.state.streamedText.length > 0) {
        this.history = [...this.history, {
          role: 'assistant',
          content: this.state.streamedText,
          sessionId: this.deps.sessionId,
          requestId
        }];
      }
    }
    return { requestId };
  }

  /** 把获准上下文片段附到下一轮请求上（M0-E 选中文本场景）。 */
  attachContext(fragments: readonly AstrynContextFragment[]): void {
    this.pendingContextFragments = [...this.pendingContextFragments, ...fragments];
  }

  /** 把传输层事件重新绑定到本轮请求身份，同时保留宿主原始序号供守卫判序。 */
  private rebase(event: AstrynAnyEvent, requestId: string): AstrynAnyEvent {
    return {
      ...event,
      seq: this.nextSeq(`req:${requestId}`),
      originSeq: typeof event.seq === 'number' ? event.seq : null,
      sessionId: this.deps.sessionId,
      requestId,
      source: 'conversation',
      trust: event.trust === 'authoritative' ? 'observed' : event.trust
    };
  }

  /** 取消当前在途请求：中止传输、结清请求身份，并把角色切到 interrupted。 */
  cancel(reason: 'user' | 'superseded' | 'unmount' = 'user'): void {
    const inFlight = [...this.abortByRequest.entries()];
    if (inFlight.length === 0) {
      this.dispatch(this.emit({ kind: 'turn.cancelled', payload: { reason }, source: 'user', trust: 'observed' }));
      return;
    }
    for (const [requestId, abort] of inFlight) {
      // 先以仍在途的请求身份派发取消事件，再结清该请求；
      // 顺序颠倒会让 turn.cancelled 自己被守卫判成 SETTLED_REQUEST。
      this.dispatch(this.emit({ kind: 'turn.cancelled', payload: { reason }, source: 'user', trust: 'observed', requestId }));
      abort.abort();
      this.guard.settleRequest(requestId);
    }
  }

  /** 宿主回执 → 权威事件。校验不通过则降级为 observed，守卫随即拒绝其改变任务状态。 */
  async ingestReceipt(receipt: AstrynActionReceipt): Promise<void> {
    if (this.disposed) return;
    const verification = this.deps.verifier
      ? await this.deps.verifier.verify(receipt)
      : { ok: false as const, reason: 'NO_VERIFIER' as const, issuer: receipt.issuedBy };
    this.lastVerification = {
      ok: verification.ok,
      reason: String(verification.reason),
      hasVerifier: this.deps.verifier !== null
    };
    const trust: AstrynTrustLevel = verification.ok ? 'authoritative' : 'observed';

    if (!this.guard.pendingRequestIds.includes(receipt.actionRequestId)) {
      this.guard.openRequest(receipt.actionRequestId);
    }

    const kind: AstrynEventKind =
      receipt.outcome === 'approval-requested' ? 'task.approval.requested'
      : receipt.outcome === 'approval-granted' ? 'task.approval.decided'
      : receipt.outcome === 'approval-denied' ? 'task.approval.decided'
      : receipt.outcome === 'started' ? 'task.progress'
      : receipt.outcome === 'completed' ? 'task.completed'
      : 'task.failed';

    const payload =
      kind === 'task.approval.requested'
        ? { actionSummary: receipt.summary ?? '宿主请求授权', riskTier: receipt.riskTier ?? ('medium' as const) }
        : kind === 'task.approval.decided'
          ? { approved: receipt.outcome === 'approval-granted', decidedBy: 'user' as const }
          : kind === 'task.progress'
            ? { step: receipt.summary ?? '执行中', percent: null }
            : kind === 'task.completed'
              ? { summary: receipt.summary ?? '任务完成' }
              : { code: receipt.failureCode ?? 'UNKNOWN', message: receipt.summary ?? '任务失败' };

    this.dispatch(
      createEvent({
        source: 'host-task',
        trust,
        kind: kind as never,
        payload: payload as never,
        sessionId: this.deps.sessionId,
        requestId: receipt.actionRequestId,
        taskId: receipt.taskId,
        seq: this.nextSeq(`req:${receipt.actionRequestId}`),
        eventId: `receipt:${receipt.receiptId}`,
        emittedAt: receipt.issuedAt
      }) as unknown as AstrynAnyEvent
    );
  }

  /**
   * 配置变化时在不重建实例的前提下替换档案：
   * 设置面板不应打断会话连续性（守卫状态、历史与在途请求）。
   * 档案会在下一轮请求组装提示时生效。
   */
  setProfile(profile: AstrynCharacterProfile): void {
    if (this.deps.profile === profile) return;
    this.deps = { ...this.deps, profile };
  }

  switchSession(nextSessionId: string): void {
    for (const [, abort] of this.abortByRequest) abort.abort();
    this.abortByRequest.clear();
    this.guard.switchSession(nextSessionId);
    this.seqByKey.clear();
    this.history = [];
    this.pendingContextFragments = [];
    this.state = initialState(nextSessionId, this.state.model);
    this.publish();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const [, abort] of this.abortByRequest) abort.abort();
    this.abortByRequest.clear();
    this.detachHost();
    this.listeners.clear();
  }
}
