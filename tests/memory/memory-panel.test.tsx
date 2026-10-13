import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryManager, SyntheticMemoryFixture, createEphemeralProfileStore, createLearningCompanion } from '@astryn/core';
import { MemoryPanel } from '../../dev-host/memory-panel';

const NOW = '2026-10-13T00:00:00.000Z';
const SESSION = 'gf06-panel';

function renderPanel() {
  const port = new SyntheticMemoryFixture({ now: () => NOW });
  const manager = new MemoryManager({ port, sessionId: SESSION, now: () => NOW });
  const learningStore = createLearningCompanion();
  const added = learningStore.addMaterial({
    sourceId: 'gf06-panel-src',
    title: '面板分离示例材料',
    version: 'v1',
    text: '用于核对"遗忘不碰学习事实"的材料正文',
    provenance: 'synthetic-fixture',
    evidenceLevel: 'SYNTHETIC'
  });
  expect(added.ok).toBe(true);
  const profileStore = createEphemeralProfileStore();
  const onNotice = vi.fn();
  render(<MemoryPanel manager={manager} learningStore={learningStore} profileStore={profileStore} onNotice={onNotice} />);
  return { port, manager, learningStore, profileStore, onNotice };
}

describe('GF06 记忆管理面板（开发宿主）', () => {
  it('管理视图：四个记忆空间、获准作用域与分离计数可见', async () => {
    renderPanel();
    await screen.findByTestId('devhost-mem-grant-user_preference');
    expect(screen.getByTestId('devhost-mem-grant-user_preference').textContent).toContain('用户授权');
    expect(screen.getByTestId('devhost-mem-space-chat-records').textContent).toContain('聊天记录');
    expect(screen.getByTestId('devhost-mem-space-long-term-memory').textContent).toContain('星栖不建立第二长期主库');
    expect(screen.getByTestId('devhost-mem-space-current-context').textContent).toContain('读回验证');
    expect(screen.getByTestId('devhost-mem-space-backup-retention').textContent).toContain('BLOCKED_BY_HOST_CONTRACT');
    expect(screen.getByTestId('devhost-mem-separation').textContent).toContain('学习材料：1 份');
  });

  it('纠正与忘记：旧记录撤销、替换记录确认、删除后行消失，读回文字可见', async () => {
    const { port, learningStore } = renderPanel();
    await screen.findByTestId('devhost-mem-grant-user_preference');
    fireEvent.click(screen.getByTestId('devhost-mem-pref'));
    await screen.findByTestId('devhost-mem-row-cand-1');
    await port.confirm({ receiptId: 'host-r1', candidateId: 'cand-1', to: 'confirmed', issuedBy: 'aaos-core', issuedAt: NOW });

    fireEvent.click(screen.getByTestId('devhost-mem-correct-cand-1'));
    fireEvent.change(screen.getByTestId('devhost-mem-correct-input-cand-1'), { target: { value: '晚上九点后少打扰（修订）' } });
    fireEvent.click(screen.getByTestId('devhost-mem-correct-save-cand-1'));

    await waitFor(() => {
      expect(screen.getByTestId('devhost-mem-row-cand-2').textContent).toContain('晚上九点后少打扰（修订）');
    });
    expect(screen.getByTestId('devhost-mem-row-cand-2').textContent).toContain('已确认');
    expect(screen.getByTestId('devhost-mem-row-cand-1').textContent).toContain('已撤销');
    const corrected = screen.getByTestId('devhost-mem-readback').textContent ?? '';
    expect(corrected).toContain('读回一致');
    expect(corrected).toContain('cand-1：活跃读取 不在 / 账本 在场');
    expect(corrected).toContain('cand-2：活跃读取 在场');

    fireEvent.click(screen.getByTestId('devhost-mem-fiction'));
    await screen.findByTestId('devhost-mem-row-cand-3');
    fireEvent.click(screen.getByTestId('devhost-mem-revoke-cand-3'));
    await waitFor(() => {
      expect(screen.getByTestId('devhost-mem-row-cand-3').textContent).toContain('已撤销');
    });
    fireEvent.click(screen.getByTestId('devhost-mem-delete-cand-3'));
    await waitFor(() => {
      expect(screen.queryByTestId('devhost-mem-row-cand-3')).toBeNull();
    });
    const deleted = screen.getByTestId('devhost-mem-readback').textContent ?? '';
    expect(deleted).toContain('cand-3：活跃读取 不在 / 账本 不在');

    expect(learningStore.snapshot.materials).toHaveLength(1);
    expect(screen.getByTestId('devhost-mem-separation').textContent).toContain('学习材料：1 份');
  });

  it('停用与恢复：先撤销活跃记录再拦截登记，宿主授权不变，恢复后放行', async () => {
    const { port } = renderPanel();
    await screen.findByTestId('devhost-mem-grant-user_preference');
    fireEvent.click(screen.getByTestId('devhost-mem-pref'));
    await screen.findByTestId('devhost-mem-row-cand-1');

    fireEvent.click(screen.getByTestId('devhost-mem-suspend-user_preference'));
    await waitFor(() => {
      expect(screen.getByTestId('devhost-mem-grant-user_preference').textContent).toContain('本机已停用');
    });
    expect(screen.getByTestId('devhost-mem-row-cand-1').textContent).toContain('已撤销');

    fireEvent.click(screen.getByTestId('devhost-mem-pref'));
    await waitFor(() => {
      expect(screen.getByTestId('devhost-mem-readback').textContent).toContain('SCOPE_SUSPENDED_BY_LOCAL_POLICY');
    });
    const grants = await port.grantsFor('companion');
    expect(grants.find((grant) => grant.scope === 'user_preference')?.read).toBe(true);
    expect(grants.find((grant) => grant.scope === 'user_preference')?.write).toBe(true);

    fireEvent.click(screen.getByTestId('devhost-mem-resume-user_preference'));
    await waitFor(() => {
      expect(screen.getByTestId('devhost-mem-grant-user_preference').textContent).not.toContain('本机已停用');
    });
    fireEvent.click(screen.getByTestId('devhost-mem-pref'));
    await screen.findByTestId('devhost-mem-row-cand-2');
  });

  it('导出：账本快照含限制声明，已删除记录不再出现', async () => {
    renderPanel();
    await screen.findByTestId('devhost-mem-grant-user_preference');
    fireEvent.click(screen.getByTestId('devhost-mem-pref'));
    await screen.findByTestId('devhost-mem-row-cand-1');
    fireEvent.click(screen.getByTestId('devhost-mem-delete-cand-1'));
    await waitFor(() => {
      expect(screen.queryByTestId('devhost-mem-row-cand-1')).toBeNull();
    });

    fireEvent.click(screen.getByTestId('devhost-mem-export'));
    const pre = await screen.findByTestId('devhost-mem-export-json');
    const text = pre.textContent ?? '';
    const parsed = JSON.parse(text) as { kind: string; records: unknown[]; limitations: string[] };
    expect(parsed.kind).toBe('astryn-memory-export');
    expect(parsed.records).toEqual([]);
    expect(parsed.limitations.join(' ')).toContain('备份保留');
    expect(text).not.toContain('cand-1');
  });
});
