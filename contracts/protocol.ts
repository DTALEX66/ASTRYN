/**
 * ASTRYN 传输协议与事件信封。
 * 契约层不得依赖 React、Vite 或任何宿主实现。
 */

export const ASTRYN_PROTOCOL_VERSION = 'astryn-1' as const;
export type AstrynProtocolVersion = typeof ASTRYN_PROTOCOL_VERSION;

/** 事件来源。任务审批、执行与结果只承认 host-action / host-task。 */
export const ASTRYN_EVENT_SOURCES = [
  'user',
  'character',
  'conversation',
  'host-action',
  'host-task',
  'host-memory',
  'host-context',
  'system'
] as const;
export type AstrynEventSource = (typeof ASTRYN_EVENT_SOURCES)[number];

/**
 * 可信级别决定状态机是否接受该事件改变任务状态。
 * - authoritative：由宿主适配器在校验收据后签发，星栖自身不得伪造。
 * - observed：可观测但不构成权威（流式文本、输入焦点）。
 * - synthetic：测试夹具或明确标注的合成演示数据，永不进入权威判定。
 */
export const ASTRYN_TRUST_LEVELS = ['authoritative', 'observed', 'synthetic'] as const;
export type AstrynTrustLevel = (typeof ASTRYN_TRUST_LEVELS)[number];

export const ASTRYN_TASK_SOURCES: readonly AstrynEventSource[] = ['host-action', 'host-task'];

export function isAstrynEventSource(value: unknown): value is AstrynEventSource {
  return (ASTRYN_EVENT_SOURCES as readonly string[]).includes(String(value));
}

export function isAstrynTrustLevel(value: unknown): value is AstrynTrustLevel {
  return (ASTRYN_TRUST_LEVELS as readonly string[]).includes(String(value));
}

/** 一个事件在权威链上的位置：会话、请求、任务三级关联标识 + 单调序号。 */
export interface AstrynEventEnvelope<TPayload = unknown> {
  readonly protocol: AstrynProtocolVersion;
  readonly eventId: string;
  readonly sessionId: string;
  /** 用户发起的一轮请求；无请求上下文的系统事件为 null。 */
  readonly requestId: string | null;
  /** 关联的 AAOS 任务标识；仅宿主可赋值。 */
  readonly taskId: string | null;
  /** 同一 (sessionId, requestId) 内单调递增，用于丢弃重复与过期。 */
  readonly seq: number;
  /**
   * 宿主或传输层自己给出的原始序号。守卫对它单独做单调性判定：
   * 只看本地重编号的 seq 等于把"乱序/迟到"检测丢给了自己，宿主侧的真实乱序看不见。
   */
  readonly originSeq: number | null;
  readonly source: AstrynEventSource;
  readonly trust: AstrynTrustLevel;
  readonly emittedAt: string;
  readonly payload: TPayload;
}

/** 事件来源与可信级别的组合约束：违反者一律拒收，不信任自报字段。 */
export function isTaskAuthoritative(
  envelope: Pick<AstrynEventEnvelope, 'source' | 'trust'>
): boolean {
  return (
    envelope.trust === 'authoritative' &&
    ASTRYN_TASK_SOURCES.includes(envelope.source)
  );
}

export type AstrynEnvelopeIssue =
  | 'PROTOCOL_MISMATCH'
  | 'MISSING_EVENT_ID'
  | 'MISSING_SESSION_ID'
  | 'INVALID_REQUEST_ID'
  | 'INVALID_TASK_ID'
  | 'INVALID_SEQ'
  | 'INVALID_ORIGIN_SEQ'
  | 'INVALID_SOURCE'
  | 'INVALID_TRUST'
  | 'INVALID_TIMESTAMP'
  | 'MISSING_PAYLOAD';

export interface AstrynEnvelopeParseResult<T> {
  readonly ok: boolean;
  readonly issues: readonly AstrynEnvelopeIssue[];
  readonly value?: AstrynEventEnvelope<T>;
}

function isValidIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

/**
 * 在适配器边界对来自宿主/模型的未知数据做结构校验。
 * 内部构造器产出的信封不依赖此函数保证正确性。
 */
export function parseAstrynEventEnvelope<T = unknown>(
  input: unknown,
  expectedProtocol: AstrynProtocolVersion = ASTRYN_PROTOCOL_VERSION
): AstrynEnvelopeParseResult<T> {
  const issues: AstrynEnvelopeIssue[] = [];
  if (typeof input !== 'object' || input === null) {
    return { ok: false, issues: ['MISSING_PAYLOAD'] };
  }
  const raw = input as Record<string, unknown>;

  if (raw.protocol !== expectedProtocol) issues.push('PROTOCOL_MISMATCH');
  if (typeof raw.eventId !== 'string' || raw.eventId.length === 0) issues.push('MISSING_EVENT_ID');
  if (typeof raw.sessionId !== 'string' || raw.sessionId.length === 0) issues.push('MISSING_SESSION_ID');
  if (typeof raw.seq !== 'number' || !Number.isInteger(raw.seq) || raw.seq < 0) issues.push('INVALID_SEQ');
  if (raw.originSeq !== null && raw.originSeq !== undefined && (!Number.isInteger(raw.originSeq) || (raw.originSeq as number) < 0)) {
    issues.push('INVALID_ORIGIN_SEQ');
  }
  if (!isAstrynEventSource(raw.source)) issues.push('INVALID_SOURCE');
  if (!isAstrynTrustLevel(raw.trust)) issues.push('INVALID_TRUST');
  if (!isValidIsoTimestamp(raw.emittedAt)) issues.push('INVALID_TIMESTAMP');
  if (!('payload' in raw)) issues.push('MISSING_PAYLOAD');
  if (raw.requestId !== null && typeof raw.requestId !== 'string') issues.push('INVALID_REQUEST_ID');
  if (raw.taskId !== null && typeof raw.taskId !== 'string') issues.push('INVALID_TASK_ID');

  if (issues.length > 0) return { ok: false, issues };

  return {
    ok: true,
    issues: [],
    value: {
      protocol: expectedProtocol,
      eventId: raw.eventId as string,
      sessionId: raw.sessionId as string,
      requestId: typeof raw.requestId === 'string' ? raw.requestId : null,
      taskId: typeof raw.taskId === 'string' ? raw.taskId : null,
      seq: raw.seq as number,
      originSeq: typeof raw.originSeq === 'number' ? raw.originSeq : null,
      source: raw.source as AstrynEventSource,
      trust: raw.trust as AstrynTrustLevel,
      emittedAt: raw.emittedAt as string,
      payload: raw.payload as T
    }
  };
}
