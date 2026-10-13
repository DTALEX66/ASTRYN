import { fireEvent, render, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { XIAOQI_PROFILE } from '@astryn/contracts';
import { AstrynCompanionEntry, SyntheticConversationPort, createCompanionSessionManager } from '@astryn/core';
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

function managerWith(conversation: AstrynConversationPort | null) {
  return createCompanionSessionManager({ sessionId: 's1', profile: XIAOQI_PROFILE, conversation, actions: null, verifier: null });
}

const happyPort = () => new SyntheticConversationPort({ steps: [{ text: '我在呢' }, { finish: 'stop' }] });

function renderSlot(slot: 'home' | 'reading' | 'sidebar', manager: ReturnType<typeof managerWith>, conversation: AstrynConversationPort | null, extra: { focus?: boolean } = {}) {
  return render(
    <AstrynCompanionEntry slot={slot} sessionId="s1" conversation={conversation} manager={manager} {...extra} />
  );
}

describe('宿主槽位正式入口（GF08）', () => {
  it('槽位决定模式与取景档；未注入对话端口即明确 NO MODEL（入口无内置模型中心）', () => {
    const manager = managerWith(null);

    const home = renderSlot('home', manager, null);
    const homeShell = within(home.container).getByTestId('astryn-shell');
    expect(homeShell.getAttribute('data-slot')).toBe('home');
    expect(homeShell.getAttribute('data-avatar-view')).toBe('hero');
    expect(homeShell.className).toContain('astryn-root--embedded');
    expect(within(home.container).getByTestId('astryn-avatar').getAttribute('width')).toBe('240');
    expect(within(home.container).getByTestId('astryn-evidence-tag').textContent).toBe('NO MODEL');
    home.unmount();

    const reading = renderSlot('reading', manager, null);
    const readingShell = within(reading.container).getByTestId('astryn-shell');
    expect(readingShell.getAttribute('data-slot')).toBe('reading');
    expect(readingShell.getAttribute('data-avatar-view')).toBe('sidebar');
    expect(readingShell.className).toContain('astryn-root--embedded');
    expect(within(reading.container).getByTestId('astryn-avatar').getAttribute('width')).toBe('168');
    reading.unmount();

    const sidebar = renderSlot('sidebar', manager, null);
    const sidebarShell = within(sidebar.container).getByTestId('astryn-shell');
    expect(sidebarShell.getAttribute('data-slot')).toBe('sidebar');
    expect(sidebarShell.getAttribute('data-avatar-view')).toBe('sidebar');
    expect(sidebarShell.className).toContain('astryn-root--panel');
    sidebar.unmount();

    manager.dispose();
  });

  it('三个槽位共享同一管理器：一次提交只调端口一遍，三处记录同时出现', async () => {
    const { port, streamCalls } = recordingPort(happyPort());
    const manager = managerWith(port);
    const home = renderSlot('home', manager, port);
    const reading = renderSlot('reading', manager, port);
    const sidebar = renderSlot('sidebar', manager, port);
    expect(manager.viewCount).toBe(3);

    const input = within(home.container).getByTestId('astryn-input');
    fireEvent.change(input, { target: { value: '从主页问一句' } });
    fireEvent.submit(input.closest('form') as HTMLElement);

    await vi.waitFor(() => {
      expect(within(reading.container).getByTestId('astryn-log').textContent).toContain('我在呢');
      expect(within(sidebar.container).getByTestId('astryn-log').textContent).toContain('我在呢');
    });
    expect(streamCalls()).toBe(1);
    expect(manager.snapshot.transcript.map((m) => m.content)).toEqual(['从主页问一句', '我在呢']);

    manager.dispose();
  });

  it('逐个卸载槽位不销毁共享会话：全部卸载后重开仍拿到完整记录且可继续发送', async () => {
    const { port } = recordingPort(happyPort());
    const manager = managerWith(port);
    const home = renderSlot('home', manager, port);
    const reading = renderSlot('reading', manager, port);
    const sidebar = renderSlot('sidebar', manager, port);

    const input = within(home.container).getByTestId('astryn-input');
    fireEvent.change(input, { target: { value: '第一句' } });
    fireEvent.submit(input.closest('form') as HTMLElement);
    await vi.waitFor(() => {
      expect(within(sidebar.container).getByTestId('astryn-log').textContent).toContain('我在呢');
    });

    home.unmount();
    expect(manager.viewCount).toBe(2);
    reading.unmount();
    sidebar.unmount();
    expect(manager.viewCount).toBe(0);

    const again = renderSlot('reading', manager, port);
    const reopened = within(again.container);
    expect(reopened.getByTestId('astryn-log').textContent).toContain('第一句');
    expect(reopened.getByTestId('astryn-log').textContent).toContain('我在呢');
    const draft = reopened.getByTestId('astryn-input');
    fireEvent.change(draft, { target: { value: '第二句' } });
    fireEvent.submit(draft.closest('form') as HTMLElement);
    await vi.waitFor(() => {
      expect(reopened.getByTestId('astryn-log').textContent).toContain('第二句');
    });

    manager.dispose();
  });

  it('专注是宿主给出的状态：data-focus 随属性翻转，星栖不自行推断', () => {
    const manager = managerWith(null);
    const utils = renderSlot('sidebar', manager, null, { focus: true });
    expect(within(utils.container).getByTestId('astryn-shell').getAttribute('data-focus')).toBe('true');

    utils.rerender(
      <AstrynCompanionEntry slot="sidebar" sessionId="s1" conversation={null} manager={manager} focus={false} />
    );
    expect(within(utils.container).getByTestId('astryn-shell').getAttribute('data-focus')).toBeNull();
    manager.dispose();
  });

  it('隐藏态保留槽位身份并带 data-hidden；恢复后记录区不丢', () => {
    const manager = managerWith(null);
    const utils = renderSlot('home', manager, null);
    fireEvent.click(within(utils.container).getByTestId('astryn-hide'));
    const placeholder = within(utils.container).getByTestId('astryn-hidden-placeholder');
    expect(placeholder.getAttribute('data-hidden')).toBe('true');
    expect(placeholder.getAttribute('data-slot')).toBe('home');

    fireEvent.click(within(utils.container).getByTestId('astryn-show'));
    expect(within(utils.container).getByTestId('astryn-log')).toBeTruthy();
    manager.dispose();
  });
});
