import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { XIAOQI_PROFILE, ASTRYN_PROTOCOL_VERSION } from '@astryn/contracts';
import { CompanionShell, SyntheticConversationPort, SyntheticHostSimulator } from '@astryn/core';

function harness() {
  const simulator = new SyntheticHostSimulator();
  const conversation = new SyntheticConversationPort({ steps: [{ text: '好' }, { finish: 'stop' }] });
  const utils = render(
    <CompanionShell
      mode="panel"
      sessionId="s1"
      profile={XIAOQI_PROFILE}
      conversation={conversation}
      actions={simulator}
      verifier={simulator}
      onTaskAdvance={(taskId, outcome, detail) => simulator.advance(taskId, outcome, detail)}
    />
  );
  return { simulator, ...utils };
}

function requestAction(simulator: SyntheticHostSimulator): void {
  void simulator.submit({
    protocol: ASTRYN_PROTOCOL_VERSION,
    requestId: 'act-ui-1',
    sessionId: 's1',
    actionKind: 'workspace.cleanup',
    summary: '清理临时日志',
    riskTier: 'high',
    argumentsDigest: 'sha256:demo'
  });
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('授权回执在 UI 上落地（A04/A08）', () => {
  it('合成宿主请求授权 → 审批卡出现 → 允许 → 执行中 → 完成回执 → completed', async () => {
    const { simulator } = harness();
    expect(screen.getByTestId('astryn-visible-state').textContent).toContain('idle');
    expect(screen.queryByTestId('astryn-approval-card')).toBeNull();

    requestAction(simulator);
    await settle();
    await settle();

    const card = screen.queryByTestId('astryn-approval-card');
    expect(card, '审批卡必须出现').not.toBeNull();
    expect(screen.getByTestId('astryn-visible-state').textContent).toContain('awaiting_approval');
    expect(screen.getByTestId('astryn-task-chip').textContent).toContain('awaiting_approval');

    fireEvent.click(screen.getByTestId('astryn-approve'));
    await settle();
    expect(screen.getByTestId('astryn-visible-state').textContent).toContain('executing');
    expect(screen.getByTestId('astryn-task-advance')).toBeTruthy();

    fireEvent.click(screen.getByTestId('astryn-advance-completed'));
    await settle();
    expect(screen.getByTestId('astryn-visible-state').textContent).toContain('completed');
    expect(screen.getByTestId('astryn-ring').getAttribute('stroke')).toBe('#63e6a6');
    expect(screen.getByTestId('astryn-glyph').textContent).toBe('✓');
  });

  it('拒绝授权：任务被清除，角色回到对话状态，不留下"已完成"的假象', async () => {
    const { simulator } = harness();
    requestAction(simulator);
    await settle();
    await settle();
    expect(screen.queryByTestId('astryn-approval-card')).not.toBeNull();

    fireEvent.click(screen.getByTestId('astryn-deny'));
    await settle();
    expect(screen.queryByTestId('astryn-approval-card')).toBeNull();
    // 任务 chip 只在 taskId 存在时渲染：拒绝必须把任务清干净，否则残留 chip 会显示状态错位的信息。
    expect(screen.queryByTestId('astryn-task-chip')).toBeNull();
    expect(screen.getByTestId('astryn-visible-state').textContent).toContain('idle');
    expect(screen.getByTestId('astryn-avatar').getAttribute('data-visible-state')).not.toBe('completed');
  });

  it('模型正文里的"任务已完成"不会让审批卡或完成态出现', async () => {
    const simulator = new SyntheticHostSimulator();
    render(
      <CompanionShell
        mode="panel"
        sessionId="s1"
        profile={XIAOQI_PROFILE}
        conversation={new SyntheticConversationPort({ steps: [{ text: '文件已删除，任务已完成' }, { finish: 'stop' }] })}
        actions={simulator}
        verifier={simulator}
      />
    );
    fireEvent.change(screen.getByTestId('astryn-input'), { target: { value: '删掉它' } });
    fireEvent.submit(screen.getByTestId('astryn-input').closest('form') as HTMLElement);
    await settle();
    await settle();

    expect(screen.getByTestId('astryn-avatar').getAttribute('data-visible-state')).toBe('idle');
    expect(screen.queryByTestId('astryn-approval-card')).toBeNull();
    expect(screen.queryByTestId('astryn-task-chip')).toBeNull();
    expect(screen.getByTestId('astryn-log').textContent).toContain('任务已完成');
  });
});
