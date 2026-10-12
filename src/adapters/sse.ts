/**
 * 最小 SSE 行解析器：必须能在任意字节分块边界上工作，
 * 因为上游代理与网络栈的切分点不可预测。
 */

export interface SseMessage {
  readonly event: string;
  readonly data: string;
  readonly id: string | null;
}

export class SseDecoder {
  private buffer = '';
  private eventField = '';
  private dataLines: string[] = [];
  private idField: string | null = null;

  /** 喂入任意长度片段，返回本次可完整界定的消息。 */
  push(chunk: string): SseMessage[] {
    this.buffer += chunk.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const messages: SseMessage[] = [];
    for (;;) {
      const newline = this.buffer.indexOf('\n');
      if (newline === -1) break;
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      const message = this.consumeLine(line);
      if (message) messages.push(message);
    }
    return messages;
  }

  /** 流结束时调用：残留的半行不当作完整字段，未派发的块按结束处理。 */
  flush(): SseMessage[] {
    const out: SseMessage[] = [];
    if (this.buffer.length > 0) {
      const message = this.consumeLine(this.buffer);
      this.buffer = '';
      if (message) out.push(message);
    }
    const pending = this.dispatch();
    if (pending) out.push(pending);
    return out;
  }

  get remainder(): string {
    return this.buffer;
  }

  private consumeLine(line: string): SseMessage | null {
    if (line === '') return this.dispatch();
    if (line.startsWith(':')) return null;

    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);

    switch (field) {
      case 'event':
        this.eventField = value;
        return null;
      case 'data':
        this.dataLines.push(value);
        return null;
      case 'id':
        this.idField = value;
        return null;
      default:
        return null;
    }
  }

  private dispatch(): SseMessage | null {
    if (this.dataLines.length === 0) {
      this.eventField = '';
      this.idField = null;
      return null;
    }
    const message: SseMessage = {
      event: this.eventField || 'message',
      data: this.dataLines.join('\n'),
      id: this.idField
    };
    this.eventField = '';
    this.dataLines = [];
    this.idField = null;
    return message;
  }
}

export const SSE_DONE_SENTINEL = '[DONE]';
