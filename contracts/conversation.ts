import type { AstrynAnyEvent, AstrynFailureCode } from './events';
import type { AstrynContextFragment } from './context';
import type { AstrynProtocolVersion } from './protocol';

export type AstrynChatRole = 'system' | 'user' | 'assistant';

export interface AstrynChatMessage {
  readonly role: AstrynChatRole;
  readonly content: string;
  readonly sessionId: string;
  readonly requestId: string | null;
}

export interface AstrynConversationRequest {
  readonly protocol: AstrynProtocolVersion;
  readonly sessionId: string;
  readonly requestId: string;
  readonly characterId: string;
  readonly messages: readonly AstrynChatMessage[];
  readonly contextFragments: readonly AstrynContextFragment[];
}

export type AstrynTransportKind = 'aaos-host' | 'openai-compatible' | 'scripted-synthetic';

export interface AstrynConversationAvailability {
  readonly available: boolean;
  readonly reason: string | null;
  readonly failureCode: AstrynFailureCode | null;
}

/**
 * 重试前可达的原请求状态。语义与"正式流合同"绑定：
 * - completed：宿主已执行完该请求（正文是否可取回由宿主另定，本查询不下发正文）。
 * - in-progress：宿主仍在执行；本地重发会造成重复执行。
 * - not-found：宿主对该请求 ID 无记录，重发不会撞上已有执行。
 * - unknown：宿主无法判断（能力缺项或查询失败），重发可能重复执行。
 */
export type AstrynRequestLookupOutcome = 'completed' | 'in-progress' | 'not-found' | 'unknown';

export interface AstrynRequestLookup {
  readonly requestId: string;
  readonly outcome: AstrynRequestLookupOutcome;
  readonly detail: string | null;
}

/**
 * 重试前必须"先查询原请求"的失败码：此刻本端不知道上游是否已经执行。
 * 已知未执行的失败（UPSTREAM_REJECTED / MODEL_UNAVAILABLE / PERMISSION_DENIED）不在此列。
 */
export const ASTRYN_UNKNOWN_OUTCOME_FAILURE_CODES: readonly AstrynFailureCode[] = [
  'NETWORK',
  'TIMEOUT',
  'MALFORMED_STREAM',
  'ABORTED',
  'UNKNOWN'
];

/**
 * 会话与流式对话端口。
 * 端口自己签发事件的 source/trust：传输层不得把自身事件标成 authoritative，
 * 否则模型正文就能改写任务状态。
 *
 * 正式流合同（GF07）：
 * - 每个请求以 requestId 为身份；本地重试必须以"新请求身份"重发，不复用已结清的 ID。
 * - 流内事件按 seq 单调；乱序/重复由编排层守卫丢弃，端口无需自证有序。
 * - 请求结清（完成/失败/取消）后到达的事件一律作废，不得再改变状态或触发动作。
 * - lookupRequest 只回答"宿主是否已执行过该请求"，用于重试前的重复执行防护；
 *   端口不实现它时必须如实缺席，由编排层报告"不可查询"，不得假装已查询。
 */
export interface AstrynConversationPort {
  readonly protocol: AstrynProtocolVersion;
  readonly providerId: string;
  readonly transport: AstrynTransportKind;
  readonly evidenceLevel: 'REAL' | 'SYNTHETIC';
  readonly modelId: string | null;
  availability(): Promise<AstrynConversationAvailability>;
  stream(request: AstrynConversationRequest, signal: AbortSignal): AsyncIterable<AstrynAnyEvent>;
  lookupRequest?(requestId: string): Promise<AstrynRequestLookup>;
}
