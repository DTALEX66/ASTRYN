import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { XIAOQI_PROFILE } from '@astryn/contracts';
import type { AstrynAvatarFrame, AstrynAvatarRenderer, AstrynCompanionState } from '@astryn/contracts';
import { AvatarView, avatarViewProfile, xiaoqiSvgRenderer } from '@astryn/core';

const baseState: AstrynCompanionState = {
  protocol: 'astryn-1',
  sessionId: 's1',
  revision: 0,
  conversation: 'idle',
  activeRequestId: null,
  streamedText: '',
  expressionFrame: 0,
  task: { status: 'none', taskId: null, requestId: null, actionSummary: null, riskTier: null, step: null, percent: null, failure: null, receiptId: null },
  failure: null,
  model: { kind: 'none', providerId: null, modelId: null, available: false, reason: null, evidenceLevel: 'NO_EVIDENCE' }
};

const neutralFrame: AstrynAvatarFrame = {
  characterId: 'xiaoqi',
  sessionId: 's1',
  visibleState: 'idle',
  expressionFrame: 0,
  streamedText: '',
  taskStep: null,
  failureMessage: null,
  reducedMotion: false
};

function testRenderer(overrides: Partial<AstrynAvatarRenderer>): AstrynAvatarRenderer {
  return {
    rendererId: 'test-driver',
    displayName: '测试驱动',
    provenance: { origin: 'original', license: 'test', note: 'test' },
    budget: { compositedOnly: true, respectReducedMotion: true, maxAmbientAnimations: 2 },
    supportedStates: ['idle'],
    supports: () => true,
    createFrame: () => neutralFrame,
    ...overrides
  };
}

function mountView(renderer: AstrynAvatarRenderer, view = undefined as Parameters<typeof AvatarView>[0]['view']) {
  return render(<AvatarView state={baseState} profile={XIAOQI_PROFILE} reducedMotion={false} renderer={renderer} view={view} />);
}

describe('GF03 渲染失败回退（标记渲染抛错 / 命令式挂载失败）', () => {
  it('标记渲染抛错时回退文本状态行，错误细节不进 DOM', () => {
    mountView(testRenderer({ renderMarkup: () => { throw new Error('boom-secret-detail'); } }));
    const fallback = screen.getByTestId('astryn-avatar-fallback');
    expect(fallback.textContent).toContain('idle');
    expect(fallback.getAttribute('role')).toBe('img');
    expect(document.body.innerHTML).not.toContain('boom-secret-detail');
    expect(screen.queryByTestId('astryn-avatar-host')).toBeNull();
  });

  it('命令式挂载失败同样回退，且先挂再回退不抛错', async () => {
    mountView(testRenderer({ mount: () => { throw new Error('mount-fail'); } }));
    await waitFor(() => {
      expect(screen.getByTestId('astryn-avatar-fallback').textContent).toContain('idle');
    });
    expect(document.body.innerHTML).not.toContain('mount-fail');
  });

  it('挂载成功时按契约释放：dispose 仅在卸载时调用一次', () => {
    const dispose = vi.fn();
    const update = vi.fn();
    const utils = mountView(testRenderer({ mount: () => ({ update, dispose }) }));
    expect(screen.getByTestId('astryn-avatar-host')).toBeTruthy();
    expect(dispose).not.toHaveBeenCalled();
    utils.unmount();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('正常驱动不回退：SVG 驱动渲染出画面', () => {
    mountView(xiaoqiSvgRenderer);
    expect(screen.queryByTestId('astryn-avatar-fallback')).toBeNull();
    const svg = screen.getByTestId('astryn-avatar-host').querySelector('svg');
    expect(svg).toBeTruthy();
    // 画布不能是空壳：状态环是每个九态帧都存在的承重结构。
    expect(svg?.querySelector('[data-testid="astryn-ring"]')).not.toBeNull();
  });

  it('呈现档透传到驱动：头像档的 viewBox 出现在真实 DOM 上', () => {
    mountView(xiaoqiSvgRenderer, avatarViewProfile('avatar'));
    const svg = screen.getByTestId('astryn-avatar-host').querySelector('svg');
    expect(svg?.getAttribute('viewBox')).toBe('10 16 100 104');
    expect(svg?.getAttribute('width')).toBe('96');
  });
});
