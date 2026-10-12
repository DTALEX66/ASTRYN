import {
  initialTaskState,
  isTaskAuthoritative
} from '@astryn/contracts';
import type {
  AstrynAnyEvent,
  AstrynCompanionState,
  AstrynFailure
} from '@astryn/contracts';

export interface ReduceResult {
  readonly state: AstrynCompanionState;
  readonly applied: boolean;
  readonly note: string | null;
}

function bump(prev: AstrynCompanionState, state: AstrynCompanionState): AstrynCompanionState {
  return state === prev ? prev : { ...state, revision: prev.revision + 1 };
}

function conversationFailure(code: AstrynFailure['code'], message: string, retryable: boolean): AstrynFailure {
  return { code, message, retryable, origin: 'conversation' };
}

/**
 * 纯状态 reducer。前置条件是事件已通过 AstrynEventGuard；本函数只负责语义。
 *
 * 权威边界（对应验收 A08）：
 * - 任务状态迁移只接受 trust=authoritative 且 source=host-action/host-task 的事件。
 * - 对话侧事件（含模型正文里"任务已完成"这类文本）对 task 字段是零写入。
 * - stream.completed 只代表"这句话说完"，与任务完成无关。
 */
export function reduceCompanionState(prev: AstrynCompanionState, event: AstrynAnyEvent): ReduceResult {
  const payload = event.payload;

  switch (payload.kind) {
    case 'input.focus': {
      if (prev.conversation !== 'idle') return { state: prev, applied: false, note: 'focus-ignored-non-idle' };
      return { state: bump(prev, { ...prev, conversation: 'listening' }), applied: true, note: null };
    }

    case 'input.blur': {
      if (prev.conversation !== 'listening') return { state: prev, applied: false, note: 'blur-ignored-non-listening' };
      return { state: bump(prev, { ...prev, conversation: 'idle' }), applied: true, note: null };
    }

    case 'turn.submitted': {
      if (event.requestId === null) return { state: prev, applied: false, note: 'turn-without-request' };
      const keepsTask = prev.task.status === 'awaiting_approval' || prev.task.status === 'executing';
      return {
        state: bump(prev, {
          ...prev,
          conversation: 'thinking',
          activeRequestId: event.requestId,
          streamedText: '',
          expressionFrame: 0,
          failure: null,
          task: keepsTask ? prev.task : initialTaskState()
        }),
        applied: true,
        note: keepsTask ? 'authoritative-task-preserved' : null
      };
    }

    case 'turn.cancelled': {
      return {
        state: bump(prev, {
          ...prev,
          conversation: 'interrupted',
          activeRequestId: null,
          failure: prev.failure
        }),
        applied: true,
        note: null
      };
    }

    case 'stream.started': {
      if (prev.activeRequestId !== event.requestId) return { state: prev, applied: false, note: 'stream-for-inactive-request' };
      return { state: bump(prev, { ...prev, conversation: 'thinking' }), applied: true, note: null };
    }

    case 'stream.delta': {
      if (prev.activeRequestId !== event.requestId) return { state: prev, applied: false, note: 'delta-for-inactive-request' };
      return {
        state: bump(prev, {
          ...prev,
          conversation: 'speaking',
          streamedText: prev.streamedText + payload.text,
          // 帧号只随真实到达的数据递增，不来自定时器，也不接受外部传入。
          expressionFrame: prev.expressionFrame + 1,
          // 只有真正收到非合成端口的回复内容，才把证据级别升为 REAL。
          model: prev.model.kind === 'synthetic'
            ? prev.model
            : { ...prev.model, evidenceLevel: 'REAL' },
          failure: null
        }),
        applied: true,
        note: null
      };
    }

    case 'stream.completed': {
      if (prev.activeRequestId !== event.requestId) return { state: prev, applied: false, note: 'completion-for-inactive-request' };
      return {
        state: bump(prev, { ...prev, conversation: 'idle', activeRequestId: null }),
        applied: true,
        note: 'utterance-end-is-not-task-completion'
      };
    }

    case 'stream.failed': {
      if (prev.activeRequestId !== event.requestId) return { state: prev, applied: false, note: 'failure-for-inactive-request' };
      return {
        state: bump(prev, {
          ...prev,
          conversation: 'interrupted',
          activeRequestId: null,
          failure: conversationFailure(payload.code, payload.message, payload.retryable)
        }),
        applied: true,
        note: null
      };
    }

    case 'model.unavailable': {
      return {
        state: bump(prev, {
          ...prev,
          conversation: prev.conversation === 'idle' ? 'idle' : 'interrupted',
          activeRequestId: null,
          model: {
            ...prev.model,
            available: false,
            reason: payload.reason,
            evidenceLevel: prev.model.evidenceLevel === 'SYNTHETIC' ? 'SYNTHETIC' : 'NO_EVIDENCE'
          },
          failure: conversationFailure('MODEL_UNAVAILABLE', payload.reason, false)
        }),
        applied: true,
        note: null
      };
    }

    case 'task.approval.requested':
    case 'task.approval.decided':
    case 'task.progress':
    case 'task.completed':
    case 'task.failed': {
      if (!isTaskAuthoritative(event) || event.taskId === null) {
        return { state: prev, applied: false, note: 'task-event-requires-authoritative-receipt' };
      }
      const base = {
        ...prev.task,
        taskId: event.taskId,
        requestId: event.requestId ?? prev.task.requestId,
        receiptId: `receipt:${event.eventId}`
      };
      switch (payload.kind) {
        case 'task.approval.requested':
          return {
            state: bump(prev, {
              ...prev,
              task: { ...base, status: 'awaiting_approval', actionSummary: payload.actionSummary, riskTier: payload.riskTier, step: null, percent: null, failure: null }
            }),
            applied: true,
            note: null
          };
        case 'task.approval.decided':
          return {
            state: bump(prev, {
              ...prev,
              task: payload.approved
                ? { ...base, status: 'executing', step: '已获授权，等待执行进度', percent: null, failure: null }
                : { ...initialTaskState(), receiptId: `receipt:${event.eventId}` }
            }),
            applied: true,
            note: payload.approved ? null : 'approval-denied-cleared-task'
          };
        case 'task.progress':
          return {
            state: bump(prev, {
              ...prev,
              task: { ...base, status: 'executing', step: payload.step, percent: payload.percent, failure: null }
            }),
            applied: true,
            note: null
          };
        case 'task.completed':
          return {
            state: bump(prev, {
              ...prev,
              task: { ...base, status: 'completed', step: payload.summary, percent: 100, failure: null }
            }),
            applied: true,
            note: null
          };
        case 'task.failed': {
          const taskFailure: AstrynFailure = { code: payload.code, message: payload.message, retryable: false, origin: 'task' };
          return {
            state: bump(prev, {
              ...prev,
              failure: taskFailure,
              task: { ...base, status: 'failed', step: null, percent: null, failure: taskFailure }
            }),
            applied: true,
            note: null
          };
        }
      }
    }

    default:
      return { state: prev, applied: false, note: 'unknown-event-kind' };
  }
}
