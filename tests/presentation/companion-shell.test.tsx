import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { XIAOQI_PROFILE } from '@astryn/contracts';
import { CompanionShell, STATE_VISUALS, SyntheticConversationPort, XiaoqiAvatar, renderXiaoqiMarkup } from '@astryn/core';
import { toVisibleState } from '@astryn/contracts';

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

function avatarState(): string | null {
  const host = screen.getByTestId('astryn-avatar-host');
  const svg = host.querySelector('svg[data-testid="astryn-avatar"]');
  return svg?.getAttribute('data-visible-state') ?? null;
}

describe('原创小栖可见状态（A03/A04）', () => {
  it('默认渲染出角色画面并声明 AI 身份', () => {
    shell();
    expect(avatarState()).toBe('idle');
    expect(screen.getByTestId('astryn-ai-disclosure').textContent).toContain('AI');
    expect(screen.getByTestId('astryn-evidence-tag').textContent).toContain('SYNTHETIC');
  });

  it('九种状态两两视觉可辨（环色 + 眼型 + 嘴型组合唯一）', () => {
    const signatures = Object.entries(STATE_VISUALS).map(([state, tokens]) => `${tokens.ringColor}|${tokens.eyeMode}|${tokens.mouthMode}|${tokens.glyph}|${state}`);
    const markup = Object.entries(STATE_VISUALS).map(([state]) =>
      renderXiaoqiMarkup({
        characterId: 'xiaoqi',
        sessionId: 's1',
        visibleState: state as never,
        expressionFrame: 0,
        streamedText: '',
        taskStep: null,
        failureMessage: null,
        reducedMotion: false
      })
    );
    expect(new Set(signatures).size).toBe(signatures.length);
    expect(new Set(markup).size).toBe(markup.length);
    expect(signatures.length).toBe(9);
  });

  it('输入框聚焦让角色进入 listening：真实交互事件驱动表情', () => {
    shell();
    expect(avatarState()).toBe('idle');
    fireEvent.focus(screen.getByTestId('astryn-input'));
    expect(avatarState()).toBe('listening');
    fireEvent.blur(screen.getByTestId('astryn-input'));
    expect(avatarState()).toBe('idle');
  });

  it('发送后经历 thinking/speaking 并停在 idle，口型帧随真实数据递增', async () => {
    const seen: string[] = [];
    const { rerender } = shell();
    const host = screen.getByTestId('astryn-avatar-host');
    seen.push(host.querySelector('svg')?.getAttribute('data-visible-state') ?? '');

    fireEvent.focus(screen.getByTestId('astryn-input'));
    fireEvent.change(screen.getByTestId('astryn-input'), { target: { value: '在吗' } });
    fireEvent.submit(screen.getByTestId('astryn-input').closest('form') as HTMLElement);
    await vi.waitFor(() => {
      const svg = screen.getByTestId('astryn-avatar-host').querySelector('svg[data-testid="astryn-avatar"]');
      expect(svg?.getAttribute('data-visible-state')).toBe('idle');
      expect(Number(svg?.getAttribute('data-expression-frame'))).toBeGreaterThan(0);
    });
    rerender(
      <CompanionShell
        mode="panel"
        sessionId="s1"
        profile={XIAOQI_PROFILE}
        conversation={new SyntheticConversationPort({ steps: [{ text: 'x' }, { finish: 'stop' }] })}
      />
    );
    expect(screen.getByTestId('astryn-avatar-host')).toBeTruthy();
  });

  it('合成回复带 SYNTHETIC 标记，不冒充真实模型', () => {
    shell();
    fireEvent.change(screen.getByTestId('astryn-input'), { target: { value: '你好' } });
    fireEvent.submit(screen.getByTestId('astryn-input').closest('form') as HTMLElement);
    return vi.waitFor(() => {
      const messages = screen.getAllByTestId(/^astryn-msg-/);
      const assistant = messages.at(-1);
      expect(assistant?.textContent).toContain('SYNTHETIC');
    });
  });

  it('隐藏角色后画面消失且可恢复；减少动效改变 data-motion', () => {
    shell();
    fireEvent.click(screen.getByTestId('astryn-toggle-motion'));
    expect(screen.getByTestId('astryn-avatar-host').querySelector('svg')?.getAttribute('data-motion')).toBe('off');
    fireEvent.click(screen.getByTestId('astryn-hide'));
    expect(screen.queryByTestId('astryn-avatar-host')).toBeNull();
    fireEvent.click(screen.getByTestId('astryn-show'));
    expect(screen.getByTestId('astryn-avatar-host')).toBeTruthy();
  });

  it('卸载后不再更新，也不留下抛错', async () => {
    const port = new SyntheticConversationPort({
      clock: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      steps: [{ text: '慢', delayMs: 30 }, { text: '慢', delayMs: 30 }, { finish: 'stop' }]
    });
    const utils = render(
      <CompanionShell mode="panel" sessionId="s1" profile={XIAOQI_PROFILE} conversation={port} />
    );
    fireEvent.change(screen.getByTestId('astryn-input'), { target: { value: '说慢点' } });
    fireEvent.submit(screen.getByTestId('astryn-input').closest('form') as HTMLElement);
    await new Promise((resolve) => setTimeout(resolve, 10));
    utils.unmount();
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(screen.queryByTestId('astryn-shell')).toBeNull();
  });

  it('无模型时状态条显示 MODEL_UNAVAILABLE', () => {
    shell({ conversation: null });
    expect(screen.getByTestId('astryn-model-chip').textContent).toContain('MODEL_UNAVAILABLE');
    fireEvent.change(screen.getByTestId('astryn-input'), { target: { value: '在吗' } });
    fireEvent.submit(screen.getByTestId('astryn-input').closest('form') as HTMLElement);
    return vi.waitFor(() => {
      expect(screen.getByTestId('astryn-failure-chip').textContent).toContain('MODEL_UNAVAILABLE');
    });
  });

  it('SVG 不引入第三方素材路径，且尺寸可参数化', () => {
    const markup = XiaoqiAvatar({
      frame: {
        characterId: 'xiaoqi',
        sessionId: 's1',
        visibleState: toVisibleState({
          protocol: 'astryn-1',
          sessionId: 's1',
          revision: 0,
          conversation: 'speaking',
          activeRequestId: null,
          streamedText: '',
          expressionFrame: 3,
          task: { status: 'none', taskId: null, requestId: null, actionSummary: null, riskTier: null, step: null, percent: null, failure: null, receiptId: null },
          failure: null,
          model: { kind: 'none', providerId: null, modelId: null, available: false, reason: null, evidenceLevel: 'NO_EVIDENCE' }
        }),
        expressionFrame: 3,
        streamedText: '',
        taskStep: null,
        failureMessage: null,
        reducedMotion: false
      },
      size: 120
    });
    // 角色画面不得引用任何外部素材或网络资源（xmlns 声明除外）。
    expect(markup).not.toContain('assets/third-party');
    expect(markup).not.toMatch(/<image|href=|xlink:href=/);
    expect(markup.replace('http://www.w3.org/2000/svg', '')).not.toMatch(/https?:\/\//);
    expect(markup).toContain('width="120"');
  });
});
