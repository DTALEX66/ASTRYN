import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { XIAOQI_PROFILE, createEvent } from '@astryn/contracts';
import type {
  AstrynAnyEvent,
  AstrynContextFragment,
  AstrynConversationPort,
  AstrynConversationRequest,
  AstrynFailureCode,
  AstrynRequestLookup
} from '@astryn/contracts';
import { CompanionSessionManager, CompanionShell, SyntheticConversationPort } from '@astryn/core';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const FRAGMENT: AstrynContextFragment = {
  scope: 'active-document-selection',
  sourceId: 'doc-1',
  sourceTitle: '夹具文档',
  sourceVersion: 'v1',
  excerpt: '选中的一段',
  provenance: 'synthetic-fixture',
  authorizationId: 'auth-1',
  evidenceLevel: 'SYNTHETIC'
};

interface RunScript {
  readonly deltas?: readonly string[];
  readonly delayMs?: number;
  readonly failCode?: AstrynFailureCode;
  readonly ignoreAbort?: boolean;
}

/** 可控脚本端口（UI 层只需按 run 播放 + 可选查询能力）。 */
function scriptedPort(options: {
  readonly runs: readonly RunScript[];
  readonly lookup?: (requestId: string) => AstrynRequestLookup | Promise<AstrynRequestLookup>;
}): AstrynConversationPort {
  let runIndex = 0;
  const base: AstrynConversationPort = {
    protocol: 'astryn-1',
    providerId: 'test-scripted',
    transport: 'scripted-synthetic',
    evidenceLevel: 'SYNTHETIC',
    modelId: 'scripted-only',
    availability: async () => ({ available: true, reason: null, failureCode: null }),
    async *stream(request: AstrynConversationRequest, signal: AbortSignal): AsyncGenerator<AstrynAnyEvent> {
      const run = options.runs[Math.min(runIndex, options.runs.length - 1)] ?? {};
      runIndex += 1;
      let seq = 0;
      const env = { sessionId: request.sessionId, requestId: request.requestId } as const;
      yield createEvent({ source: 'conversation', trust: 'observed', kind: 'stream.started', payload: {}, ...env, seq: seq++ }) as unknown as AstrynAnyEvent;
      for (const delta of run.deltas ?? []) {
        if (run.delayMs) await sleep(run.delayMs);
        if (signal.aborted && !run.ignoreAbort) {
          yield createEvent({ source: 'conversation', trust: 'observed', kind: 'stream.failed', payload: { code: 'ABORTED', message: '请求已取消', retryable: false }, ...env, seq: seq++ }) as unknown as AstrynAnyEvent;
          return;
        }
        yield createEvent({ source: 'conversation', trust: 'observed', kind: 'stream.delta', payload: { text: delta }, ...env, seq: seq++ }) as unknown as AstrynAnyEvent;
      }
      if (run.failCode) {
        yield createEvent({
          source: 'conversation',
          trust: 'observed',
          kind: 'stream.failed',
          payload: { code: run.failCode, message: '脚本失败', retryable: run.failCode === 'NETWORK' },
          ...env,
          seq: seq++
        }) as unknown as AstrynAnyEvent;
        return;
      }
      yield createEvent({ source: 'conversation', trust: 'observed', kind: 'stream.completed', payload: { finishReason: 'stop' }, ...env, seq: seq++ }) as unknown as AstrynAnyEvent;
    }
  };
  if (!options.lookup) return base;
  const lookup = options.lookup;
  return {
    ...base,
    lookupRequest: async (requestId: string) => lookup(requestId)
  };
}

function shell(props: Partial<Parameters<typeof CompanionShell>[0]> = {}) {
  return render(
    <CompanionShell
      mode="panel"
      sessionId="s1"
      profile={XIAOQI_PROFILE}
      conversation={new SyntheticConversationPort({ steps: [{ text: '我在呢' }, { finish: 'stop' }] })}
      {...props}
    />
  );
}

function managerWith(conversation: AstrynConversationPort | null): CompanionSessionManager {
  return new CompanionSessionManager({
    sessionId: 's1',
    profile: XIAOQI_PROFILE,
    conversation,
    actions: null,
    verifier: null
  });
}

const input = (): HTMLInputElement => screen.getByTestId('astryn-input') as HTMLInputElement;
const submit = (): void => {
  fireEvent.submit(screen.getByTestId('astryn-input').closest('form') as HTMLElement);
};
const type = (text: string): void => {
  fireEvent.change(screen.getByTestId('astryn-input'), { target: { value: text } });
};

describe('GF07 输入连续性与停止/关视图语义（UI 层）', () => {
  it('草稿是外壳状态：设置开关与隐藏角色都不吞输入', () => {
    shell();
    type('写到一半的草稿');

    fireEvent.click(screen.getByTestId('astryn-settings-toggle'));
    expect(screen.queryByTestId('astryn-input')).toBeNull();
    fireEvent.click(screen.getByTestId('astryn-settings-toggle'));
    expect(input().value).toBe('写到一半的草稿');

    fireEvent.click(screen.getByTestId('astryn-hide'));
    expect(screen.queryByTestId('astryn-input')).toBeNull();
    fireEvent.click(screen.getByTestId('astryn-show'));
    expect(input().value).toBe('写到一半的草稿');
  });

  it('材料标签在提交前可见、可移除；提交被接受后消费干净', async () => {
    const port = new SyntheticConversationPort({ steps: [{ text: '收到材料' }, { finish: 'stop' }] });
    const manager = managerWith(port);
    shell({ manager, conversation: port });

    act(() => manager.attachContext([FRAGMENT]));
    expect(screen.getByTestId('astryn-composer-tags')).toBeTruthy();
    expect(screen.getByTestId('astryn-attachment-0').textContent).toContain('夹具文档');
    expect(manager.snapshot.pendingAttachments).toHaveLength(1);

    fireEvent.click(screen.getByTestId('astryn-attachment-remove-0'));
    expect(screen.queryByTestId('astryn-composer-tags')).toBeNull();
    expect(manager.snapshot.pendingAttachments).toHaveLength(0);

    act(() => manager.attachContext([FRAGMENT]));
    type('带着材料问');
    submit();
    await vi.waitFor(() => {
      expect(screen.getByTestId('astryn-log').textContent).toContain('收到材料');
    });
    expect(manager.snapshot.pendingAttachments).toHaveLength(0);
    expect(screen.queryByTestId('astryn-composer-tags')).toBeNull();
  });

  it('关视图不等于停止：隐藏期间这一轮继续跑完，恢复后可见且回到空闲', async () => {
    const port = new SyntheticConversationPort({ clock: (ms) => sleep(ms), steps: [{ text: '慢但有终', delayMs: 60 }, { finish: 'stop' }] });
    const manager = managerWith(port);
    shell({ manager, conversation: port });

    type('第一问');
    submit();
    await vi.waitFor(() => expect(screen.getByTestId('astryn-stop')).toBeTruthy());

    fireEvent.click(screen.getByTestId('astryn-hide'));
    expect(screen.getByTestId('astryn-hidden-placeholder')).toBeTruthy();
    await vi.waitFor(() => expect(manager.snapshot.state.conversation).toBe('idle'), { timeout: 2000 });
    expect(manager.snapshot.retry).toBeNull();

    fireEvent.click(screen.getByTestId('astryn-show'));
    await vi.waitFor(() => expect(screen.getByTestId('astryn-log').textContent).toContain('慢但有终'));
    expect(screen.queryByTestId('astryn-retry')).toBeNull();
  });

  it('停止生成：会话中断、晚到片段不进入回复，候选以已停止身份出现', async () => {
    const port = scriptedPort({ runs: [{ deltas: ['前半', '后半'], delayMs: 80, ignoreAbort: true }] });
    const manager = managerWith(port);
    shell({ manager, conversation: port });

    type('说两句话');
    submit();
    await vi.waitFor(() => expect(screen.getByTestId('astryn-log').textContent).toContain('前半'));
    fireEvent.click(screen.getByTestId('astryn-stop'));
    await vi.waitFor(() => expect(manager.snapshot.state.conversation).toBe('interrupted'));

    // 端口忽略中止信号还在产出「后半」，它不得再进入任何呈现。
    await sleep(150);
    const log = screen.getByTestId('astryn-log').textContent ?? '';
    expect(log).toContain('前半');
    expect(log).not.toContain('后半');
    expect(manager.snapshot.state.streamedText).toBe('前半');

    const retryText = screen.getByTestId('astryn-retry-text').textContent ?? '';
    expect(retryText).toContain('已停止');
    expect(retryText).toContain('说两句话');
  });

  it('重试条：失败后保留输入并预告先查询原请求，点击后重发并给出回执文案', async () => {
    const port = scriptedPort({
      runs: [{ failCode: 'NETWORK' }, { deltas: ['重试成功'] }],
      lookup: (requestId) => ({ requestId, outcome: 'not-found', detail: '宿主无该请求记录' })
    });
    shell({ conversation: port });

    type('崩掉的一问');
    submit();

    await vi.waitFor(() => expect(screen.getByTestId('astryn-retry')).toBeTruthy());
    const retryText = screen.getByTestId('astryn-retry-text').textContent ?? '';
    expect(retryText).toContain('输入已保留');
    expect(retryText).toContain('崩掉的一问');
    expect(screen.getByTestId('astryn-retry-hint').textContent).toContain('先查询原请求');

    fireEvent.click(screen.getByTestId('astryn-retry-btn'));
    await vi.waitFor(() => {
      expect(screen.getByTestId('astryn-retry-note').textContent).toContain('已先查询原请求（宿主无该请求记录）：按新请求重发。');
    });
    await vi.waitFor(() => expect(screen.getByTestId('astryn-log').textContent).toContain('重试成功'));
    expect(screen.queryByTestId('astryn-retry')).toBeNull();
  });
});
