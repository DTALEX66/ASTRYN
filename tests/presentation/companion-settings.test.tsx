import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { XIAOQI_PROFILE } from '@astryn/contracts';
import type { AstrynCharacterProfile } from '@astryn/contracts';
import {
  CompanionShell,
  SyntheticConversationPort,
  createEphemeralProfileStore,
  createHostProfileStore
} from '@astryn/core';
import type { AstrynProfileStore } from '@astryn/core';

function renderShell(profileStore: AstrynProfileStore | null = null) {
  return render(
    <CompanionShell
      mode="panel"
      sessionId="s1"
      profile={XIAOQI_PROFILE}
      conversation={new SyntheticConversationPort({ steps: [{ text: '我在呢' }, { finish: 'stop' }] })}
      profileStore={profileStore}
    />
  );
}

function openSettings(): void {
  fireEvent.click(screen.getByTestId('astryn-settings-toggle'));
}

describe('小栖设置视图（GF01）', () => {
  it('分区齐全；女友语气默认未选中；声音明确未接通', () => {
    renderShell(createEphemeralProfileStore());
    openSettings();

    for (const id of ['identity', 'persona', 'style', 'initiative', 'learning', 'appearance', 'voice']) {
      expect(screen.getByTestId(`astryn-settings-${id}`)).toBeTruthy();
    }
    expect((screen.getByTestId('astryn-persona-learning') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId('astryn-persona-girlfriend_style_opt_in') as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByTestId('astryn-persona-optin-note')).toBe(null);

    // 语音（GF09）：未接端口时四项读数未接，运行按钮禁用，原因如实显示。
    expect(screen.getByTestId('astryn-speech-avail-tts').getAttribute('data-available')).toBe('false');
    expect(screen.getByTestId('astryn-voice-note').textContent).toContain('BLOCKED_BY_HOST_CONTRACT');
    expect((screen.getByTestId('astryn-voice-sample') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('astryn-voice-enabled') as HTMLInputElement).checked).toBe(false);

    const storage = screen.getByTestId('astryn-settings-storage').textContent ?? '';
    expect(storage).toContain('进程内');
    expect(storage).toContain('刷新即失');

    // 主动提示默认关闭：频率选择不可用；打开后自动落到最低频率。
    const cadence = screen.getByTestId('astryn-nudging-cadence') as HTMLSelectElement;
    expect(cadence.disabled).toBe(true);
    fireEvent.click(screen.getByTestId('astryn-nudging-toggle'));
    expect(cadence.disabled).toBe(false);
    expect(cadence.value).toBe('low');
  });

  it('选择女友语气出现本人选择提示；保存自增修订并写入存储', async () => {
    const store = createEphemeralProfileStore();
    renderShell(store);
    openSettings();
    await vi.waitFor(() => {
      expect(screen.getByTestId('astryn-settings-notice').textContent).toContain('尚无已保存档案');
    });

    fireEvent.click(screen.getByTestId('astryn-persona-girlfriend_style_opt_in'));
    expect(screen.getByTestId('astryn-persona-optin-note').textContent).toContain('本人');

    fireEvent.click(screen.getByTestId('astryn-settings-save'));
    await vi.waitFor(() => {
      expect(screen.getByTestId('astryn-settings-notice').textContent).toContain('修订 1');
    });

    const stored = await store.load();
    expect(stored.note).toBe('LOADED');
    expect(stored.profile.persona).toBe('girlfriend_style_opt_in');
    expect(stored.profile.profileRevision).toBe(1);
  });

  it('保存后重开（同一存储重挂载）仍是所选项', async () => {
    const store = createEphemeralProfileStore();
    const first = renderShell(store);
    openSettings();
    await vi.waitFor(() => {
      expect(screen.getByTestId('astryn-settings-notice').textContent).toContain('尚无已保存档案');
    });
    fireEvent.click(screen.getByTestId('astryn-persona-close_companion'));
    fireEvent.click(screen.getByTestId('astryn-settings-save'));
    await vi.waitFor(() => {
      expect(screen.getByTestId('astryn-settings-notice').textContent).toContain('已保存');
    });
    first.unmount();

    renderShell(store);
    openSettings();
    await vi.waitFor(() => {
      expect((screen.getByTestId('astryn-persona-close_companion') as HTMLInputElement).checked).toBe(true);
    });
    expect(screen.getByTestId('astryn-settings-revision').textContent).toContain('修订 1');
    expect((screen.getByTestId('astryn-persona-learning') as HTMLInputElement).checked).toBe(false);
  });

  it('宿主存储未接通：标注原因，保存显式失败并指认依赖', async () => {
    renderShell(createHostProfileStore());
    openSettings();
    await vi.waitFor(() => {
      expect(screen.getByTestId('astryn-settings-notice').textContent).toContain('宿主档案存储未接通');
    });
    expect(screen.getByTestId('astryn-settings-storage').textContent).toContain('未接通');
    expect(screen.getByTestId('astryn-settings-revision').textContent).toContain('修订 0');

    fireEvent.click(screen.getByTestId('astryn-settings-save'));
    await vi.waitFor(() => {
      expect(screen.getByTestId('astryn-settings-notice').textContent).toContain('保存不可用');
    });
    expect(screen.getByTestId('astryn-settings-notice').textContent).toContain('BE06');
    expect(screen.getByTestId('astryn-settings-revision').textContent).toContain('修订 0');
  });

  it('设置里的减少动效同步到面板工具栏', async () => {
    renderShell(createEphemeralProfileStore());
    openSettings();
    expect(screen.getByTestId('astryn-toggle-motion').textContent).toBe('减少动效');
    fireEvent.click(screen.getByTestId('astryn-settings-reduced-motion'));
    await vi.waitFor(() => {
      expect(screen.getByTestId('astryn-toggle-motion').textContent).toBe('启用动效');
    });
  });

  it('渲染驱动可选且出处如实：默认位图（AI 生成）与 SVG 基线可切换', () => {
    renderShell(createEphemeralProfileStore());
    openSettings();
    expect((screen.getByTestId('astryn-renderer-xiaoqi-raster-v2') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId('astryn-renderer-xiaoqi-svg-v1') as HTMLInputElement).checked).toBe(false);
    const current = screen.getByTestId('astryn-settings-renderer').textContent ?? '';
    expect(current).toContain('xiaoqi-raster-v2');
    // 出场处说明必须可辨：AI 生成不得被说成原创，原创也不得被吞。
    expect(screen.getByTestId('astryn-renderer-xiaoqi-raster-v2').closest('label')?.textContent).toContain('AI 生成');
    expect(screen.getByTestId('astryn-renderer-xiaoqi-svg-v1').closest('label')?.textContent).toContain('原创');

    fireEvent.click(screen.getByTestId('astryn-renderer-xiaoqi-svg-v1'));
    expect(screen.getByTestId('astryn-avatar-host').getAttribute('data-renderer')).toBe('xiaoqi-svg-v1');
    expect(screen.getByTestId('astryn-settings-renderer').textContent).toContain('xiaoqi-svg-v1');
  });

  it('渲染器选择的保存→重载往返：切到 SVG 保存后，同一存储重挂载仍是 SVG（C9）', async () => {
    const store = createEphemeralProfileStore();
    const first = renderShell(store);
    openSettings();
    await vi.waitFor(() => {
      expect(screen.getByTestId('astryn-settings-notice').textContent).toContain('尚无已保存档案');
    });

    fireEvent.click(screen.getByTestId('astryn-renderer-xiaoqi-svg-v1'));
    fireEvent.click(screen.getByTestId('astryn-settings-save'));
    await vi.waitFor(() => {
      expect(screen.getByTestId('astryn-settings-notice').textContent).toContain('已保存');
    });
    const stored = await store.load();
    expect(stored.profile.appearance.rendererId, '保存必须把渲染器选择写进档案').toBe('xiaoqi-svg-v1');
    first.unmount();

    renderShell(store);
    await vi.waitFor(() => {
      expect(screen.getByTestId('astryn-avatar-host').getAttribute('data-renderer')).toBe('xiaoqi-svg-v1');
    });
    openSettings();
    expect((screen.getByTestId('astryn-renderer-xiaoqi-svg-v1') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId('astryn-renderer-xiaoqi-raster-v2') as HTMLInputElement).checked).toBe(false);
  });

  it('未注册 rendererId 经 store→重载→shell 链路：画面回退 SVG 下限，单选组勾选回退项并披露（C10）', async () => {
    const unknown: AstrynCharacterProfile = {
      ...XIAOQI_PROFILE,
      appearance: { ...XIAOQI_PROFILE.appearance, rendererId: 'live2d-not-installed' }
    };
    // 未注册 id 进存储（迁移必须原样保留）——模拟旧版本/宿主写回的未知驱动，而不是直接传 props。
    const store = createEphemeralProfileStore(unknown);
    render(
      <CompanionShell mode="panel" sessionId="s1" profile={XIAOQI_PROFILE} conversation={null} profileStore={store} />
    );
    await vi.waitFor(() => {
      const host = screen.getByTestId('astryn-avatar-host');
      expect(host.getAttribute('data-renderer')).toBe('xiaoqi-svg-v1');
      expect(host.getAttribute('data-renderer-exact')).toBe('false');
    });
    openSettings();
    // 勾选态绑定实际生效驱动（B4 修复语义）：未注册 id 时勾选回退项，而不是一个都不选。
    expect((screen.getByTestId('astryn-renderer-xiaoqi-svg-v1') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId('astryn-renderer-xiaoqi-raster-v2') as HTMLInputElement).checked).toBe(false);
    expect(screen.getByTestId('astryn-settings-renderer-fallback').textContent).toContain('未注册');
  });

  it('档案里的未注册 rendererId：画面回退到 SVG 下限且显式标注（未知不当可用）', () => {
    const unknownProfile = {
      ...XIAOQI_PROFILE,
      appearance: { ...XIAOQI_PROFILE.appearance, rendererId: 'live2d-not-installed' }
    };
    render(
      <CompanionShell
        mode="panel"
        sessionId="s1"
        profile={unknownProfile}
        conversation={null}
      />
    );
    const host = screen.getByTestId('astryn-avatar-host');
    expect(host.getAttribute('data-renderer')).toBe('xiaoqi-svg-v1');
    expect(host.getAttribute('data-renderer-exact')).toBe('false');
    openSettings();
    expect((screen.getByTestId('astryn-settings-renderer-fallback').textContent ?? '')).toContain('未注册');
  });

  it('开关设置不打断会话：历史保留，未保存的修改在本会话生效', async () => {
    renderShell(createEphemeralProfileStore());
    fireEvent.change(screen.getByTestId('astryn-input'), { target: { value: '在吗' } });
    fireEvent.submit(screen.getByTestId('astryn-input').closest('form') as HTMLElement);
    await vi.waitFor(() => {
      expect(screen.getByText('我在呢')).toBeTruthy();
    });

    openSettings();
    expect(screen.queryByTestId('astryn-input')).toBe(null);
    fireEvent.click(screen.getByTestId('astryn-style-length-brief'));
    fireEvent.click(screen.getByTestId('astryn-settings-close'));

    expect(screen.getByText('我在呢')).toBeTruthy();
    expect(screen.getByTestId('astryn-reply-length').textContent).toBe('回复长度：brief');
  });
});
