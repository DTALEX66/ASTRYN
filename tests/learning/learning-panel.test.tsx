import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SYNTHETIC_DOC, createLearningCompanion } from '@astryn/core';
import type { AstrynContextFragment } from '@astryn/core';
import { LearningPanel } from '../../dev-host/learning-panel';
import type { LearningPanelProps } from '../../dev-host/learning-panel';

const fragment: AstrynContextFragment = {
  scope: 'active-document-selection',
  sourceId: 'synth-doc-host-adapter',
  sourceTitle: '合成夹具·宿主边界说明',
  sourceVersion: 'v1',
  excerpt: '本文档是合成测试夹具',
  provenance: 'synthetic-fixture',
  authorizationId: 'synauth-s1-1',
  evidenceLevel: 'SYNTHETIC'
};

function renderPanel(overrides: Partial<LearningPanelProps> = {}) {
  const store = createLearningCompanion();
  const onExplain = vi.fn();
  const props: LearningPanelProps = {
    store,
    modelAvailable: false,
    onImportFragment: async () => fragment,
    onExplain,
    readCharacterReply: () => '',
    ...overrides
  };
  render(<LearningPanel {...props} />);
  return { store, onExplain };
}

async function importSelection() {
  fireEvent.click(screen.getByTestId('devhost-learning-import-selection'));
  await waitFor(() => {
    expect(screen.getByTestId(/devhost-learning-material-mat-/)).toBeTruthy();
  });
}

describe('学习面板：缺模型的手工闭环（GF05 验收 2）', () => {
  it('缺模型也能走完 材料→旅程→复述→自评→复习排程，解释按钮禁用并说明原因', async () => {
    const { store } = renderPanel();
    fireEvent.click(screen.getByTestId('devhost-learning-import-sample'));
    const material = store.snapshot.materials[0];
    expect(material).toBeDefined();
    if (!material) throw new Error('material setup failed');
    expect(screen.getByTestId(`devhost-learning-material-${material.materialId}`).textContent).toContain('SYNTHETIC');

    const explain = screen.queryByTestId('devhost-learning-explain');
    expect(explain).toBeNull();

    fireEvent.click(screen.getByTestId('devhost-learning-start'));
    expect(screen.getByTestId('devhost-learning-active-journey').textContent).toContain('理解这段材料的含义');

    const explainButton = screen.getByTestId('devhost-learning-explain') as HTMLButtonElement;
    expect(explainButton.disabled).toBe(true);
    expect(explainButton.getAttribute('title')).toContain('未接通模型');

    const outcomesDisabledBefore = screen.getByTestId('devhost-learning-outcome-correct') as HTMLButtonElement;
    expect(outcomesDisabledBefore.disabled).toBe(true);

    fireEvent.change(screen.getByTestId('devhost-learning-recall-input'), {
      target: { value: '我先猜：星栖只能读显式授权的东西' }
    });
    fireEvent.click(screen.getByTestId('devhost-learning-attempt-submit'));
    const attemptTurnId = store.snapshot.journeys[0]?.turns[0]?.turnId ?? '';
    expect(screen.getByTestId(`devhost-learning-turn-${attemptTurnId}`).textContent).toContain('尝试');

    fireEvent.change(screen.getByTestId('devhost-learning-recall-input'), {
      target: { value: '宿主边界就是星栖只能读显式授权的东西' }
    });
    fireEvent.click(screen.getByTestId('devhost-learning-recall-submit'));

    const recallTurnId = store.snapshot.journeys[0]?.turns[1]?.turnId ?? '';
    const turnRow = screen.getByTestId(`devhost-learning-turn-${recallTurnId}`);
    expect(turnRow.textContent).toContain('复述');
    expect(turnRow.textContent).toContain('登记材料');
    expect(screen.getByTestId('devhost-learning-feedback').textContent).toContain(SYNTHETIC_DOC.fullText);

    fireEvent.click(screen.getByTestId('devhost-learning-outcome-correct'));
    const masteryRow = screen.getByTestId(`devhost-learning-mastery-${material.materialId}`);
    expect(masteryRow.textContent).toContain('在练');
    expect(masteryRow.textContent).toContain('下次复习');
    expect(masteryRow.textContent).toContain('explicit-user-outcomes-only');

    const outcomeButtons = ['correct', 'partial', 'missed'].map(
      (key) => screen.getByTestId(`devhost-learning-outcome-${key}`) as HTMLButtonElement
    );
    expect(outcomeButtons.every((button) => button.disabled)).toBe(true);
  });

  it('移除材料后复述无法再关联，界面如实说明', async () => {
    const { store } = renderPanel();
    fireEvent.click(screen.getByTestId('devhost-learning-import-sample'));
    const material = store.snapshot.materials[0];
    if (!material) throw new Error('material setup failed');
    fireEvent.click(screen.getByTestId('devhost-learning-start'));
    fireEvent.click(screen.getByTestId(`devhost-learning-remove-${material.materialId}`));
    expect(screen.queryByTestId(`devhost-learning-material-${material.materialId}`)).toBeNull();
    expect(screen.getByTestId('devhost-learning-topic').textContent).toContain('未选择');

    fireEvent.change(screen.getByTestId('devhost-learning-recall-input'), { target: { value: '还是想复述一下' } });
    fireEvent.click(screen.getByTestId('devhost-learning-recall-submit'));
    expect(screen.getByTestId('devhost-learning-notice').textContent).toContain('MATERIAL_NOT_FOUND');
  });
});

describe('学习面板：授权片段与来历（不虚构来源）', () => {
  it('选区导入后解释可用；点击把授权片段交给会话', async () => {
    const { store, onExplain } = renderPanel({ modelAvailable: true });
    await importSelection();
    const material = store.snapshot.materials[0];
    if (!material) throw new Error('material setup failed');
    fireEvent.click(screen.getByTestId('devhost-learning-start'));
    const explain = screen.getByTestId('devhost-learning-explain') as HTMLButtonElement;
    expect(explain.disabled).toBe(false);
    fireEvent.click(explain);
    expect(onExplain).toHaveBeenCalledTimes(1);
    expect(onExplain.mock.calls[0]?.[0]).toEqual(fragment);
  });

  it('记下的角色解释挂授权片段（模型确实收到了片段）', async () => {
    const { store } = renderPanel({
      modelAvailable: true,
      readCharacterReply: () => '这句话在讲授权边界。'
    });
    await importSelection();
    fireEvent.click(screen.getByTestId('devhost-learning-start'));
    fireEvent.click(screen.getByTestId('devhost-learning-capture-explain'));
    const turnId = store.snapshot.journeys[0]?.turns[0]?.turnId ?? '';
    const row = screen.getByTestId(`devhost-learning-turn-${turnId}`);
    expect(row.textContent).toContain('解释');
    expect(row.textContent).toContain('授权片段');
    expect(row.textContent).toContain('仅本人手动可登记');
  });

  it('模型没收到片段时角色轮如实显示未关联材料', () => {
    const { store } = renderPanel({
      modelAvailable: true,
      readCharacterReply: () => '（模型其实没看到材料）'
    });
    fireEvent.click(screen.getByTestId('devhost-learning-import-sample'));
    fireEvent.click(screen.getByTestId('devhost-learning-start'));
    fireEvent.click(screen.getByTestId('devhost-learning-capture-explain'));
    const turnId = store.snapshot.journeys[0]?.turns[0]?.turnId ?? '';
    const row = screen.getByTestId(`devhost-learning-turn-${turnId}`);
    expect(row.textContent).toContain('解释');
    expect(row.textContent).toContain('未关联材料');
  });
});

describe('学习面板：闲聊守卫与节奏控制（工作项 2/3）', () => {
  it('闲聊与无来源知识回答被明确挡在知识通道外', () => {
    renderPanel();
    fireEvent.click(screen.getByTestId('devhost-learning-log-chat'));
    const chatRow = screen.getByText(/今天天气真好呀/).closest('li');
    expect(chatRow?.textContent).toContain('同伴闲聊');
    expect(chatRow?.textContent).toContain('闲聊不自动入正式知识');

    fireEvent.click(screen.getByTestId('devhost-learning-log-knowledge'));
    const knowledgeRow = screen.getByText(/光合作用把光能/).closest('li');
    expect(knowledgeRow?.textContent).toContain('知识回答');
    expect(knowledgeRow?.textContent).toContain('无来源：不进知识通道');
  });

  it('主动提醒与专注模式开关改变提示条', () => {
    renderPanel();
    fireEvent.click(screen.getByTestId('devhost-learning-reminders-toggle'));
    expect(screen.getByTestId('devhost-learning-nudge-note').textContent).toContain('主动提醒已关闭');
    fireEvent.click(screen.getByTestId('devhost-learning-reminders-toggle'));
    fireEvent.click(screen.getByTestId('devhost-learning-focus-toggle'));
    expect(screen.getByTestId('devhost-learning-nudge-note').textContent).toContain('专注模式中');
  });

  it('开始旅程按钮在无材料时禁用', () => {
    renderPanel();
    const start = screen.getByTestId('devhost-learning-start') as HTMLButtonElement;
    expect(start.disabled).toBe(true);
  });

  it('完成旅程后历史行显示状态与轮次数', () => {
    const { store } = renderPanel();
    fireEvent.click(screen.getByTestId('devhost-learning-import-sample'));
    fireEvent.click(screen.getByTestId('devhost-learning-start'));
    fireEvent.click(screen.getByTestId('devhost-learning-complete'));
    const journeyId = store.snapshot.journeys[0]?.journeyId ?? '';
    const row = screen.getByTestId(`devhost-learning-journey-${journeyId}`);
    expect(row.textContent).toContain('已完成');
    expect(row.textContent).toContain('0 轮');
    expect(screen.getByTestId('devhost-learning-active-journey').textContent).toContain('没有进行中的旅程');
  });

  it('提示轮可被记录并如实标注来源状态', () => {
    const { store } = renderPanel({ modelAvailable: true, readCharacterReply: () => '想一想授权这个词。' });
    fireEvent.click(screen.getByTestId('devhost-learning-import-sample'));
    fireEvent.click(screen.getByTestId('devhost-learning-start'));
    fireEvent.click(screen.getByTestId('devhost-learning-capture-hint'));
    const turnId = store.snapshot.journeys[0]?.turns[0]?.turnId ?? '';
    const row = screen.getByTestId(`devhost-learning-turn-${turnId}`);
    expect(row.textContent).toContain('提示');
    expect(row.textContent).toContain('未关联材料');
  });
});

describe('学习面板：上下文标签行的类型标签', () => {
  it('旅程内轮次显示类型与意图芯片，未绑定旅程的轮次进入上下文记录区', () => {
    const { store } = renderPanel();
    fireEvent.click(screen.getByTestId('devhost-learning-import-sample'));
    fireEvent.click(screen.getByTestId('devhost-learning-start'));
    fireEvent.click(screen.getByTestId('devhost-learning-log-chat'));
    const log = screen.getByTestId('devhost-learning-context-log');
    expect(within(log).getByText(/今天天气真好呀/)).toBeTruthy();
    expect(store.snapshot.contextLog).toHaveLength(1);
    expect(store.snapshot.contextLog[0]?.journeyId).toBeNull();
  });
});
