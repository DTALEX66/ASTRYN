/**
 * AAOS Host Adapter（有类型、有版本、有权限）。
 *
 * 端点与语义来自 docs/architecture/AAOS-HOST-CAPABILITY-MAP.md 的只读核验结论，
 * 关键约束在此复述以免被误用：
 *  - POST /api/v1/jobs/{id}/executions 返回 202 只代表"声明已持久化"，不代表任务完成。
 *  - 宿主无事件推送面，权威进展只能轮询 job status 获得。
 *  - outputs/{kind} 带 authority_effect=candidate_or_measurement_only，不得当作权威状态。
 *  - 记忆写入只有 candidate 语义，晋升永远 human-only；星栖不可自我确认。
 *  - 不存在"当前选区"广播合同，故 ContextPort 的真实实现必须显式拒绝而非猜测。
 * 本文件的默认配置一律"未连接"：没有显式 baseUrl 与 launch token 时，
 * 所有端口返回可用性缺失，绝不降级成脚本冒充宿主。
 */

import { ASTRYN_PROTOCOL_VERSION } from '@astryn/contracts';
import { conversationEvent } from './conversation-event';
import { ASTRYN_PORT_MANIFEST, interpretCapabilityRegistry, interpretVersionPayload, isCompatibleHostContract, readingFor } from './host-handshake';
import type {
  AstrynActionPort,
  AstrynActionReceipt,
  AstrynActionRequest,
  AstrynActionSubmitResult,
  AstrynAnyEvent,
  AstrynContextAuthorization,
  AstrynContextPort,
  AstrynContextReadResult,
  AstrynContextScope,
  AstrynConversationAvailability,
  AstrynConversationPort,
  AstrynConversationRequest,
  AstrynEventKind,
  AstrynEventPayloadFor,
  AstrynHostCapabilities,
  AstrynHostCapabilityReading,
  AstrynHostPort,
  AstrynHostUnavailable,
  AstrynGrantRequest,
  AstrynMemoryCandidate,
  AstrynMemoryDenialReason,
  AstrynMemoryMutationReceipt,
  AstrynMemoryPort,
  AstrynMemoryQuery,
  AstrynMemoryReadResult,
  AstrynMemoryScopeGrant,
  AstrynMemoryWriteResult,
  AstrynCandidateInput,
  AstrynReceiptVerifier,
  AstrynVerificationResult
} from '@astryn/contracts';

export const AAOS_API_PREFIX = '/api/v1';
export const AAOS_ENDPOINTS = {
  version: `${AAOS_API_PREFIX}/system/version`,
  capabilities: `${AAOS_API_PREFIX}/capabilities`,
  machineAnswers: `${AAOS_API_PREFIX}/machine/answers`,
  knowledgeItems: `${AAOS_API_PREFIX}/knowledge-items`,
  machineContexts: `${AAOS_API_PREFIX}/machine/contexts`,
  contextPackets: `${AAOS_API_PREFIX}/ai/context-packets`,
  jobs: `${AAOS_API_PREFIX}/jobs`,
  jobStatus: (id: string): string => `${AAOS_API_PREFIX}/jobs/${encodeURIComponent(id)}`,
  jobExecutions: (id: string): string => `${AAOS_API_PREFIX}/jobs/${encodeURIComponent(id)}/executions`,
  jobCancel: (id: string, requestId: string): string =>
    `${AAOS_API_PREFIX}/jobs/${encodeURIComponent(id)}/executions/${encodeURIComponent(requestId)}/cancel`,
  jobOutput: (id: string, kind: string): string => `${AAOS_API_PREFIX}/jobs/${encodeURIComponent(id)}/outputs/${encodeURIComponent(kind)}`
} as const;

export interface AaosTransport {
  request(path: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }): Promise<Response>;
}

export interface AaosBridgeConfig {
  /** 未配置即视为宿主不可连接；不猜测端口、不扫描磁盘。 */
  readonly baseUrl: string | null;
  readonly launchTokenProvider?: () => string | null;
  readonly transport?: AaosTransport;
  readonly pollIntervalMs?: number;
  readonly fetchImpl?: typeof fetch;
}

export class UnconfiguredAaosTransport implements AaosTransport {
  request(): Promise<Response> {
    return Promise.reject(new Error('AAOS Core baseUrl 未配置'));
  }
}

export class AaosHostBridge implements AstrynHostPort, AstrynReceiptVerifier {
  readonly hostId = 'aaos-core';
  readonly protocol = ASTRYN_PROTOCOL_VERSION;

  private readonly transport: AaosTransport;
  private readonly configured: boolean;

  constructor(private readonly config: AaosBridgeConfig) {
    this.configured = typeof config.baseUrl === 'string' && config.baseUrl.length > 0;
    this.transport = config.transport ?? new UnconfiguredAaosTransport();
  }

  get connected(): boolean {
    return this.configured;
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    const token = this.config.launchTokenProvider?.() ?? null;
    // 头名按 AAOS_HOST_HAND_VERIFIED 记录：x-archeaxis-launch-token（actor 由服务端派生）。
    // 带 Origin 头的请求一律 403，故适配器绝不添加 origin。
    return {
      'content-type': 'application/json',
      ...(token ? { 'x-archeaxis-launch-token': token } : {}),
      ...(extra ?? {})
    };
  }

  async probeCapabilities(): Promise<AstrynHostCapabilities | AstrynHostUnavailable> {
    if (!this.configured) {
      return {
        available: false,
        code: 'HOST_CONTRACT_MISSING',
        detail: '未配置 AAOS Core 地址与 launch token；星栖不猜测宿主现场。'
      };
    }
    try {
      const response = await this.transport.request(AAOS_ENDPOINTS.version, { method: 'GET', headers: this.headers() });
      if (!response.ok) {
        return { available: false, code: 'AUTHORITY_REFERENCE_MISSING', detail: `AAOS Core ${AAOS_ENDPOINTS.version} 返回 ${response.status}` };
      }
      const version = interpretVersionPayload(await response.json());
      if (version.observedProtocol !== null && !isCompatibleHostContract(version.observedProtocol)) {
        return {
          available: false,
          code: 'PROTOCOL_MISMATCH',
          detail: `宿主报告 api_contract=${version.observedProtocol}，星栖只对接主版本 1`
        };
      }
      // 能力注册表：读不到就是读不到，逐项落 UNKNOWN；绝不用默认值补齐。
      let readings: AstrynHostCapabilityReading[] = [];
      let registryNote: string | null = null;
      try {
        const registry = await this.transport.request(AAOS_ENDPOINTS.capabilities, { method: 'GET', headers: this.headers() });
        if (registry.ok) readings = [...interpretCapabilityRegistry(await registry.json())];
        else registryNote = `能力注册表返回 ${registry.status}：未知不当可用，全部按未确认处理。`;
      } catch (error) {
        registryNote = `能力注册表不可读：${String(error)}：未知不当可用，全部按未确认处理。`;
      }
      const capabilityState = (candidates: readonly string[]): boolean => {
        const reading = readingFor(readings, candidates);
        return reading !== null && reading.state === 'AVAILABLE_UNVERIFIED';
      };
      const protocolConfirmed = version.observedProtocol !== null && isCompatibleHostContract(version.observedProtocol);
      // 协议未确认时，五个宿主端口一律 fail-closed（即使注册表看起来很健康）。
      const confirmedState = (candidates: readonly string[]): boolean => protocolConfirmed && capabilityState(candidates);
      return {
        protocol: ASTRYN_PROTOCOL_VERSION,
        // 宿主只提供一次性问答，无通用流式 chat completion（能力图谱第 1 节）。
        conversation: confirmedState(ASTRYN_PORT_MANIFEST[1]?.hostCapabilityCandidates ?? []),
        memory: confirmedState(ASTRYN_PORT_MANIFEST[2]?.hostCapabilityCandidates ?? []),
        context: confirmedState(ASTRYN_PORT_MANIFEST[4]?.hostCapabilityCandidates ?? []),
        actions: confirmedState(ASTRYN_PORT_MANIFEST[3]?.hostCapabilityCandidates ?? []),
        // 宿主无签名/校验面：回执权威性无法确认。不接受非空摘要充当数字签名（GF04 验收）。
        authoritativeReceipts: false,
        streamResume: false,
        hostBuildIdentity: version.hostBuildIdentity,
        observedProtocol: version.observedProtocol,
        protocolConfirmed,
        hostRuntime: version.hostRuntime,
        capabilityRegistry: readings,
        capabilityRegistryNote: registryNote
      };
    } catch (error) {
      return { available: false, code: 'AUTHORITY_REFERENCE_MISSING', detail: `AAOS Core 不可达：${String(error)}` };
    }
  }

  conversation(): AstrynConversationPort | null {
    return this.configured ? new AaosMachineAnswerPort(this.transport, this.headers.bind(this), () => this.probeCapabilities()) : null;
  }

  memory(): AstrynMemoryPort | null {
    return this.configured ? new AaosMemoryPort(this.transport, this.headers.bind(this)) : null;
  }

  context(): AstrynContextPort | null {
    return this.configured ? new AaosContextPort(this.transport, this.headers.bind(this)) : null;
  }

  actions(): AstrynActionPort | null {
    return this.configured ? new AaosActionPort(this.transport, this.headers.bind(this), this.config.pollIntervalMs ?? 1_000) : null;
  }

  async requestGrant(request: AstrynGrantRequest): Promise<{ granted: readonly string[]; denied: readonly string[] }> {
    if (!this.configured) return { granted: [], denied: request.scopes };
    // AAOS 的 Consumer 是闭集枚举，星栖尚未是被命名消费者：不假装授权成功。
    return { granted: [], denied: request.scopes };
  }

  /** 宿主无事件推送面；订阅只能是空实现，进展由 ActionPort 轮询提供。 */
  onAuthoritativeEvent(): () => void {
    return () => undefined;
  }

  /**
   * 回执校验：AAOS Core 现面没有任何签名/校验端点（能力图谱无 signing 面），
   * 因此无论连没连上，星栖都没有校验器可用 —— 一律 NO_VERIFIER。
   * 不接受"非空字符串回执"或 digest 冒充数字签名（GF04 验收逐字条款）。
   * synthetic-fixture 回执只属于合成模拟器，真实适配器拒绝。
   */
  verify(receipt: AstrynActionReceipt): Promise<AstrynVerificationResult> {
    if (receipt.authority !== 'aaos-core') {
      return Promise.resolve({ ok: false, reason: 'UNKNOWN_ISSUER', issuer: receipt.issuedBy });
    }
    if (!this.configured) return Promise.resolve({ ok: false, reason: 'NO_VERIFIER', issuer: receipt.issuedBy });
    return Promise.resolve({
      ok: false,
      reason: 'NO_VERIFIER',
      issuer: receipt.issuedBy
    });
  }
}

class AaosMachineAnswerPort implements AstrynConversationPort {
  readonly protocol = ASTRYN_PROTOCOL_VERSION;
  readonly providerId = 'aaos-machine-answers';
  readonly transport = 'aaos-host' as const;
  readonly evidenceLevel = 'REAL' as const;
  readonly modelId: string | null = null;

  constructor(
    private readonly http: AaosTransport,
    private readonly headers: (extra?: Record<string, string>) => Record<string, string>,
    private readonly probeCapabilities?: () => Promise<AstrynHostCapabilities | AstrynHostUnavailable>
  ) {}

  /**
   * 可用性来自真实能力探测（版本 + 能力注册表），而不是恒 false 的常量（审计 A7）：
   * 宿主无通用流式 chat completion，但 machine/answers 是一次性问答通路——
   * stream() 会实调这个端点，availability() 就不能宣称它不存在。
   * 注册表未确认会话能力时如实报缺（未知不当可用）。
   */
  async availability(): Promise<AstrynConversationAvailability> {
    if (!this.probeCapabilities) {
      return { available: false, reason: '缺少能力探测注入：未知不当可用。', failureCode: 'HOST_CONTRACT_MISSING' };
    }
    try {
      const probe = await this.probeCapabilities();
      if ('available' in probe) {
        return {
          available: false,
          reason: probe.detail,
          failureCode: probe.code === 'AUTHORITY_REFERENCE_MISSING' ? 'NETWORK' : 'HOST_CONTRACT_MISSING'
        };
      }
      if (!probe.conversation) {
        return {
          available: false,
          reason: '能力注册表未确认会话能力（未知不当可用）：宿主无通用流式 chat completion，machine/answers 为一次性问答。',
          failureCode: 'HOST_CONTRACT_MISSING'
        };
      }
      return { available: true, reason: null, failureCode: null };
    } catch (error) {
      return { available: false, reason: `AAOS 能力探测失败：${error instanceof Error ? error.message : String(error)}`, failureCode: 'NETWORK' };
    }
  }

  /** 一次性问答映射为"单个 delta + completed"，不伪造逐字流式。 */
  async *stream(request: AstrynConversationRequest, signal: AbortSignal): AsyncGenerator<AstrynAnyEvent> {
    let seq = 0;
    const make = <K extends AstrynEventKind>(kind: K, payload: Omit<AstrynEventPayloadFor<K>, 'kind'>): AstrynAnyEvent =>
      conversationEvent({ kind, payload, sessionId: request.sessionId, requestId: request.requestId, seq: seq++ });

    yield make('stream.started', {});
    try {
      const response = await this.http.request(AAOS_ENDPOINTS.machineAnswers, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          protocol: ASTRYN_PROTOCOL_VERSION,
          session_id: request.sessionId,
          request_id: request.requestId,
          input: request.messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n')
        }),
        signal
      });
      if (!response.ok) {
        yield make('stream.failed', { code: 'UPSTREAM_REJECTED', message: `AAOS Core 返回 ${response.status}`, retryable: response.status >= 500 });
        return;
      }
      const body = (await response.json()) as { answer?: string; text?: string };
      const text = typeof body.answer === 'string' ? body.answer : typeof body.text === 'string' ? body.text : '';
      yield make('stream.delta', { text });
      yield make('stream.completed', { finishReason: 'aaos-machine-answer-onshot' });
    } catch (error) {
      yield make('stream.failed', {
        code: signal.aborted ? 'ABORTED' : 'NETWORK',
        message: error instanceof Error ? error.message : String(error),
        retryable: !signal.aborted
      });
    }
  }
}

class AaosMemoryPort implements AstrynMemoryPort {
  readonly protocol = ASTRYN_PROTOCOL_VERSION;
  readonly hostId = 'aaos-core';
  readonly evidenceLevel = 'REAL' as const;

  constructor(
    private readonly http: AaosTransport,
    private readonly headers: (extra?: Record<string, string>) => Record<string, string>
  ) {}

  async probe(): Promise<{ available: boolean; reason: string | null }> {
    return {
      available: false,
      reason: 'AAOS 记忆的 Consumer 为闭集枚举（local-machine / manual-context-packet），星栖尚未是被命名消费者。'
    };
  }

  async grantsFor(): Promise<readonly AstrynMemoryScopeGrant[]> {
    return [];
  }

  async propose(input: AstrynCandidateInput): Promise<AstrynMemoryWriteResult> {
    if (input.origin === 'model-generated') {
      // 模型自述永远只产 candidate；晋升由 human review 决定，星栖侧无该路径。
      return { ok: false, reason: 'ORIGIN_NOT_PROPOSABLE' };
    }
    try {
      const response = await this.http.request(AAOS_ENDPOINTS.knowledgeItems, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ kind: 'candidate', summary: input.summary, scope: input.scope, session_id: input.sessionId })
      });
      if (!response.ok) return { ok: false, reason: 'HOST_CONTRACT_MISSING' };
    } catch {
      return { ok: false, reason: 'HOST_CONTRACT_MISSING' };
    }
    return {
      ok: true,
      candidate: {
        schemaVersion: 1,
        id: `aaos-candidate-${Date.now()}`,
        scope: input.scope,
        origin: input.origin,
        lifecycle: 'candidate',
        summary: input.summary,
        sessionId: input.sessionId,
        requestId: input.requestId ?? null,
        createdAt: new Date().toISOString(),
        confidence: input.confidence ?? null,
        confirmedByReceiptId: null,
        consentRecordId: null
      }
    };
  }

  async query(input: AstrynMemoryQuery): Promise<AstrynMemoryReadResult> {
    try {
      await this.http.request(AAOS_ENDPOINTS.machineContexts, { method: 'GET', headers: this.headers() });
    } catch {
      return { ok: false, reason: 'HOST_CONTRACT_MISSING', consumer: input.consumer, scope: input.scopes[0] ?? 'user_preference' };
    }
    return { ok: false, reason: 'SCOPE_NOT_GRANTED', consumer: input.consumer, scope: input.scopes[0] ?? 'user_preference' };
  }

  /** 晋升 / 撤销 / 删除在 AAOS 侧是 human-only（machine 403），星栖不得自任。 */
  confirm(_receipt: AstrynMemoryMutationReceipt): Promise<AstrynMemoryWriteResult> {
    return Promise.resolve({ ok: false, reason: 'HOST_CONTRACT_MISSING' });
  }

  revoke(_receipt: AstrynMemoryMutationReceipt): Promise<AstrynMemoryWriteResult> {
    return Promise.resolve({ ok: false, reason: 'HOST_CONTRACT_MISSING' });
  }

  delete(_receipt: AstrynMemoryMutationReceipt): Promise<{ readonly ok: boolean; readonly reason?: AstrynMemoryDenialReason }> {
    return Promise.resolve({ ok: false, reason: 'HOST_CONTRACT_MISSING' });
  }

  async listForReview(): Promise<readonly AstrynMemoryCandidate[]> {
    return [];
  }
}

class AaosContextPort implements AstrynContextPort {
  readonly protocol = ASTRYN_PROTOCOL_VERSION;
  readonly hostId = 'aaos-core';
  readonly evidenceLevel = 'REAL' as const;

  constructor(
    private readonly http: AaosTransport,
    private readonly headers: (extra?: Record<string, string>) => Record<string, string>
  ) {}

  async probe(): Promise<{ available: boolean; supportedScopes: readonly AstrynContextScope[]; reason: string | null }> {
    void this.http;
    void this.headers;
    return {
      available: false,
      supportedScopes: ['task-context'],
      reason: 'AAOS 有 machine/contexts 投影与 grant-fenced context-packets，但不存在"当前选区"广播合同。'
    };
  }

  async requestAuthorization(): Promise<AstrynContextAuthorization | null> {
    return null;
  }

  async readSelection(): Promise<AstrynContextReadResult> {
    return { ok: false, reason: 'SCOPE_NOT_SUPPORTED' };
  }
}

interface JobStatusRecord {
  readonly job_id?: string;
  readonly status?: string;
  readonly state?: string;
  readonly detail?: string;
}

/**
 * AAOS job status → 回执结果的显式白名单（审计 A1）。
 * 未列入的状态不产生任何回执：宿主返回未知值时宁可停在上一状态，
 * 也不把未知默认成'执行中'——那会让 cancelled/denied 类终态永远轮询下去。
 * cancelled/denied 等终态在 ASTRYN 词表里没有对应项，以 failed 收束（原始状态保留在 summary）。
 */
const RECEIPT_OUTCOME_BY_STATUS: Readonly<Record<string, AstrynActionReceipt['outcome']>> = {
  completed: 'completed',
  succeeded: 'completed',
  failed: 'failed',
  errored: 'failed',
  cancelled: 'failed',
  canceled: 'failed',
  denied: 'failed',
  rejected: 'failed',
  expired: 'failed',
  timed_out: 'failed',
  running: 'started',
  claimed: 'started',
  executing: 'started',
  queued: 'started',
  pending: 'started'
};

class AaosActionPort implements AstrynActionPort {
  readonly protocol = ASTRYN_PROTOCOL_VERSION;
  readonly hostId = 'aaos-core';
  readonly evidenceLevel = 'REAL' as const;

  private readonly listeners = new Set<(receipt: AstrynActionReceipt) => void>();
  private readonly timers = new Map<string, ReturnType<typeof setInterval>>();

  constructor(
    private readonly http: AaosTransport,
    private readonly headers: (extra?: Record<string, string>) => Record<string, string>,
    private readonly pollIntervalMs: number
  ) {}

  async probe(): Promise<{ available: boolean; reason: string | null }> {
    // 宿主可达 ≠ 动作可用：必须协议已确认且注册表命中 AVAILABLE_UNVERIFIED（GF04 fail-closed）。
    try {
      const versionResponse = await this.http.request(AAOS_ENDPOINTS.version, { method: 'GET', headers: this.headers() });
      if (!versionResponse.ok) return { available: false, reason: `版本面返回 ${versionResponse.status}` };
      const version = interpretVersionPayload(await versionResponse.json());
      if (version.observedProtocol === null || !isCompatibleHostContract(version.observedProtocol)) {
        return { available: false, reason: `宿主协议未确认（observed=${version.observedProtocol ?? '未报告'}）：未知不当可用` };
      }
      const response = await this.http.request(AAOS_ENDPOINTS.capabilities, { method: 'GET', headers: this.headers() });
      if (!response.ok) return { available: false, reason: `capability registry 返回 ${response.status}` };
      const candidates = ASTRYN_PORT_MANIFEST[3]?.hostCapabilityCandidates ?? [];
      const reading = readingFor(interpretCapabilityRegistry(await response.json()), candidates);
      if (!reading || reading.state !== 'AVAILABLE_UNVERIFIED') {
        return {
          available: false,
          reason: reading ? `动作能力注册表状态 ${reading.state}：${reading.detail}` : `注册表未出现动作能力（候选 ${candidates.join('/')}）：未知不当可用`
        };
      }
      return { available: true, reason: null };
    } catch (error) {
      return { available: false, reason: `AAOS Core 不可达：${String(error)}` };
    }
  }

  async submit(request: AstrynActionRequest): Promise<AstrynActionSubmitResult> {
    try {
      const enqueued = await this.http.request(AAOS_ENDPOINTS.jobs, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ kind: request.actionKind, summary: request.summary, risk_tier: request.riskTier })
      });
      if (!enqueued.ok) return { ok: false, reason: 'PERMISSION_DENIED' };
      const created = (await enqueued.json()) as { id?: string; job_id?: string };
      const jobId = created.job_id ?? created.id;
      if (typeof jobId !== 'string') return { ok: false, reason: 'HOST_CONTRACT_MISSING' };

      // 202 只表示执行声明已持久化，不表示任务完成。
      await this.http.request(AAOS_ENDPOINTS.jobExecutions(jobId), {
        method: 'POST',
        headers: this.headers({ 'idempotency-key': request.requestId }),
        body: JSON.stringify({ deadline_ms: 30_000 })
      });
      this.watch(jobId, request);
      return { ok: true, taskId: jobId };
    } catch {
      return { ok: false, reason: 'NETWORK' };
    }
  }

  async cancel(taskId: string): Promise<{ ok: boolean; reason?: string }> {
    const active = this.jobBindings.get(taskId);
    if (!active) return { ok: false, reason: 'UNKNOWN_TASK' };
    const response = await this.http.request(AAOS_ENDPOINTS.jobCancel(taskId, active.requestId), { method: 'POST', headers: this.headers() });
    return response.ok ? { ok: true } : { ok: false, reason: `HTTP ${response.status}` };
  }

  // job_id -> 关联的请求身份，供 cancel 使用。
  private readonly jobBindings = new Map<string, { requestId: string }>();

  subscribe(handler: (receipt: AstrynActionReceipt) => void): () => void {
    this.listeners.add(handler);
    return () => {
      this.listeners.delete(handler);
    };
  }

  /** AAOS 无事件推送：轮询 job status 是唯一权威进展来源。 */
  private watch(jobId: string, request: AstrynActionRequest): void {
    this.jobBindings.set(jobId, { requestId: request.requestId });
    const timer = setInterval(() => {
      void this.poll(jobId, request);
    }, this.pollIntervalMs);
    this.timers.set(jobId, timer);
  }

  private async poll(jobId: string, request: AstrynActionRequest): Promise<void> {
    try {
      const response = await this.http.request(AAOS_ENDPOINTS.jobStatus(jobId), { method: 'GET', headers: this.headers() });
      if (!response.ok) return;
      const record = (await response.json()) as JobStatusRecord;
      const status = record.status ?? record.state ?? 'unknown';
      const outcome = RECEIPT_OUTCOME_BY_STATUS[status];
      // 白名单之外（含字段缺失、宿主新增未知状态）：不产生回执、不改任何状态。
      if (outcome === undefined) return;
      const receipt: AstrynActionReceipt = {
        receiptId: `${jobId}:${status}:${Date.now()}`,
        taskId: jobId,
        actionRequestId: request.requestId,
        // 会话归属按提交时捕获的请求会话盖章（审计 A4）：轮询本身与会话无关，不能回填"当前"会话。
        sessionId: request.sessionId,
        outcome,
        issuedBy: 'aaos-core',
        issuedAt: new Date().toISOString(),
        summary: record.detail ?? status,
        failureCode: outcome === 'failed' ? 'UPSTREAM_REJECTED' : null,
        riskTier: request.riskTier,
        authority: 'aaos-core',
        // 宿主无签名面：不拿 jobId/status 拼串冒充签名；空串即"无签名材料"。
        signature: ''
      };
      for (const listener of this.listeners) listener(receipt);
      if (outcome === 'completed' || outcome === 'failed') {
        const timer = this.timers.get(jobId);
        if (timer) clearInterval(timer);
        this.timers.delete(jobId);
        this.jobBindings.delete(jobId);
      }
    } catch {
      // 轮询失败不产生任何状态：状态只能来自成功读取的 job status。
    }
  }
}
