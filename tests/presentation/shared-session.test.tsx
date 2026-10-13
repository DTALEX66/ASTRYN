import { fireEvent, render, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { XIAOQI_PROFILE } from '@astryn/contracts';
import {
  CompanionShell,
  SyntheticConversationPort,
  createCompanionSessionManager
} from '@astryn/core';
import type { AstrynConversationPort, AstrynConversationRequest } from '@astryn/contracts';

function recordingPort(inner: SyntheticConversationPort) {
  let streamCalls = 0;
  const port: AstrynConversationPort = {
    protocol: inner.protocol,
    providerId: inner.providerId,
    transport: inner.transport,
    evidenceLevel: inner.evidenceLevel,
    modelId: inner.modelId,
    availability: () => inner.availability(),
    stream: async function* (request: AstrynConversationRequest, signal: AbortSignal) {
      streamCalls += 1;
      yield* inner.stream(request, signal);
    }
  };
  return { port, streamCalls: () => streamCalls };
}

function renderView(manager: ReturnType<typeof createCompanionSessionManager>, port: AstrynConversationPort, mode: 'panel' | 'embedded') {
  return render(
    <CompanionShell mode={mode} sessionId="s1" profile={XIAOQI_PROFILE} conversation={port} manager={manager} />
  );
}

describe('多视图共享同一会话（GF02）', () => {
  it('两个呈现共享同一管理器：一次提交只执行一遍，两侧记录同步', async () => {
    const { port, streamCalls } = recordingPort(new SyntheticConversationPort({ steps: [{ text: '我在呢' }, { finish: 'stop' }] }));
    const manager = createCompanionSessionManager({ sessionId: 's1', profile: XIAOQI_PROFILE, conversation: port, actions: null, verifier: null });
    const first = renderView(manager, port, 'panel');
    const second = renderView(manager, port, 'embedded');
    const panel = within(first.container);
    const side = within(second.container);
    expect(manager.viewCount).toBe(2);

    fireEvent.change(panel.getByTestId('astryn-input'), { target: { value: '共享吗' } });
    fireEvent.submit(panel.getByTestId('astryn-input').closest('form') as HTMLElement);

    await vi.waitFor(() => {
      expect(panel.getByTestId('astryn-log').textContent).toContain('我在呢');
      expect(side.getByTestId('astryn-log').textContent).toContain('我在呢');
    });
    expect(streamCalls()).toBe(1);
    expect(manager.snapshot.transcript.map((m) => m.content)).toEqual(['共享吗', '我在呢']);

    second.unmount();
    expect(manager.viewCount).toBe(1);
    manager.dispose();
  });

  it('关闭一个呈现不打断会话；重新打开立即拿到完整记录', async () => {
    const port = new SyntheticConversationPort({ steps: [{ text: '我在呢' }, { finish: 'stop' }] });
    const manager = createCompanionSessionManager({ sessionId: 's1', profile: XIAOQI_PROFILE, conversation: port, actions: null, verifier: null });
    const panelUtils = renderView(manager, port, 'panel');
    const sideUtils = renderView(manager, port, 'embedded');
    const panel = within(panelUtils.container);

    fireEvent.change(panel.getByTestId('astryn-input'), { target: { value: '第一句' } });
    fireEvent.submit(panel.getByTestId('astryn-input').closest('form') as HTMLElement);
    await vi.waitFor(() => {
      expect(panel.getByTestId('astryn-log').textContent).toContain('我在呢');
    });

    sideUtils.unmount();
    expect(manager.viewCount).toBe(1);

    fireEvent.change(panel.getByTestId('astryn-input'), { target: { value: '第二句' } });
    fireEvent.submit(panel.getByTestId('astryn-input').closest('form') as HTMLElement);
    await vi.waitFor(() => {
      expect(panel.getByTestId('astryn-visible-state').textContent).toContain('idle');
      expect(panel.getByTestId('astryn-log').textContent).toContain('第二句');
    });

    const again = renderView(manager, port, 'embedded');
    const reopened = within(again.container);
    expect(reopened.getByTestId('astryn-log').textContent).toContain('第一句');
    expect(reopened.getByTestId('astryn-log').textContent).toContain('第二句');
    expect(reopened.getByTestId('astryn-log').textContent).toContain('我在呢');
    expect(manager.viewCount).toBe(2);

    manager.dispose();
  });

  it('一端改风格，两侧同时生效且不打断记录', async () => {
    const port = new SyntheticConversationPort({ steps: [{ text: '我在呢' }, { finish: 'stop' }] });
    const manager = createCompanionSessionManager({ sessionId: 's1', profile: XIAOQI_PROFILE, conversation: port, actions: null, verifier: null });
    const first = renderView(manager, port, 'panel');
    const second = renderView(manager, port, 'embedded');
    const panel = within(first.container);
    const side = within(second.container);

    fireEvent.change(panel.getByTestId('astryn-input'), { target: { value: '在吗' } });
    fireEvent.submit(panel.getByTestId('astryn-input').closest('form') as HTMLElement);
    await vi.waitFor(() => {
      expect(panel.getByTestId('astryn-log').textContent).toContain('我在呢');
    });

    fireEvent.click(side.getByTestId('astryn-reply-length'));
    await vi.waitFor(() => {
      expect(panel.getByTestId('astryn-reply-length').textContent).toBe('回复长度：brief');
      expect(side.getByTestId('astryn-reply-length').textContent).toBe('回复长度：brief');
    });
    expect(panel.getByTestId('astryn-log').textContent).toContain('我在呢');
    expect(manager.snapshot.transcript).toHaveLength(2);

    manager.dispose();
  });
});
