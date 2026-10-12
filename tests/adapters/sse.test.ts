import { describe, expect, it } from 'vitest';
import { SSE_DONE_SENTINEL, SseDecoder } from '@astryn/core';

function decode(chunks: readonly string[]): string[] {
  const decoder = new SseDecoder();
  const out: string[] = [];
  for (const chunk of chunks) for (const message of decoder.push(chunk)) out.push(message.data);
  for (const message of decoder.flush()) out.push(message.data);
  return out;
}

describe('SSE 解析（流式边界）', () => {
  it('整块一次到达', () => {
    expect(decode(['data: hello\n\n'])).toEqual(['hello']);
  });

  it('在换行符中间被切开', () => {
    expect(decode(['data: hel', 'lo\n', '\n'])).toEqual(['hello']);
  });

  it('在冒号中间被切开且含多条', () => {
    expect(decode(['dat', 'a: a\n\ndata: b\n\n'])).toEqual(['a', 'b']);
  });

  it('支持 CRLF 与孤立 CR', () => {
    expect(decode(['data: win\r\n\r\n'])).toEqual(['win']);
    expect(decode(['data: mac\r\r'])).toEqual(['mac']);
  });

  it('多行 data 合并，注释行忽略，event 字段不影响 data 提取', () => {
    const decoder = new SseDecoder();
    const messages = decoder.push('event: delta\n: 心跳注释\ndata: 一\ndata: 二\n\n');
    expect(messages).toHaveLength(1);
    expect(messages[0]?.data).toBe('一\n二');
    expect(messages[0]?.event).toBe('delta');
  });

  it('残留半行不当成完整消息（避免把截断数据当回复）', () => {
    expect(decode(['data: 完整\n\ndata: 截断'])).toEqual(['完整', '截断']);
    const decoder = new SseDecoder();
    expect(decoder.push('data: 只到半句')).toEqual([]);
    expect(decoder.remainder).toBe('data: 只到半句');
  });

  it('[DONE] 哨兵可识别', () => {
    expect(decode([`data: ${SSE_DONE_SENTINEL}\n\n`])).toEqual([SSE_DONE_SENTINEL]);
  });

  it('损坏的 JSON 由调用方识别，解析器本身不吞数据', () => {
    const [payload] = decode(['data: {不是json\n\n']);
    expect(() => JSON.parse(payload ?? '')).toThrow();
  });
});
