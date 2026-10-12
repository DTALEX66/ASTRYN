import type { AstrynFailureCode } from './events';
import type { AstrynProtocolVersion } from './protocol';

/** 对话呈现状态：由用户输入与请求生命周期驱动。 */
export const ASTRYN_CONVERSATION_STATES = [
  'idle',
  'listening',
  'thinking',
  'speaking',
  'interrupted'
] as const;
export type AstrynConversationState = (typeof ASTRYN_CONVERSATION_STATES)[number];

/** 任务状态：只能由宿主权威回执写入，模型正文无权改变。 */
export const ASTRYN_TASK_STATES = [
  'none',
  'awaiting_approval',
  'executing',
  'completed',
  'failed'
] as const;
export type AstrynTaskStateName = (typeof ASTRYN_TASK_STATES)[number];

export const ASTRYN_TASK_STATES_REQUIRING_RECEIPT: readonly AstrynTaskStateName[] = [
  'awaiting_approval', 'executing', 'completed', 'failed'
];

export interface AstrynFailure {
  readonly code: AstrynFailureCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly origin: 'conversation' | 'task' | 'host' | 'memory' | 'context';
}

export type AstrynModelSourceKind = 'none' | 'aaos-host' | 'openai-compatible-dev' | 'synthetic';

export interface AstrynModelSourceInfo {
  readonly kind: AstrynModelSourceKind;
  readonly providerId: string | null;
  readonly modelId: string | null;
  /** true 仅当确有可用模型接口；否则界面必须显示 MODEL_UNAVAILABLE。 */
  readonly available: boolean;
  readonly reason: string | null;
  readonly evidenceLevel: 'REAL' | 'SYNTHETIC' | 'NO_EVIDENCE';
}

export interface AstrynTaskState {
  readonly status: AstrynTaskStateName;
  readonly taskId: string | null;
  readonly requestId: string | null;
  readonly actionSummary: string | null;
  readonly riskTier: 'low' | 'medium' | 'high' | null;
  readonly step: string | null;
  readonly percent: number | null;
  readonly failure: AstrynFailure | null;
  /** 只有校验通过的宿主回执才能填充该字段；用于证明状态来源可信。 */
  readonly receiptId: string | null;
}

export interface AstrynCompanionState {
  readonly protocol: AstrynProtocolVersion;
  readonly sessionId: string;
  readonly revision: number;
  readonly conversation: AstrynConversationState;
  readonly activeRequestId: string | null;
  readonly streamedText: string;
  /** 口型/表情帧：只随真实 stream.delta 推进，不来自定时器。 */
  readonly expressionFrame: number;
  readonly task: AstrynTaskState;
  readonly failure: AstrynFailure | null;
  readonly model: AstrynModelSourceInfo;
}

export type AstrynVisibleState =
  | AstrynConversationState
  | 'awaiting_approval'
  | 'executing'
  | 'completed'
  | 'failed';

/**
 * 角色可见状态的唯一判定：任务状态优先于对话状态。
 * "模型说完一句话"不会映射到 completed/executing，因此不可能伪装成任务进展。
 */
export function toVisibleState(state: AstrynCompanionState): AstrynVisibleState {
  if (state.task.status === 'awaiting_approval') return 'awaiting_approval';
  if (state.task.status === 'executing') return 'executing';
  if (state.task.status === 'completed') return 'completed';
  if (state.task.status === 'failed') return 'failed';
  if (state.failure?.origin === 'conversation') return 'interrupted';
  return state.conversation;
}

export function initialTaskState(): AstrynTaskState {
  return {
    status: 'none',
    taskId: null,
    requestId: null,
    actionSummary: null,
    riskTier: null,
    step: null,
    percent: null,
    failure: null,
    receiptId: null
  };
}

export function initialState(sessionId: string, model: AstrynModelSourceInfo): AstrynCompanionState {
  return {
    protocol: 'astryn-1',
    sessionId,
    revision: 0,
    conversation: 'idle',
    activeRequestId: null,
    streamedText: '',
    expressionFrame: 0,
    task: initialTaskState(),
    failure: null,
    model
  };
}
