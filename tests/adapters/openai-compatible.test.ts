import { describe, expect, it } from 'vitest';
import type { AstrynAnyEvent, AstrynConversationRequest } from '@astryn/contracts';
import { OpenAiCompatibleConversationPort } from '@astryn/core';

function sseResponse(chunks: readonly string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    }
  });
  return { ok: true, status: 200, body } as unknown as Response;
}

const request: AstrynConversationRequest = {
  protocol: 'astryn-1',
  sessionId: 's1',
  requestId: 'r1',
  characterId: 'xiaoqi',
  messages: [{ role: 'user', content: '你好', sessionId: 's1', requestId: 'r1' }],
  contextFragments: []
};

async function collect(port: OpenAiCompatibleConversationPort, signal = new AbortController().signal): Promise<AstrynAnyEvent[]> {
  const seen: AstrynAnyEvent[] = [];
  for await (const event of port.stream(request, signal)) seen.push(event);
  return seen;
}

function delta(text: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: null }] })}\n\n`;
}

describe('开发环境标准兼容适配器', () => {
  it('按内容分块产出 delta，并以 completed 收尾', async () => {
    const port = new OpenAiCompatibleConversationPort({
      model: 'gpt-test',
      fetchImpl: async () => sseResponse([delta('你'), delta('好'), 'data: [DONE]\n\n'])
    });
    const events = await collect(port);
    const kinds = events.map((event) => event.payload.kind);
    expect(kinds).toEqual(['stream.started', 'stream.delta', 'stream.delta', 'stream.completed']);
    expect(events.every((event) => event.trust === 'observed')).toBe(true);
  });

  it('跨 TCP 分块把一行拆成两半时仍能拼出完整文本', async () => {
    const line = delta('拼起来');
    const halves = [line.slice(0, 12), line.slice(12)];
    const port = new OpenAiCompatibleConversationPort({
      model: 'gpt-test',
      fetchImpl: async () => sseResponse(halves)
    });
    const events = await collect(port);
    const text = events.filter((e) => e.payload.kind === 'stream.delta').map((e) => (e.payload as { text: string }).text).join('');
    expect(text).toBe('拼起来');
  });

  it('流在没有结束事件时中断 → MALFORMED_STREAM，不当作成功', async () => {
    const port = new OpenAiCompatibleConversationPort({
      model: 'gpt-test',
      fetchImpl: async () => sseResponse([delta('半句')])
    });
    const events = await collect(port);
    const last = events[events.length - 1];
    expect(last?.payload.kind).toBe('stream.failed');
    expect((last?.payload as { code: string }).code).toBe('MALFORMED_STREAM');
  });

  it('损坏数据块 → MALFORMED_STREAM 而不是静默丢字', async () => {
    const port = new OpenAiCompatibleConversationPort({
      model: 'gpt-test',
      fetchImpl: async () => sseResponse(['data: {"choices":[{delta\n\n', 'data: [DONE]\n\n'])
    });
    const events = await collect(port);
    const failed = events.find((event) => event.payload.kind === 'stream.failed');
    expect(failed).toBeDefined();
    expect((failed?.payload as { code: string }).code).toBe('MALFORMED_STREAM');
  });

  it('上游 503 报 MODEL_UNAVAILABLE，绝不产出回复文本', async () => {
    const port = new OpenAiCompatibleConversationPort({
      model: 'gpt-test',
      fetchImpl: async () => ({ ok: false, status: 503, body: null } as unknown as Response)
    });
    const events = await collect(port);
    expect(events.some((event) => event.payload.kind === 'stream.delta')).toBe(false);
    const failed = events[1];
    expect((failed?.payload as { code: string }).code).toBe('MODEL_UNAVAILABLE');
  });

  it('连接失败报 NETWORK', async () => {
    const port = new OpenAiCompatibleConversationPort({
      model: 'gpt-test',
      fetchImpl: async () => {
        throw new Error('ECONNREFUSED');
      }
    });
    const events = await collect(port);
    expect((events[1]?.payload as { code: string }).code).toBe('NETWORK');
  });

  it('取消信号中止请求并标 ABORTED', async () => {
    const controller = new AbortController();
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(encoder.encode(delta('第一')));
      }
    });
    const port = new OpenAiCompatibleConversationPort({
      model: 'gpt-test',
      fetchImpl: async () => {
        setTimeout(() => controller.abort(), 5);
        return { ok: true, status: 200, body } as unknown as Response;
      }
    });
    const events = await collect(port, controller.signal);
    const last = events[events.length - 1];
    // 取消必须分类为 ABORTED（不可退化为 MALFORMED_STREAM：那是"上游截断"的语义，
    // 会误导 UI 提示可重试）。signal.aborted 在适配器里先于任何解析错误判定。
    expect((last?.payload as { code: string }).code).toBe('ABORTED');
  });

  it('availability() 在未配置时给出 MODEL_UNAVAILABLE', async () => {
    const port = new OpenAiCompatibleConversationPort({
      model: 'gpt-test',
      fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) } as unknown as Response)
    });
    const availability = await port.availability();
    expect(availability.available).toBe(false);
    expect(availability.failureCode).toBe('MODEL_UNAVAILABLE');
  });

  it('浏览器侧请求体不含任何密钥字段', async () => {
    let sentBody = '';
    const port = new OpenAiCompatibleConversationPort({
      model: 'gpt-test',
      fetchImpl: async (_input, init) => {
        sentBody = String(init?.body ?? '');
        return sseResponse(['data: [DONE]\n\n']);
      }
    });
    await collect(port);
    expect(sentBody).not.toMatch(/api[-_ ]?key|authorization|Bearer/i);
    expect(JSON.parse(sentBody).stream).toBe(true);
  });
});
