import { describe, expect, it, vi } from 'vitest';
import {
  ASTRYN_REVIEW_INTERVALS_MS,
  UNLINKED_SOURCE,
  createLearningCompanion,
  knowledgeRouting,
  masteryFromOutcomes,
  scheduleFromOutcome
} from '@astryn/core';
import type {
  AstrynContextFragment,
  AstrynLearningMaterial,
  AstrynLearningTurn,
  AstrynMaterialInput,
  AstrynOutcomeRecord,
  AstrynReviewState
} from '@astryn/core';

const T0 = Date.parse('2026-10-13T10:00:00.000Z');

const materialSpec: AstrynMaterialInput = {
  sourceId: 'synth-doc-host-adapter',
  title: '宿主边界说明',
  version: 'v1',
  text: '本文档是合成测试夹具，星栖只能读取用户显式授权的作用域。',
  provenance: 'synthetic-fixture',
  evidenceLevel: 'SYNTHETIC'
};

const fragment: AstrynContextFragment = {
  scope: 'active-document-selection',
  sourceId: 'synth-doc-host-adapter',
  sourceTitle: '宿主边界说明',
  sourceVersion: 'v1',
  excerpt: '星栖只能读取用户显式授权的作用域',
  provenance: 'synthetic-fixture',
  authorizationId: 'synauth-s1-1',
  evidenceLevel: 'SYNTHETIC'
};

function makeStore(nowMs = T0) {
  let current = nowMs;
  let counter = 0;
  const store = createLearningCompanion({ now: () => current, nextId: (prefix) => `${prefix}-${++counter}` });
  return {
    store,
    advance: (deltaMs: number) => {
      current += deltaMs;
    }
  };
}

function addMaterial(store: ReturnType<typeof makeStore>['store'], overrides: Partial<AstrynMaterialInput> = {}) {
  const added = store.addMaterial({ ...materialSpec, ...overrides });
  if (!added.ok) throw new Error(`material setup failed: ${added.reason}`);
  return added.material;
}

function startJourney(store: ReturnType<typeof makeStore>['store'], materialId: string) {
  const started = store.startJourney({ materialId, goal: '理解材料' });
  if (!started.ok) throw new Error(`journey setup failed: ${started.reason}`);
  return started.journey;
}

function recordRecall(store: ReturnType<typeof makeStore>['store'], journeyId: string, materialId: string, text = '我记得是这样') {
  const recorded = store.recordTurn({ journeyId, kind: 'learning', intent: 'recall', author: 'user', text, materialId });
  if (!recorded.ok) throw new Error(`recall setup failed: ${recorded.reason}`);
  return recorded.turn;
}

describe('材料库', () => {
  it('登记材料后进入库中，首个材料自动成为当前话题', () => {
    const { store } = makeStore();
    const material = addMaterial(store);
    expect(material.materialId).toBe('mat-1');
    expect(material.addedAt).toBe(new Date(T0).toISOString());
    expect(store.materialById(material.materialId)).toEqual(material);
    expect(store.snapshot.activeTopicMaterialId).toBe(material.materialId);
  });

  it('空标题、空正文与重复来源被拒绝', () => {
    const { store } = makeStore();
    expect(store.addMaterial({ ...materialSpec, title: '   ' })).toEqual({ ok: false, reason: 'EMPTY_TITLE' });
    expect(store.addMaterial({ ...materialSpec, text: ' ' })).toEqual({ ok: false, reason: 'EMPTY_TEXT' });
    addMaterial(store);
    expect(store.addMaterial(materialSpec)).toEqual({ ok: false, reason: 'DUPLICATE_MATERIAL' });
    expect(store.addMaterial({ ...materialSpec, version: 'v2' }).ok).toBe(true);
  });

  it('移除材料后正文不再可读，当前话题被清空', () => {
    const { store } = makeStore();
    const material = addMaterial(store);
    expect(store.removeMaterial(material.materialId)).toEqual({ ok: true });
    expect(store.materialById(material.materialId)).toBeNull();
    expect(store.snapshot.activeTopicMaterialId).toBeNull();
    expect(store.removeMaterial(material.materialId)).toEqual({ ok: false, reason: 'MATERIAL_NOT_FOUND' });
  });

  it('切换话题只认现有材料，null 表示清空', () => {
    const { store } = makeStore();
    const first = addMaterial(store);
    expect(store.selectTopic(null)).toEqual({ ok: true });
    expect(store.snapshot.activeTopicMaterialId).toBeNull();
    expect(store.selectTopic('mat-404')).toEqual({ ok: false, reason: 'MATERIAL_NOT_FOUND' });
    expect(store.selectTopic(first.materialId)).toEqual({ ok: true });
    expect(store.snapshot.activeTopicMaterialId).toBe(first.materialId);
  });

  it('移除材料后：自评证据与掌握度历史保留，复习队列不再包含它', () => {
    const { store } = makeStore();
    const material = addMaterial(store);
    const journey = startJourney(store, material.materialId);
    const turn = recordRecall(store, journey.journeyId, material.materialId);
    const outcome = store.recordOutcome({ journeyId: journey.journeyId, turnId: turn.turnId, result: 'missed' });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.review?.materialId).toBe(material.materialId);
    // 正控制：移除前队列确实持有该材料，否则移除后的空断言是空洞的。
    expect(store.snapshot.review.map((state) => state.materialId)).toContain(material.materialId);
    store.removeMaterial(material.materialId);
    const reading = store.masteryFor(material.materialId);
    expect(reading.outcomeCount).toBe(1);
    expect(reading.level).toBe('emerging');
    expect(store.snapshot.review).toEqual([]);
  });
});

describe('学习旅程', () => {
  it('开始旅程要求材料存在且目标非空', () => {
    const { store } = makeStore();
    const material = addMaterial(store);
    expect(store.startJourney({ materialId: 'mat-404', goal: '学' })).toEqual({ ok: false, reason: 'MATERIAL_NOT_FOUND' });
    expect(store.startJourney({ materialId: material.materialId, goal: '  ' })).toEqual({ ok: false, reason: 'EMPTY_GOAL' });
    const started = store.startJourney({ materialId: material.materialId, goal: '理解材料' });
    expect(started.ok).toBe(true);
    if (started.ok) {
      expect(started.journey.state).toBe('active');
      expect(started.journey.turns).toEqual([]);
    }
  });

  it('结束后的旅程拒收新轮次，重复关闭被拒', () => {
    const { store } = makeStore();
    const material = addMaterial(store);
    const journey = startJourney(store, material.materialId);
    expect(store.closeJourney(journey.journeyId, 'completed')).toEqual({ ok: true });
    expect(store.closeJourney(journey.journeyId, 'completed')).toEqual({ ok: false, reason: 'JOURNEY_NOT_ACTIVE' });
    expect(
      store.recordTurn({ journeyId: journey.journeyId, kind: 'learning', intent: 'recall', author: 'user', text: '再试一次', materialId: material.materialId })
    ).toEqual({ ok: false, reason: 'JOURNEY_NOT_ACTIVE' });
    expect(store.activeJourneyFor(material.materialId)).toBeNull();
  });
});

describe('轮次类型与意图（工作项 1/2）', () => {
  it('学习轮必须带意图；非学习轮必须不带意图', () => {
    const { store } = makeStore();
    const material = addMaterial(store);
    const journey = startJourney(store, material.materialId);
    expect(store.recordTurn({ journeyId: journey.journeyId, kind: 'learning', author: 'user', text: '试试' })).toEqual({
      ok: false,
      reason: 'INTENT_REQUIRED'
    });
    expect(store.recordTurn({ kind: 'companion-chat', intent: 'review', author: 'user', text: '闲聊' })).toEqual({
      ok: false,
      reason: 'INTENT_NOT_ALLOWED_FOR_KIND'
    });
  });

  it('尝试与复述只能是学习者本人；提示与解释只能是角色', () => {
    const { store } = makeStore();
    const material = addMaterial(store);
    const journey = startJourney(store, material.materialId);
    for (const intent of ['attempt', 'recall'] as const) {
      expect(
        store.recordTurn({ journeyId: journey.journeyId, kind: 'learning', intent, author: 'character', text: '冒充学习者' })
      ).toEqual({ ok: false, reason: 'INTENT_AUTHOR_MISMATCH' });
    }
    for (const intent of ['hint', 'explain'] as const) {
      expect(
        store.recordTurn({ journeyId: journey.journeyId, kind: 'learning', intent, author: 'user', text: '冒充角色' })
      ).toEqual({ ok: false, reason: 'INTENT_AUTHOR_MISMATCH' });
    }
    expect(
      store.recordTurn({ journeyId: journey.journeyId, kind: 'learning', intent: 'hint', author: 'character', text: '想一想这里的授权关系', materialId: material.materialId }).ok
    ).toBe(true);
  });

  it('空文本与不存在的材料被拒', () => {
    const { store } = makeStore();
    const material = addMaterial(store);
    const journey = startJourney(store, material.materialId);
    expect(store.recordTurn({ journeyId: journey.journeyId, kind: 'learning', intent: 'recall', author: 'user', text: '   ' })).toEqual({
      ok: false,
      reason: 'EMPTY_TEXT'
    });
    expect(
      store.recordTurn({ journeyId: 'jrn-404', kind: 'learning', intent: 'recall', author: 'user', text: 'x', materialId: material.materialId })
    ).toEqual({ ok: false, reason: 'JOURNEY_NOT_FOUND' });
    expect(
      store.recordTurn({ journeyId: journey.journeyId, kind: 'learning', intent: 'recall', author: 'user', text: 'x', materialId: 'mat-404' })
    ).toEqual({ ok: false, reason: 'MATERIAL_NOT_FOUND' });
  });

  it('上下文标签记录不绑定旅程，且只保留最近 20 条', () => {
    const { store } = makeStore();
    for (let i = 0; i < 21; i += 1) {
      const recorded = store.recordTurn({ kind: 'companion-chat', author: 'user', text: `闲聊 ${i}` });
      expect(recorded.ok).toBe(true);
    }
    expect(store.snapshot.contextLog).toHaveLength(20);
    expect(store.snapshot.contextLog[0]?.text).toBe('闲聊 1');
    expect(store.snapshot.contextLog[19]?.text).toBe('闲聊 20');
    expect(store.snapshot.contextLog.every((turn) => turn.journeyId === null)).toBe(true);
  });
});

describe('出处关联（不虚构权威来源）', () => {
  it('授权片段在场时以片段为准，authorizationId 保留', () => {
    const { store } = makeStore();
    const material = addMaterial(store);
    const journey = startJourney(store, material.materialId);
    const recorded = store.recordTurn({
      journeyId: journey.journeyId,
      kind: 'learning',
      intent: 'explain',
      author: 'character',
      text: '这句话在说授权的边界',
      materialId: material.materialId,
      fragment
    });
    expect(recorded.ok).toBe(true);
    if (recorded.ok && recorded.turn.sourceLink.linked) {
      expect(recorded.turn.sourceLink.origin).toBe('authorized-fragment');
      expect(recorded.turn.sourceLink.authorizationId).toBe('synauth-s1-1');
      expect(recorded.turn.sourceLink.evidenceLevel).toBe('SYNTHETIC');
    } else {
      throw new Error('expected linked source');
    }
  });

  it('学习者本人轮可挂登记材料；角色轮在没有片段时不得挂材料出处', () => {
    const { store } = makeStore();
    const material = addMaterial(store);
    const journey = startJourney(store, material.materialId);
    const userTurn = recordRecall(store, journey.journeyId, material.materialId);
    expect(userTurn.sourceLink.linked).toBe(true);
    if (userTurn.sourceLink.linked) {
      expect(userTurn.sourceLink.origin).toBe('registered-material');
      expect(userTurn.sourceLink.authorizationId).toBeNull();
    }
    const characterTurn = store.recordTurn({
      journeyId: journey.journeyId,
      kind: 'learning',
      intent: 'explain',
      author: 'character',
      text: '我没有收到材料片段',
      materialId: material.materialId
    });
    expect(characterTurn.ok).toBe(true);
    if (characterTurn.ok) {
      expect(characterTurn.turn.sourceLink).toEqual(UNLINKED_SOURCE);
      expect(characterTurn.turn.materialId).toBe(material.materialId);
    }
  });

  it('没有材料与片段时明确未关联；来源绝不从文本里猜', () => {
    const { store } = makeStore();
    const recorded = store.recordTurn({
      kind: 'knowledge-answer',
      author: 'character',
      text: '据《AAOS 权威知识库》记载，答案是 42。'
    });
    expect(recorded.ok).toBe(true);
    if (recorded.ok) expect(recorded.turn.sourceLink).toEqual(UNLINKED_SOURCE);
  });
});

describe('显式结果与掌握度（不虚构掌握度）', () => {
  it('零自评 = unrated，且依据字段写明只来自显式结果', () => {
    const { store } = makeStore();
    const material = addMaterial(store);
    const reading = store.masteryFor(material.materialId);
    expect(reading.level).toBe('unrated');
    expect(reading.outcomeCount).toBe(0);
    expect(reading.basis).toBe('explicit-user-outcomes-only');
  });

  it('角色轮永远不动掌握度：十轮解释后仍为零自评', () => {
    const { store } = makeStore();
    const material = addMaterial(store);
    const journey = startJourney(store, material.materialId);
    for (let i = 0; i < 10; i += 1) {
      const recorded = store.recordTurn({
        journeyId: journey.journeyId,
        kind: 'learning',
        intent: 'explain',
        author: 'character',
        text: `第 ${i} 次解释：这段话说的是授权边界。`,
        materialId: material.materialId,
        fragment
      });
      expect(recorded.ok).toBe(true);
    }
    const reading = store.masteryFor(material.materialId);
    expect(reading.outcomeCount).toBe(0);
    expect(reading.level).toBe('unrated');
    expect(store.dueReviews()).toEqual([]);
  });

  it('只有学习者的尝试/复述轮可被自评；同一轮只能评一次', () => {
    const { store } = makeStore();
    const material = addMaterial(store);
    const journey = startJourney(store, material.materialId);
    const explain = store.recordTurn({
      journeyId: journey.journeyId,
      kind: 'learning',
      intent: 'explain',
      author: 'character',
      text: '解释',
      materialId: material.materialId
    });
    if (!explain.ok) throw new Error('setup failed');
    expect(store.recordOutcome({ journeyId: journey.journeyId, turnId: explain.turn.turnId, result: 'correct' })).toEqual({
      ok: false,
      reason: 'OUTCOME_REQUIRES_USER_PRACTICE_TURN'
    });
    const review = store.recordTurn({
      journeyId: journey.journeyId,
      kind: 'learning',
      intent: 'review',
      author: 'user',
      text: '复习一遍',
      materialId: material.materialId
    });
    if (!review.ok) throw new Error('setup failed');
    expect(store.recordOutcome({ journeyId: journey.journeyId, turnId: review.turn.turnId, result: 'correct' })).toEqual({
      ok: false,
      reason: 'OUTCOME_REQUIRES_USER_PRACTICE_TURN'
    });
    const recall = recordRecall(store, journey.journeyId, material.materialId);
    expect(store.recordOutcome({ journeyId: journey.journeyId, turnId: recall.turnId, result: 'correct' }).ok).toBe(true);
    expect(store.recordOutcome({ journeyId: journey.journeyId, turnId: recall.turnId, result: 'correct' })).toEqual({
      ok: false,
      reason: 'OUTCOME_ALREADY_RECORDED'
    });
    expect(store.masteryFor(material.materialId).outcomeCount).toBe(1);
  });

  it('自评目标必须存在', () => {
    const { store } = makeStore();
    const material = addMaterial(store);
    const journey = startJourney(store, material.materialId);
    expect(store.recordOutcome({ journeyId: 'jrn-404', turnId: 'turn-1', result: 'correct' })).toEqual({
      ok: false,
      reason: 'JOURNEY_NOT_FOUND'
    });
    expect(store.recordOutcome({ journeyId: journey.journeyId, turnId: 'turn-404', result: 'correct' })).toEqual({
      ok: false,
      reason: 'TURN_NOT_FOUND'
    });
  });

  it('掌握度阶梯：unrated → practiced → solid，missed 回落 emerging', () => {
    const { store } = makeStore();
    const material = addMaterial(store);
    const journey = startJourney(store, material.materialId);
    // 名字里的 unrated 腿必须真的被断言：无任何结果时不猜测等级。
    expect(store.masteryFor(material.materialId).level).toBe('unrated');
    const rate = (result: 'correct' | 'partial' | 'missed') => {
      const turn = recordRecall(store, journey.journeyId, material.materialId);
      const recorded = store.recordOutcome({ journeyId: journey.journeyId, turnId: turn.turnId, result });
      expect(recorded.ok).toBe(true);
    };
    rate('correct');
    expect(store.masteryFor(material.materialId).level).toBe('practiced');
    rate('correct');
    expect(store.masteryFor(material.materialId).level).toBe('practiced');
    rate('correct');
    expect(store.masteryFor(material.materialId).level).toBe('solid');
    rate('missed');
    expect(store.masteryFor(material.materialId).level).toBe('emerging');
  });

  it('无材料轮的显式结果如实留存，但不排程任何复习', () => {
    const { store } = makeStore();
    const material = addMaterial(store);
    const journey = startJourney(store, material.materialId);
    const recorded = store.recordTurn({ journeyId: journey.journeyId, kind: 'learning', intent: 'attempt', author: 'user', text: '凭印象说说' });
    if (!recorded.ok) throw new Error('setup failed');
    const outcome = store.recordOutcome({ journeyId: journey.journeyId, turnId: recorded.turn.turnId, result: 'correct' });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.review).toBeNull();
      expect(outcome.outcome.materialId).toBeNull();
    }
    expect(store.snapshot.review).toEqual([]);
  });
});

describe('复习排程只由显式结果驱动', () => {
  it('missed → 10 分钟后重来；未到期不在队列中', () => {
    const { store, advance } = makeStore();
    const material = addMaterial(store);
    const journey = startJourney(store, material.materialId);
    const turn = recordRecall(store, journey.journeyId, material.materialId);
    const recorded = store.recordOutcome({ journeyId: journey.journeyId, turnId: turn.turnId, result: 'missed' });
    expect(recorded.ok).toBe(true);
    if (recorded.ok) {
      expect(recorded.review?.step).toBe(0);
      expect(recorded.review?.dueAt).toBe(new Date(T0 + 10 * 60 * 1000).toISOString());
    }
    expect(store.dueReviews()).toEqual([]);
    advance(10 * 60 * 1000);
    expect(store.dueReviews()).toHaveLength(1);
    expect(store.dueReviews()[0]?.materialId).toBe(material.materialId);
  });

  it('correct 逐步加长：1 天 → 3 天 → 7 天，步进封顶', () => {
    // 先钉死阶梯本身：断言与共享常量对比会让"常量被改错"同时通过两边。
    expect(ASTRYN_REVIEW_INTERVALS_MS).toEqual([86_400_000, 259_200_000, 604_800_000]);
    const DAY = 86_400_000;
    const { store, advance } = makeStore();
    const material = addMaterial(store);
    const journey = startJourney(store, material.materialId);
    const rate = (result: 'correct' | 'partial' | 'missed') => {
      const turn = recordRecall(store, journey.journeyId, material.materialId);
      const recorded = store.recordOutcome({ journeyId: journey.journeyId, turnId: turn.turnId, result });
      if (!recorded.ok) throw new Error('rate failed');
      return recorded.review;
    };
    const first = rate('correct');
    expect(first?.step).toBe(0);
    expect(first?.dueAt).toBe(new Date(T0 + 1 * DAY).toISOString());
    advance(1 * DAY);
    const second = rate('correct');
    expect(second?.step).toBe(1);
    expect(second?.dueAt).toBe(new Date(T0 + 1 * DAY + 3 * DAY).toISOString());
    const third = rate('correct');
    expect(third?.step).toBe(2);
    expect(third?.dueAt).toBe(new Date(T0 + 1 * DAY + 7 * DAY).toISOString());
    const fourth = rate('correct');
    // 封顶：第 4 次 correct 不再出现新步，且复用最后一档（7 天）间隔。
    expect(fourth?.step).toBe(2);
    expect(fourth?.dueAt).toBe(new Date(T0 + 1 * DAY + 7 * DAY).toISOString());
  });

  it('partial 回到第一步；missed 拉回 10 分钟', () => {
    const { store } = makeStore();
    const material = addMaterial(store);
    const journey = startJourney(store, material.materialId);
    const rate = (result: 'correct' | 'partial' | 'missed') => {
      const turn = recordRecall(store, journey.journeyId, material.materialId);
      const recorded = store.recordOutcome({ journeyId: journey.journeyId, turnId: turn.turnId, result });
      if (!recorded.ok) throw new Error('rate failed');
      return recorded.review;
    };
    rate('correct');
    rate('correct');
    const partial = rate('partial');
    expect(partial?.step).toBe(0);
    expect(partial?.dueAt).toBe(new Date(T0 + ASTRYN_REVIEW_INTERVALS_MS[0]).toISOString());
    const missed = rate('missed');
    expect(missed?.dueAt).toBe(new Date(T0 + 10 * 60 * 1000).toISOString());
  });

  it('排程纯函数与失败序列可单独复核', () => {
    const previous: AstrynReviewState = { materialId: 'm', step: 1, dueAt: new Date(T0).toISOString() };
    expect(scheduleFromOutcome('m', previous, 'missed', T0).dueAt).toBe(new Date(T0 + 10 * 60 * 1000).toISOString());
    expect(scheduleFromOutcome('m', previous, 'partial', T0).step).toBe(0);
    expect(scheduleFromOutcome('m', previous, 'correct', T0).step).toBe(2);
    expect(scheduleFromOutcome('m', null, 'correct', T0).step).toBe(0);
  });

  it('掌握度纯函数：过滤到指定材料，其他材料的证据不算数', () => {
    const outcomes: AstrynOutcomeRecord[] = [
      { outcomeId: 'o1', journeyId: 'j1', turnId: 't1', materialId: 'a', result: 'correct', recordedAt: new Date(T0).toISOString() },
      { outcomeId: 'o2', journeyId: 'j1', turnId: 't2', materialId: 'b', result: 'missed', recordedAt: new Date(T0).toISOString() }
    ];
    expect(masteryFromOutcomes('a', outcomes).outcomeCount).toBe(1);
    expect(masteryFromOutcomes('a', outcomes).level).toBe('practiced');
    expect(masteryFromOutcomes('b', outcomes).level).toBe('emerging');
    expect(masteryFromOutcomes('c', outcomes).level).toBe('unrated');
  });
});

describe('提醒与专注（工作项 3：可关闭主动提醒、进入专注）', () => {
  it('默认开启提醒；关闭后队列保留、提示被抑制', () => {
    const { store, advance } = makeStore();
    const material = addMaterial(store);
    const journey = startJourney(store, material.materialId);
    const turn = recordRecall(store, journey.journeyId, material.materialId);
    store.recordOutcome({ journeyId: journey.journeyId, turnId: turn.turnId, result: 'missed' });
    advance(10 * 60 * 1000);
    expect(store.snapshot.mindset).toEqual({ proactiveReminders: true, focusMode: false });
    expect(store.reminderPlan().suppressedBy).toBeNull();
    expect(store.reminderPlan().due).toHaveLength(1);
    store.setProactiveReminders(false);
    const plan = store.reminderPlan();
    expect(plan.suppressedBy).toBe('REMINDERS_OFF');
    expect(plan.due).toHaveLength(1);
    expect(store.dueReviews()).toHaveLength(1);
  });

  it('专注模式暂停提醒；两个开关同时关闭时以长期偏好（提醒关闭）优先', () => {
    const { store } = makeStore();
    store.setFocusMode(true);
    expect(store.reminderPlan().suppressedBy).toBe('FOCUS_MODE');
    store.setProactiveReminders(false);
    expect(store.reminderPlan().suppressedBy).toBe('REMINDERS_OFF');
    store.setFocusMode(false);
    expect(store.reminderPlan().suppressedBy).toBe('REMINDERS_OFF');
  });

  it('开关不产生新快照以外副作用：重复设置同值不触发订阅', () => {
    const { store } = makeStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.setProactiveReminders(true);
    expect(listener).not.toHaveBeenCalled();
    store.setProactiveReminders(false);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('知识路由（闲聊不自动入正式知识）', () => {
  const base = {
    turnId: 't',
    journeyId: null,
    author: 'user',
    text: 'x',
    materialId: null,
    recordedAt: new Date(T0).toISOString()
  } as const;

  it('同伴闲聊永不进入知识通道', () => {
    const turn: AstrynLearningTurn = { ...base, kind: 'companion-chat', intent: null, sourceLink: UNLINKED_SOURCE };
    expect(knowledgeRouting(turn)).toEqual({ autoCapture: false, eligible: false, reason: 'COMPANION_CHAT_EXCLUDED' });
  });

  it('无来源的知识回答进不去知识通道', () => {
    const turn: AstrynLearningTurn = { ...base, kind: 'knowledge-answer', intent: null, sourceLink: UNLINKED_SOURCE, author: 'character' };
    expect(knowledgeRouting(turn)).toEqual({ autoCapture: false, eligible: false, reason: 'SOURCE_UNLINKED' });
  });

  it('有来源的学习轮也只允许本人手动登记，永不自动', () => {
    const material: AstrynLearningMaterial = {
      materialId: 'm1',
      sourceId: 'src',
      title: '材料',
      version: 'v1',
      text: 'x',
      provenance: 'synthetic-fixture',
      evidenceLevel: 'SYNTHETIC',
      addedAt: new Date(T0).toISOString()
    };
    const turn: AstrynLearningTurn = {
      ...base,
      kind: 'learning',
      intent: 'recall',
      materialId: 'm1',
      sourceLink: {
        linked: true,
        origin: 'registered-material',
        sourceId: 'src',
        sourceTitle: material.title,
        sourceVersion: material.version,
        provenance: material.provenance,
        evidenceLevel: material.evidenceLevel,
        authorizationId: null
      }
    };
    expect(knowledgeRouting(turn)).toEqual({ autoCapture: false, eligible: true, reason: 'USER_INITIATED_ONLY' });
  });
});

describe('快照与订阅', () => {
  it('快照引用在无变更时稳定，变更后失效；订阅收到通知', () => {
    const { store } = makeStore();
    const first = store.snapshot;
    expect(store.snapshot).toBe(first);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    addMaterial(store);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.snapshot).not.toBe(first);
    unsubscribe();
    store.selectTopic(null);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
