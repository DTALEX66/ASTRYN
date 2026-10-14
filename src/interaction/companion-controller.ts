import {
  ASTRYN_PROTOCOL_VERSION,
  ASTRYN_UNKNOWN_OUTCOME_FAILURE_CODES,
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
  AstrynConversationAvailability,
  AstrynConversationPort,
  AstrynConversationRequest,
  AstrynEventKind,
  AstrynEventPayloadFor,
  AstrynFailureCode,
  AstrynHostPort,
  AstrynReceiptVerifier,
  AstrynRequestLookup,
  AstrynTrustLevel
} from '@astryn/contracts';
import { reduceCompanionState } from '../companion/reducer';
import { buildConversationMessages } from '../companion/prompt-composer';
import { AstrynEventGuard } from '../companion/session-guard';

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
  /** 最近一次被丢弃的原因：守卫拒绝（大写原因码）或 reducer 拒绝（note 文本）。 */
  readonly lastRejectedReason: string | null;
  /** 回执校验结果：定位"为什么这条任务事件不算权威"。 */
  readonly lastVerification: { readonly ok: boolean; readonly reason: string; readonly hasVerifier: boolean } | null;
}

/** 端口传输形态 → 事件里的配置来源标注（none 仅表示无端口，不用于成功探测）。 */
function configuredSourceOf(port: AstrynConversationPort): 'none' | 'aaos-host' | 'dev-proxy' | 'synthetic' {
  return port.transport === 'openai-compatible' ? 'dev-proxy' : port.transport === 'aaos-host' ? 'aaos-host' : port.transport === 'scripted-synthetic' ? 'synthetic' : 'none';
}

/** 上一轮未完成（失败或被停止）的重试候选：文本与材料标签原样保留。 */
export interface RetryCandidate {
  readonly requestId: string;
  readonly text: string;
  readonly cause: 'failed' | 'cancelled';
  readonly failureCode: AstrynFailureCode | null;
  /** 执行结果未知：重试前必须先查询原请求，防止重复执行。 */
  readonly outcomeUnknown: boolean;
}

/**
 * 重试处置：
 * - RESENT：已按新请求重发；lookup=null 表示结果已知未执行（未查询），
 *   否则是查询结果（not-found 安全重发 / unknown 可能重复执行）。
 * - RESENT_WITHOUT_LOOKUP：端口没有查询能力（宿主合同缺项），无法确认原请求是否已执行。
 * - HELD_BACK：原请求已完成或仍在执行，为避免重复执行未重发。
 */
export type RetryDisposition =
  | { readonly kind: 'RESENT'; readonly requestId: string; readonly lookup: AstrynRequestLookup | null }
  | { readonly kind: 'RESENT_WITHOUT_LOOKUP'; readonly requestId: string }
  | { readonly kind: 'HELD_BACK'; readonly lookup: AstrynRequestLookup };

export type ControllerRetryResult =
  | { readonly ok: false; readonly reason: 'NO_RETRY_CANDIDATE' | 'IN_FLIGHT' | 'DISPOSED' }
  | { readonly ok: true; readonly ofRequestId: string; readonly text: string; readonly disposition: RetryDisposition };

function isOutcomeUnknown(code: AstrynFailureCode | null): boolean {
  return code === null || ASTRYN_UNKNOWN_OUTCOME_FAILURE_CODES.includes(code);
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
  private lastRejectedReason: string | null = null;
  private lastVerification: ControllerAudit['lastVerification'] = null;
  private disposed = false;
  private idCounter = 0;
  private history: AstrynChatMessage[] = [];
  private pendingFragments: AstrynContextFragment[] = [];
  private activeSubmissions = 0;
  /**
   * 按原因计数的一切丢弃（审计 A5/A4）：守卫放行但 reducer 未采纳（note 文本）
   * 与控制器前置丢弃（kebab 原因，如 receipt-session-mismatch）。不静默丢。
   */
  private readonly droppedByReason = new Map<string, number>();
  private lastInterrupted: {
    readonly requestId: string;
    readonly text: string;
    readonly cause: 'failed' | 'cancelled';
    readonly failureCode: AstrynFailureCode | null;
    readonly fragments: readonly AstrynContextFragment[];
  } | null = null;
  private readonly fragmentsByRequest = new Map<string, readonly AstrynContextFragment[]>();

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
          this.#dispatch(event);
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
      // 探测成功同样落成事件（审计 A6）：不绕过守卫/reducer 直接改 state，revision 单调、可审计。
      this.#dispatch(this.emit({
        kind: 'model.available',
        payload: { configuredSource: configuredSourceOf(port) },
        source: 'system',
        trust: 'observed'
      }));
      return;
    }
    this.#dispatch(this.emit({
      kind: 'model.unavailable',
      payload: {
        reason: availability.reason ?? '模型接口不可用',
        configuredSource: configuredSourceOf(port)
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
      rejected: { ...this.guard.rejectionCounts(), ...Object.fromEntries(this.droppedByReason) },
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

  /**
   * 守卫 + reducer 的唯一入口。被拒事件不改变状态，但计入审计。
   * 原生 #private 是刻意的（风险 Q1）：权威事件只能经 ingestReceipt（校验器）
   * 或已 attach 的宿主通道进入，公开面上不得存在原始事件注入通道。
   */
  #dispatch(event: AstrynAnyEvent): void {
    if (this.disposed) return;
    const verdict = this.guard.accept(event);
    if (!verdict.accepted) {
      this.lastRejectedReason = verdict.reason;
      return;
    }
    const result = reduceCompanionState(this.state, event);
    if (!result.applied) {
      // reducer 拒绝同样是丢弃：按 note 计数并留下最近原因，不静默丢（审计 A5）。
      if (result.note) {
        this.droppedByReason.set(result.note, (this.droppedByReason.get(result.note) ?? 0) + 1);
        this.lastRejectedReason = result.note;
      }
      return;
    }
    this.appliedCount += 1;
    this.state = result.state;
    this.publish();
  }

  private publish(): void {
    for (const listener of this.listeners) listener(this.state);
  }

  notifyFocus(surface: 'composer' | 'chat-log' = 'composer'): void {
    this.#dispatch(this.emit({ kind: 'input.focus', payload: { surface }, source: 'user', trust: 'observed' }));
  }

  notifyBlur(surface: 'composer' | 'chat-log' = 'composer'): void {
    this.#dispatch(this.emit({ kind: 'input.blur', payload: { surface }, source: 'user', trust: 'observed' }));
  }

  /** 提交一轮对话。快速连续提交会先把上一轮标记为被取代，避免旧回复串台。 */
  async submit(text: string): Promise<{ requestId: string }> {
    if (this.disposed) throw new Error('controller disposed');
    const trimmed = text.trim();
    if (trimmed.length === 0) throw new Error('empty input');

    const requestId = this.nextId('req');
    const sessionAtSubmit = this.deps.sessionId;
    this.guard.openRequest(requestId);
    this.#dispatch(this.emit({ kind: 'turn.submitted', payload: { text: trimmed, characterId: this.deps.profile.characterId }, source: 'user', trust: 'observed', requestId }));

    const sentFragments = this.pendingFragments;
    this.pendingFragments = [];

    if (!this.deps.conversation) {
      this.#dispatch(this.emit({ kind: 'model.unavailable', payload: { reason: '未配置获准模型接口，星栖不使用脚本回复冒充 AI。', configuredSource: 'none' }, source: 'system', trust: 'observed', requestId }));
      this.guard.settleRequest(requestId);
      this.seqByKey.delete(`req:${requestId}`);
      this.lastInterrupted = { requestId, text: trimmed, cause: 'failed', failureCode: 'MODEL_UNAVAILABLE', fragments: sentFragments };
      this.publish();
      return { requestId };
    }

    // 端口存在但最新探测声明不可用：先重探一次（模型可能已恢复），仍不可用则不发真实请求。
    // 这消除"availability 说不可用、submit 却照发"的两信号矛盾（审计 A7）；输入进重试候选不丢。
    if (this.state.model.available === false) {
      let probe: AstrynConversationAvailability | null = null;
      try {
        probe = await this.deps.conversation.availability();
      } catch {
        probe = null;
      }
      if (!probe?.available) {
        this.#dispatch(this.emit({
          kind: 'model.unavailable',
          payload: { reason: probe?.reason ?? this.state.model.reason ?? '模型接口声明不可用', configuredSource: configuredSourceOf(this.deps.conversation) },
          source: 'system',
          trust: 'observed',
          requestId
        }));
        this.guard.settleRequest(requestId);
        this.seqByKey.delete(`req:${requestId}`);
        this.lastInterrupted = { requestId, text: trimmed, cause: 'failed', failureCode: 'MODEL_UNAVAILABLE', fragments: sentFragments };
        this.publish();
        return { requestId };
      }
      // 已恢复：与 attach 探测同一路径落成事件，再继续正常发送。
      this.#dispatch(this.emit({ kind: 'model.available', payload: { configuredSource: configuredSourceOf(this.deps.conversation) }, source: 'system', trust: 'observed' }));
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
      contextFragments: sentFragments
    };
    if (sentFragments.length > 0) this.fragmentsByRequest.set(requestId, sentFragments);
    this.activeSubmissions += 1;

    let failedCode: AstrynFailureCode | null = null;
    try {
      for await (const event of this.deps.conversation.stream(request, abort.signal)) {
        if (this.disposed || abort.signal.aborted) break;
        if (event.payload.kind === 'stream.failed') failedCode = event.payload.code;
        this.#dispatch(this.rebase(event, requestId));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failedCode = abort.signal.aborted ? 'ABORTED' : 'NETWORK';
      this.#dispatch(this.emit({
        kind: 'stream.failed',
        payload: { code: failedCode, message, retryable: !abort.signal.aborted },
        source: 'system',
        trust: 'observed',
        requestId
      }));
    } finally {
      this.activeSubmissions -= 1;
      this.abortByRequest.delete(requestId);
      this.guard.settleRequest(requestId);
      // 结清后释放该请求的序号计数：控制器集合不随对话轮数无界增长（审计 A9）。
      this.seqByKey.delete(`req:${requestId}`);
      const fragments = this.fragmentsByRequest.get(requestId) ?? [];
      this.fragmentsByRequest.delete(requestId);
      if (!this.disposed && this.guard.session === sessionAtSubmit) {
        if (abort.signal.aborted) {
          this.lastInterrupted = { requestId, text: trimmed, cause: 'cancelled', failureCode: 'ABORTED', fragments };
        } else if (failedCode) {
          this.lastInterrupted = { requestId, text: trimmed, cause: 'failed', failureCode: failedCode, fragments };
        } else {
          this.lastInterrupted = null;
        }
        if (!abort.signal.aborted && this.state.streamedText.length > 0) {
          this.history = [...this.history, {
            role: 'assistant',
            content: this.state.streamedText,
            sessionId: this.deps.sessionId,
            requestId
          }];
        }
        // 候选与部分落账都可能改变可渲染快照（重试候选 / 历史 / 审计），补一次推送。
        this.publish();
      }
    }
    return { requestId };
  }

  /**
   * 重试上一轮未完成的提交：保留原输入与材料标签。
   * 执行结果未知时先查询原请求再决定是否重发（防重复执行）；
   * 查询能力缺席或结果不可判定时如实降级并重发，绝不假装查过。
   * 重发永远使用新请求身份，不复用已结清的 requestId。
   */
  async retry(): Promise<ControllerRetryResult> {
    if (this.disposed) return { ok: false, reason: 'DISPOSED' };
    if (this.activeSubmissions > 0) return { ok: false, reason: 'IN_FLIGHT' };
    const candidate = this.lastInterrupted;
    if (!candidate) return { ok: false, reason: 'NO_RETRY_CANDIDATE' };

    const outcomeUnknown = isOutcomeUnknown(candidate.failureCode);
    const lookupCapable = typeof this.deps.conversation?.lookupRequest === 'function';
    let lookup: AstrynRequestLookup | null = null;
    if (outcomeUnknown && lookupCapable) {
      const port = this.deps.conversation;
      try {
        lookup = port?.lookupRequest ? await port.lookupRequest(candidate.requestId) : null;
      } catch (error) {
        lookup = {
          requestId: candidate.requestId,
          outcome: 'unknown',
          detail: `查询原请求失败：${error instanceof Error ? error.message : String(error)}`
        };
      }
      if (lookup && (lookup.outcome === 'completed' || lookup.outcome === 'in-progress')) {
        // 原请求已被执行或仍在执行：重发会造成重复执行，保留候选由用户决定。
        return { ok: true, ofRequestId: candidate.requestId, text: candidate.text, disposition: { kind: 'HELD_BACK', lookup } };
      }
      if (this.disposed) return { ok: false, reason: 'DISPOSED' };
    }

    // 材料标签回归到待附件队列：重试请求携带与失败轮完全相同的获准片段。
    this.pendingFragments = [...candidate.fragments, ...this.pendingFragments];
    this.lastInterrupted = null;
    let requestId: string;
    try {
      ({ requestId } = await this.submit(candidate.text));
    } catch {
      return { ok: false, reason: 'DISPOSED' };
    }
    if (outcomeUnknown && !lookup && !lookupCapable) {
      return { ok: true, ofRequestId: candidate.requestId, text: candidate.text, disposition: { kind: 'RESENT_WITHOUT_LOOKUP', requestId } };
    }
    return { ok: true, ofRequestId: candidate.requestId, text: candidate.text, disposition: { kind: 'RESENT', requestId, lookup } };
  }

  /** 上一轮未完成的输入与材料标签（重试通道的数据源）。 */
  get retryCandidate(): RetryCandidate | null {
    if (!this.lastInterrupted) return null;
    return {
      requestId: this.lastInterrupted.requestId,
      text: this.lastInterrupted.text,
      cause: this.lastInterrupted.cause,
      failureCode: this.lastInterrupted.failureCode,
      outcomeUnknown: isOutcomeUnknown(this.lastInterrupted.failureCode)
    };
  }

  /** 已附到下一轮请求但尚未提交的获准片段（材料标签）。 */
  get pendingContextFragments(): readonly AstrynContextFragment[] {
    return this.pendingFragments;
  }

  /** 撤下一个（尚未提交的）材料标签；越界索引是无效操作。 */
  removePendingContext(index: number): void {
    this.pendingFragments = this.pendingFragments.filter((_, position) => position !== index);
  }

  /** 把获准上下文片段附到下一轮请求上（M0-E 选中文本场景）。 */
  attachContext(fragments: readonly AstrynContextFragment[]): void {
    this.pendingFragments = [...this.pendingFragments, ...fragments];
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
      this.#dispatch(this.emit({ kind: 'turn.cancelled', payload: { reason }, source: 'user', trust: 'observed' }));
      return;
    }
    for (const [requestId, abort] of inFlight) {
      // 先以仍在途的请求身份派发取消事件，再结清该请求；
      // 顺序颠倒会让 turn.cancelled 自己被守卫判成 SETTLED_REQUEST。
      this.#dispatch(this.emit({ kind: 'turn.cancelled', payload: { reason }, source: 'user', trust: 'observed', requestId }));
      abort.abort();
      this.guard.settleRequest(requestId);
      this.seqByKey.delete(`req:${requestId}`);
    }
  }

  /** 宿主回执 → 权威事件。校验不通过则降级为 observed，守卫随即拒绝其改变任务状态。 */
  async ingestReceipt(receipt: AstrynActionReceipt): Promise<void> {
    if (this.disposed) return;
    // 回执携带归属且不属于本会话：丢弃，绝不移动本会话任务状态（审计 A4）。
    // null 归属（宿主未提供）按当前会话处理；不猜测、不回填其他会话。
    if (receipt.sessionId !== null && receipt.sessionId !== this.deps.sessionId) {
      this.droppedByReason.set('receipt-session-mismatch', (this.droppedByReason.get('receipt-session-mismatch') ?? 0) + 1);
      this.lastRejectedReason = 'receipt-session-mismatch';
      return;
    }
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

    this.#dispatch(
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

    // 终态回执后不再有该动作请求的合法后续：结清并释放序号状态，
    // 守卫与控制器集合不随任务数无界增长（审计 A9）。
    if (receipt.outcome === 'completed' || receipt.outcome === 'failed' || receipt.outcome === 'approval-denied') {
      this.guard.settleRequest(receipt.actionRequestId);
      this.seqByKey.delete(`req:${receipt.actionRequestId}`);
    }
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
    // 同步 deps.sessionId：emit 与回执归属守卫都以它为当前会话，
    // 不同步会让切换后的全部事件被守卫判成 INACTIVE_SESSION（控制器冻结）。
    this.deps = { ...this.deps, sessionId: nextSessionId };
    this.seqByKey.clear();
    this.history = [];
    this.pendingFragments = [];
    this.fragmentsByRequest.clear();
    this.lastInterrupted = null;
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
