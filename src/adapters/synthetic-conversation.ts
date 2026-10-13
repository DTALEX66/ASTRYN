import { ASTRYN_PROTOCOL_VERSION } from '@astryn/contracts';
import type {
  AstrynAnyEvent,
  AstrynConversationAvailability,
  AstrynConversationPort,
  AstrynConversationRequest,
  AstrynEventKind,
  AstrynEventPayloadFor,
  AstrynRequestLookup
} from '@astryn/contracts';
import { conversationEvent } from './conversation-event';

export interface SyntheticStep {
  readonly delayMs?: number;
  readonly text?: string;
  readonly fail?: { readonly code: string; readonly message: string };
  readonly finish?: string;
  /** 注入同一份数据的重复投递，用于验证守卫丢弃重复与乱序。 */
  readonly repeatText?: string;
}

export interface SyntheticPortOptions {
  readonly providerId?: string;
  readonly steps: readonly SyntheticStep[];
  readonly modelId?: string;
  readonly clock?: (ms: number) => Promise<void>;
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 合成传输。仅用于自动测试与明确标注的合成演示，evidenceLevel 恒为 SYNTHETIC。
 * 它不产生任何智能：回复文本是脚本，界面上必须显示 SYNTHETIC 标记。
 */
export class SyntheticConversationPort implements AstrynConversationPort {
  readonly protocol = ASTRYN_PROTOCOL_VERSION;
  readonly providerId: string;
  readonly transport = 'scripted-synthetic' as const;
  readonly evidenceLevel = 'SYNTHETIC' as const;
  readonly modelId: string | null;

  private activeRequestId: string | null = null;

  constructor(private readonly options: SyntheticPortOptions) {
    this.providerId = options.providerId ?? 'synthetic-fixture';
    this.modelId = options.modelId ?? 'scripted-only';
  }

  async availability(): Promise<AstrynConversationAvailability> {
    return { available: true, reason: null, failureCode: null };
  }

  /**
   * 合成夹具不保留已结束请求的任何记录（不写正式记录）：
   * 只有"此刻正在流式输出"可回答 in-progress，其余一律 not-found。
   */
  async lookupRequest(requestId: string): Promise<AstrynRequestLookup> {
    if (requestId === this.activeRequestId) {
      return { requestId, outcome: 'in-progress', detail: '合成夹具当前正在流式输出该请求' };
    }
    return { requestId, outcome: 'not-found', detail: '合成夹具不保留已结束请求（不写正式记录）' };
  }

  async *stream(request: AstrynConversationRequest, signal: AbortSignal): AsyncGenerator<AstrynAnyEvent> {
    let seq = 0;
    const clock = this.options.clock ?? wait;
    const make = <K extends AstrynEventKind>(kind: K, payload: Omit<AstrynEventPayloadFor<K>, 'kind'>): AstrynAnyEvent =>
      conversationEvent({ kind, payload, sessionId: request.sessionId, requestId: request.requestId, seq: seq++ });

    this.activeRequestId = request.requestId;
    try {
      yield make('stream.started', {});

      for (const step of this.options.steps) {
        if (signal.aborted) {
          yield make('stream.failed', { code: 'ABORTED', message: '请求已取消', retryable: false });
          return;
        }
        if (step.delayMs) await clock(step.delayMs);
        if (signal.aborted) {
          yield make('stream.failed', { code: 'ABORTED', message: '请求已取消', retryable: false });
          return;
        }
        if (step.fail) {
          yield make('stream.failed', { code: 'UPSTREAM_REJECTED', message: step.fail.message, retryable: false });
          return;
        }
        if (typeof step.text === 'string') yield make('stream.delta', { text: step.text });
        if (typeof step.repeatText === 'string') yield make('stream.delta', { text: step.repeatText });
        if (typeof step.finish === 'string') {
          yield make('stream.completed', { finishReason: step.finish });
          return;
        }
      }

      yield make('stream.completed', { finishReason: 'synthetic-script-end' });
    } finally {
      if (this.activeRequestId === request.requestId) this.activeRequestId = null;
    }
  }
}
