import type {
  AstrynAnyEvent,
  AstrynConversationAvailability,
  AstrynConversationPort,
  AstrynConversationRequest,
  AstrynEventKind,
  AstrynEventPayloadFor,
  AstrynFailureCode
} from '@astryn/contracts';
import { ASTRYN_PROTOCOL_VERSION } from '@astryn/contracts';
import { conversationEvent } from './conversation-event';
import { SseDecoder, SSE_DONE_SENTINEL } from './sse';

/** 只注入传输原语，便于在无网络环境中做真实解析路径的回归测试。 */
export interface FetchLike {
  (input: string, init?: RequestInit): Promise<Response>;
}

export interface OpenAiCompatibleOptions {
  readonly providerId?: string;
  /** 开发代理的相对路径，浏览器侧永远不持有密钥。 */
  readonly path?: string;
  readonly model: string;
  readonly fetchImpl?: FetchLike;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly timeoutMs?: number;
}

interface ChatCompletionChunkChoice {
  readonly delta?: { readonly content?: string | null };
  readonly finish_reason?: string | null;
}

interface ChatCompletionChunk {
  readonly choices?: readonly ChatCompletionChunkChoice[];
}

/**
 * 错误文本会一路显示到界面上。上游 URL 可能被用户写成含凭据的形式
 * （https://user:token@host），所以任何透传前必须先剥掉 URL 与凭据样式。
 */
export function redactErrorText(input: string): string {
  return input
    .replace(/https?:\/\/\S*/gi, '[redacted-url]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\b(sk|pk|key|token)[-_][A-Za-z0-9]{6,}/gi, '[redacted-key]')
    .slice(0, 240);
}

/**
 * 仅开发环境使用的标准兼容适配器（OpenAI Chat Completions 形状）。
 * 它只对接星栖自己的 loopback 代理，代理再持有上游凭据；
 * 事件一律标 source=conversation / trust=observed，因此不可能改变任务状态。
 */
export class OpenAiCompatibleConversationPort implements AstrynConversationPort {
  readonly protocol = ASTRYN_PROTOCOL_VERSION;
  readonly providerId: string;
  readonly transport = 'openai-compatible' as const;
  readonly evidenceLevel = 'REAL' as const;
  readonly modelId: string;

  private readonly path: string;
  private readonly fetchImpl: FetchLike;
  private readonly temperature: number;
  private readonly maxTokens: number;
  private readonly timeoutMs: number;

  constructor(options: OpenAiCompatibleOptions) {
    this.providerId = options.providerId ?? 'openai-compatible-dev';
    this.path = options.path ?? '/dev-model/v1/chat/completions';
    this.modelId = options.model;
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.temperature = options.temperature ?? 0.7;
    this.maxTokens = options.maxTokens ?? 512;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async availability(): Promise<AstrynConversationAvailability> {
    try {
      const response = await this.fetchImpl('/dev-model/healthz', { method: 'GET', signal: AbortSignal.timeout(3_000) });
      if (response.ok) {
        const body = (await response.json()) as { configured?: boolean; model?: string | null; reason?: string | null };
        if (body.configured) return { available: true, reason: null, failureCode: null };
        return { available: false, reason: body.reason ?? '开发代理未配置上游模型', failureCode: 'MODEL_UNAVAILABLE' };
      }
      if (response.status === 503) return { available: false, reason: '开发代理报告 MODEL_UNAVAILABLE', failureCode: 'MODEL_UNAVAILABLE' };
      return { available: false, reason: `开发代理返回 HTTP ${response.status}`, failureCode: 'UPSTREAM_REJECTED' };
    } catch (error) {
      return {
        available: false,
        reason: `开发代理不可达：${redactErrorText(error instanceof Error ? error.message : String(error))}。未启动 dev:proxy 时属预期状态。`,
        failureCode: 'NETWORK'
      };
    }
  }

  async *stream(request: AstrynConversationRequest, signal: AbortSignal): AsyncGenerator<AstrynAnyEvent> {
    let seq = 0;
    const make = <K extends AstrynEventKind>(kind: K, payload: Omit<AstrynEventPayloadFor<K>, 'kind'>): AstrynAnyEvent =>
      conversationEvent({ kind, payload, sessionId: request.sessionId, requestId: request.requestId, seq: seq++ });

    yield make('stream.started', {});

    const messages = [
      ...request.messages.map((m) => ({ role: m.role, content: m.content }))
    ];

    const controller = new AbortController();
    const onAbort = (): void => controller.abort();
    signal.addEventListener('abort', onAbort);
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(this.path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
        body: JSON.stringify({
          model: this.modelId,
          stream: true,
          temperature: this.temperature,
          max_tokens: this.maxTokens,
          messages
        }),
        signal: controller.signal
      });
    } catch (error) {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      const code: AstrynFailureCode = signal.aborted ? 'ABORTED' : 'NETWORK';
      yield make('stream.failed', {
        code,
        message: code === 'ABORTED' ? '请求已取消' : `无法连接开发代理：${redactErrorText(error instanceof Error ? error.message : String(error))}`,
        retryable: code !== 'ABORTED'
      });
      return;
    }

    if (!response.ok) {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      const code = response.status === 503 ? 'MODEL_UNAVAILABLE' : 'UPSTREAM_REJECTED';
      yield make('stream.failed', {
        code,
        message: `开发代理返回 HTTP ${response.status}（${code}）`,
        retryable: response.status >= 500
      });
      return;
    }

    if (!response.body) {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      yield make('stream.failed', { code: 'MALFORMED_STREAM', message: '响应没有可读流体', retryable: true });
      return;
    }

    const reader = response.body.getReader();
    // 仅中止 fetch 不足以解开已经挂起的 read()：必须取消 reader。
    const cancelOnAbort = (): void => {
      reader.cancel().catch(() => undefined);
    };
    controller.signal.addEventListener('abort', cancelOnAbort);
    const decoder = new TextDecoder('utf-8');
    const sse = new SseDecoder();
    let sawFinish = false;
    let streamError: string | null = null;

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const message of sse.push(decoder.decode(value, { stream: true }))) {
          const out = this.toEvents(message.data, request, () => seq++);
          if (out.type === 'delta') yield make('stream.delta', { text: out.text });
          else if (out.type === 'finish') {
            sawFinish = true;
            yield make('stream.completed', { finishReason: out.finishReason });
          } else if (out.type === 'error') {
            streamError = out.message;
          }
        }
      }
      for (const message of sse.flush()) {
        const out = this.toEvents(message.data, request, () => seq++);
        if (out.type === 'delta') yield make('stream.delta', { text: out.text });
        else if (out.type === 'finish') {
          sawFinish = true;
          yield make('stream.completed', { finishReason: out.finishReason });
        } else if (out.type === 'error') streamError = out.message;
      }
    } catch (error) {
      streamError = redactErrorText(error instanceof Error ? error.message : String(error));
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      controller.signal.removeEventListener('abort', cancelOnAbort);
      try {
        reader.releaseLock();
      } catch {
        // 已释放或已取消，无需处理。
      }
    }

    if (signal.aborted) {
      yield make('stream.failed', { code: 'ABORTED', message: '请求已取消', retryable: false });
      return;
    }
    if (streamError) {
      yield make('stream.failed', { code: 'MALFORMED_STREAM', message: streamError, retryable: true });
      return;
    }
    if (!sawFinish) {
      yield make('stream.failed', { code: 'MALFORMED_STREAM', message: '流在收到结束事件前中断', retryable: true });
    }
  }

  private toEvents(
    data: string,
    request: AstrynConversationRequest,
    nextSeq: () => number
  ): { type: 'none' } | { type: 'delta'; text: string } | { type: 'finish'; finishReason: string } | { type: 'error'; message: string } {
    void request;
    void nextSeq;
    if (data.length === 0) return { type: 'none' };
    if (data === SSE_DONE_SENTINEL) return { type: 'finish', finishReason: 'done' };
    let parsed: ChatCompletionChunk;
    try {
      parsed = JSON.parse(data) as ChatCompletionChunk;
    } catch (error) {
      return { type: 'error', message: `无法解析流式数据块：${redactErrorText(error instanceof Error ? error.message : String(error))}` };
    }
    const choice = parsed.choices?.[0];
    if (!choice) return { type: 'none' };
    if (typeof choice.delta?.content === 'string' && choice.delta.content.length > 0) {
      return { type: 'delta', text: choice.delta.content };
    }
    if (choice.finish_reason) return { type: 'finish', finishReason: choice.finish_reason };
    return { type: 'none' };
  }
}
