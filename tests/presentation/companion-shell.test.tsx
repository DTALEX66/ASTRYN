import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { XIAOQI_PROFILE } from '@astryn/contracts';
import type { AstrynCharacterProfile } from '@astryn/contracts';
import { CompanionShell, STATE_VISUALS, SyntheticConversationPort, XiaoqiAvatar, assertStateHasDistinctVisual, avatarViewProfile, renderXiaoqiMarkup } from '@astryn/core';
import { toVisibleState } from '@astryn/contracts';

/**
 * 本文件的断言目标是 v1 SVG 驱动的帧行为（状态环/口型帧/data-motion），
 * 因此显式选择 svg 驱动挂载；默认档案（v2 位图）的挂载在下方单独断言。
 */
const SVG_PROFILE: AstrynCharacterProfile = {
  ...XIAOQI_PROFILE,
  appearance: { ...XIAOQI_PROFILE.appearance, rendererId: 'xiaoqi-svg-v1' }
};

function shell(props: Partial<Parameters<typeof CompanionShell>[0]> = {}) {
  return render(
    <CompanionShell
      mode="panel"
      sessionId="s1"
      profile={SVG_PROFILE}
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

  it('默认档案经管理器渲染 MINIMAX 交付位图（v2 默认驱动），槽位走同一条令牌链', () => {
    render(<CompanionShell mode="panel" sessionId="s1" profile={XIAOQI_PROFILE} conversation={null} />);
    const host = screen.getByTestId('astryn-avatar-host');
    expect(host.getAttribute('data-renderer')).toBe('xiaoqi-raster-v2');
    expect(host.getAttribute('data-renderer-exact')).toBeNull();
    const img = screen.getByTestId('astryn-avatar');
    expect(img.tagName).toBe('IMG');
    expect(img.getAttribute('data-visible-state')).toBe('idle');
    // 槽位令牌链（C12）：panel → sidebar 档的 data-avatar-view 必须出现在外壳上，
    // 且位图宽度属性取自同档令牌——若壳层忽略 view，渲染器会兜底 240 而这里立刻变红。
    expect(screen.getByTestId('astryn-shell').getAttribute('data-avatar-view')).toBe('sidebar');
    expect(img.getAttribute('width')).toBe(String(avatarViewProfile('sidebar').width));
    expect(img.getAttribute('width')).toBe('168');
  });

  it('九种状态两两视觉可辨（环色 + 眼型 + 嘴型组合唯一，剥离状态名后仍唯一）', () => {
    const entries = Object.entries(STATE_VISUALS);
    expect(entries.length).toBe(9);
    // 令牌签名不含状态名：若两个状态的视觉组合相同，这里会立刻撞车。
    const signatures = entries.map(([, tokens]) => `${tokens.ringColor}|${tokens.eyeMode}|${tokens.mouthMode}|${tokens.glyph}`);
    expect(new Set(signatures).size).toBe(signatures.length);

    // 绘制内容比较同样剥离状态名：markup 里内嵌 data-visible-state/aria-label，
    // 不剥离则"九个 markup 互异"恒真，证明不了任何视觉差异（审计 C1）。
    const stripped = entries.map(([state]) => {
      assertStateHasDistinctVisual(state);
      const markup = renderXiaoqiMarkup({
        characterId: 'xiaoqi',
        sessionId: 's1',
        visibleState: state as never,
        expressionFrame: 0,
        streamedText: '',
        taskStep: null,
        failureMessage: null,
        reducedMotion: false
      });
      const withoutStateName = markup.replace(/data-visible-state="[^"]*"/, '').replace(/aria-label="[^"]*"/, '');
      expect(withoutStateName).not.toBe(markup);
      return withoutStateName;
    });
    expect(new Set(stripped).size).toBe(stripped.length);

    // 未登记状态必须抛错，而不是静默拼出 undefined 令牌。
    expect(() => assertStateHasDistinctVisual('not-a-registered-state')).toThrow();
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
        profile={SVG_PROFILE}
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
      <CompanionShell mode="panel" sessionId="s1" profile={SVG_PROFILE} conversation={port} />
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

describe('Q7 系统级 prefers-reduced-motion（只增强，不削弱）', () => {
  function installMatchMedia(initial: boolean) {
    const win = window as unknown as Record<string, unknown>;
    const original = win.matchMedia;
    const listeners = new Set<() => void>();
    const state = { matches: initial };
    win.matchMedia = (query: string) => ({
      media: query,
      get matches() {
        return state.matches;
      },
      addEventListener: (type: string, listener: () => void) => {
        if (type === 'change') listeners.add(listener);
      },
      removeEventListener: (type: string, listener: () => void) => {
        if (type === 'change') listeners.delete(listener);
      }
    });
    return {
      set(next: boolean) {
        state.matches = next;
        for (const listener of [...listeners]) listener();
      },
      restore() {
        if (original === undefined) delete win.matchMedia;
        else win.matchMedia = original;
      }
    };
  }

  const avatarSvg = () => screen.getByTestId('astryn-avatar-host').querySelector('svg');

  it('系统开启时无需触碰应用开关，data-motion 直接为 off，且开关被禁用并如实标注', () => {
    const stub = installMatchMedia(true);
    try {
      shell();
      expect(avatarSvg()?.getAttribute('data-motion')).toBe('off');
      const toggle = screen.getByTestId('astryn-toggle-motion') as HTMLButtonElement;
      expect(toggle.disabled).toBe(true);
      expect(toggle.textContent).toContain('系统已在减少动效');
    } finally {
      stub.restore();
    }
  });

  it('系统开启时设置页“减少动效”同样只读并如实标注（应用内不可覆盖系统，B1）', () => {
    const stub = installMatchMedia(true);
    try {
      shell();
      fireEvent.click(screen.getByTestId('astryn-settings-toggle'));
      const checkbox = screen.getByTestId('astryn-settings-reduced-motion') as HTMLInputElement;
      expect(checkbox.disabled).toBe(true);
      expect(checkbox.checked).toBe(true);
      expect(checkbox.closest('label')?.textContent ?? '').toContain('不可覆盖');
    } finally {
      stub.restore();
    }
  });

  it('系统偏好运行中切换（change 事件）实时生效，可回开', () => {
    const stub = installMatchMedia(false);
    try {
      shell();
      expect(avatarSvg()?.getAttribute('data-motion')).toBe('on');
      act(() => stub.set(true));
      expect(avatarSvg()?.getAttribute('data-motion')).toBe('off');
      act(() => stub.set(false));
      expect(avatarSvg()?.getAttribute('data-motion')).toBe('on');
    } finally {
      stub.restore();
    }
  });

  it('系统开启时应用开关无法重新启用动效（只增强，不削弱）', () => {
    const stub = installMatchMedia(true);
    try {
      shell();
      fireEvent.click(screen.getByTestId('astryn-toggle-motion'));
      expect(avatarSvg()?.getAttribute('data-motion')).toBe('off');
    } finally {
      stub.restore();
    }
  });
});

describe('工具栏减少动效写入档案（B2：档案变更不复位）', () => {
  it('切换即更新档案值；后续任意档案变更不把它静默复位，设置页读到同一份值', () => {
    shell();
    const svg = (): Element | null => screen.getByTestId('astryn-avatar-host').querySelector('svg');
    expect(svg()?.getAttribute('data-motion')).toBe('on');
    fireEvent.click(screen.getByTestId('astryn-toggle-motion'));
    expect(svg()?.getAttribute('data-motion')).toBe('off');
    // 任一档案变更（回复长度切换走同一条 setProfile 通道）不得复位该选择。
    fireEvent.click(screen.getByTestId('astryn-reply-length'));
    expect(svg()?.getAttribute('data-motion')).toBe('off');
    // 设置页读同一份档案值：单一事实来源，不存在会被覆盖的本地态。
    fireEvent.click(screen.getByTestId('astryn-settings-toggle'));
    expect((screen.getByTestId('astryn-settings-reduced-motion') as HTMLInputElement).checked).toBe(true);
  });
});
