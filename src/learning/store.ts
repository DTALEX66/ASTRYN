import type { AstrynContextFragment } from '@astryn/contracts';
import {
  intentAllowsAuthor,
  linkFromFragment,
  linkFromMaterial,
  masteryFromOutcomes,
  scheduleFromOutcome,
  UNLINKED_SOURCE
} from './types';
import type {
  AstrynLearningIntent,
  AstrynLearningJourney,
  AstrynLearningMaterial,
  AstrynLearningMindset,
  AstrynLearningTurn,
  AstrynMasteryReading,
  AstrynMaterialInput,
  AstrynOutcomeRecord,
  AstrynRecallOutcome,
  AstrynReviewState,
  AstrynTurnKind
} from './types';

export interface LearningCompanionOptions {
  readonly now?: () => number;
  readonly nextId?: (prefix: string) => string;
}

export interface LearningSnapshot {
  readonly materials: readonly AstrynLearningMaterial[];
  readonly activeTopicMaterialId: string | null;
  readonly journeys: readonly AstrynLearningJourney[];
  readonly contextLog: readonly AstrynLearningTurn[];
  readonly outcomes: readonly AstrynOutcomeRecord[];
  readonly review: readonly AstrynReviewState[];
  readonly mindset: AstrynLearningMindset;
}

export type AstrynAddMaterialResult =
  | { readonly ok: true; readonly material: AstrynLearningMaterial }
  | { readonly ok: false; readonly reason: 'EMPTY_TITLE' | 'EMPTY_TEXT' | 'DUPLICATE_MATERIAL' };

export type AstrynRecordTurnReason =
  | 'JOURNEY_NOT_FOUND'
  | 'JOURNEY_NOT_ACTIVE'
  | 'EMPTY_TEXT'
  | 'INTENT_REQUIRED'
  | 'INTENT_NOT_ALLOWED_FOR_KIND'
  | 'INTENT_AUTHOR_MISMATCH'
  | 'MATERIAL_NOT_FOUND';

export type AstrynRecordTurnResult =
  | { readonly ok: true; readonly turn: AstrynLearningTurn }
  | { readonly ok: false; readonly reason: AstrynRecordTurnReason };

export type AstrynRecordOutcomeResult =
  | { readonly ok: true; readonly outcome: AstrynOutcomeRecord; readonly review: AstrynReviewState | null }
  | { readonly ok: false; readonly reason: 'JOURNEY_NOT_FOUND' | 'TURN_NOT_FOUND' | 'OUTCOME_REQUIRES_USER_PRACTICE_TURN' | 'OUTCOME_ALREADY_RECORDED' };

export interface AstrynTurnInput {
  /** null/省略 = 上下文标签记录（闲聊、知识回答），不进任何学习旅程。 */
  readonly journeyId?: string | null;
  readonly kind: AstrynTurnKind;
  readonly intent?: AstrynLearningIntent | null;
  readonly author: 'user' | 'character';
  readonly text: string;
  readonly materialId?: string | null;
  readonly fragment?: AstrynContextFragment | null;
}

export interface AstrynStartJourneyInput {
  readonly materialId: string;
  readonly goal: string;
}

export type AstrynStartJourneyResult =
  | { readonly ok: true; readonly journey: AstrynLearningJourney }
  | { readonly ok: false; readonly reason: 'MATERIAL_NOT_FOUND' | 'EMPTY_GOAL' };

export interface AstrynReminderPlan {
  readonly due: readonly AstrynReviewState[];
  readonly suppressedBy: 'REMINDERS_OFF' | 'FOCUS_MODE' | null;
}

const CONTEXT_LOG_LIMIT = 20;

/**
 * 学习陪伴存储：材料库、学习旅程、上下文标签记录、显式结果与复习计划的唯一所有者。
 * 不依赖 React、不依赖任何模型端口——缺模型时资料与手工练习照常工作（GF05 验收 2）。
 */
export class LearningCompanionStore {
  private materials: AstrynLearningMaterial[] = [];
  private activeTopicMaterialId: string | null = null;
  private journeys: AstrynLearningJourney[] = [];
  private contextLog: AstrynLearningTurn[] = [];
  private outcomes: AstrynOutcomeRecord[] = [];
  private readonly reviewByMaterial = new Map<string, AstrynReviewState>();
  private mindset: AstrynLearningMindset = { proactiveReminders: true, focusMode: false };
  private readonly now: () => number;
  private readonly nextId: (prefix: string) => string;
  private readonly listeners = new Set<() => void>();
  private snapshotCache: LearningSnapshot | null = null;

  constructor(options: LearningCompanionOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    let counter = 0;
    this.nextId = options.nextId ?? ((prefix) => `${prefix}-${++counter}`);
  }

  get snapshot(): LearningSnapshot {
    if (!this.snapshotCache) {
      this.snapshotCache = {
        materials: [...this.materials],
        activeTopicMaterialId: this.activeTopicMaterialId,
        journeys: [...this.journeys],
        contextLog: [...this.contextLog],
        outcomes: [...this.outcomes],
        review: this.existingReviewStates(),
        mindset: this.mindset
      };
    }
    return this.snapshotCache;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  materialById(materialId: string): AstrynLearningMaterial | null {
    return this.materials.find((material) => material.materialId === materialId) ?? null;
  }

  journeyById(journeyId: string): AstrynLearningJourney | null {
    return this.journeys.find((journey) => journey.journeyId === journeyId) ?? null;
  }

  activeJourneyFor(materialId: string): AstrynLearningJourney | null {
    return (
      [...this.journeys].reverse().find((journey) => journey.materialId === materialId && journey.state === 'active') ?? null
    );
  }

  addMaterial(input: AstrynMaterialInput): AstrynAddMaterialResult {
    const title = input.title.trim();
    const text = input.text.trim();
    if (title.length === 0) return { ok: false, reason: 'EMPTY_TITLE' };
    if (text.length === 0) return { ok: false, reason: 'EMPTY_TEXT' };
    const duplicate = this.materials.some(
      (material) => material.sourceId === input.sourceId && material.version === input.version
    );
    if (duplicate) return { ok: false, reason: 'DUPLICATE_MATERIAL' };
    const material: AstrynLearningMaterial = {
      materialId: this.nextId('mat'),
      sourceId: input.sourceId,
      title,
      version: input.version,
      text,
      provenance: input.provenance,
      evidenceLevel: input.evidenceLevel,
      addedAt: this.isoNow()
    };
    this.materials = [...this.materials, material];
    if (this.activeTopicMaterialId === null) this.activeTopicMaterialId = material.materialId;
    this.invalidate();
    return { ok: true, material };
  }

  /** 移除材料是真实删除：正文立即不可再读；旅程历史与自评证据保留（那是学习者的练习记录）。 */
  removeMaterial(materialId: string): { readonly ok: boolean; readonly reason?: 'MATERIAL_NOT_FOUND' } {
    const exists = this.materials.some((material) => material.materialId === materialId);
    if (!exists) return { ok: false, reason: 'MATERIAL_NOT_FOUND' };
    this.materials = this.materials.filter((material) => material.materialId !== materialId);
    if (this.activeTopicMaterialId === materialId) this.activeTopicMaterialId = null;
    this.invalidate();
    return { ok: true };
  }

  selectTopic(materialId: string | null): { readonly ok: boolean; readonly reason?: 'MATERIAL_NOT_FOUND' } {
    if (materialId !== null && this.materialById(materialId) === null) {
      return { ok: false, reason: 'MATERIAL_NOT_FOUND' };
    }
    this.activeTopicMaterialId = materialId;
    this.invalidate();
    return { ok: true };
  }

  startJourney(input: AstrynStartJourneyInput): AstrynStartJourneyResult {
    if (this.materialById(input.materialId) === null) return { ok: false, reason: 'MATERIAL_NOT_FOUND' };
    const goal = input.goal.trim();
    if (goal.length === 0) return { ok: false, reason: 'EMPTY_GOAL' };
    const journey: AstrynLearningJourney = {
      journeyId: this.nextId('jrn'),
      materialId: input.materialId,
      goal,
      state: 'active',
      startedAt: this.isoNow(),
      closedAt: null,
      turns: []
    };
    this.journeys = [...this.journeys, journey];
    this.invalidate();
    return { ok: true, journey };
  }

  closeJourney(journeyId: string, state: 'completed' | 'abandoned'): { readonly ok: boolean; readonly reason?: 'JOURNEY_NOT_ACTIVE' } {
    const journey = this.journeyById(journeyId);
    if (!journey || journey.state !== 'active') return { ok: false, reason: 'JOURNEY_NOT_ACTIVE' };
    this.journeys = this.journeys.map((candidate) =>
      candidate.journeyId === journeyId ? { ...candidate, state, closedAt: this.isoNow() } : candidate
    );
    this.invalidate();
    return { ok: true };
  }

  recordTurn(input: AstrynTurnInput): AstrynRecordTurnResult {
    const text = input.text.trim();
    if (text.length === 0) return { ok: false, reason: 'EMPTY_TEXT' };
    const intent = input.intent ?? null;
    if (input.kind === 'learning' && intent === null) return { ok: false, reason: 'INTENT_REQUIRED' };
    if (input.kind !== 'learning' && intent !== null) return { ok: false, reason: 'INTENT_NOT_ALLOWED_FOR_KIND' };
    if (intent !== null && !intentAllowsAuthor(intent, input.author)) {
      return { ok: false, reason: 'INTENT_AUTHOR_MISMATCH' };
    }
    const journeyId = input.journeyId ?? null;
    if (journeyId !== null) {
      const journey = this.journeyById(journeyId);
      if (!journey) return { ok: false, reason: 'JOURNEY_NOT_FOUND' };
      if (journey.state !== 'active') return { ok: false, reason: 'JOURNEY_NOT_ACTIVE' };
    }
    const materialId = input.materialId ?? null;
    const material = materialId !== null ? this.materialById(materialId) : null;
    if (materialId !== null && material === null) return { ok: false, reason: 'MATERIAL_NOT_FOUND' };

    const fragment = input.fragment ?? null;
    // 出处诚实规则：角色轮的出处置信只能来自真实附带过的授权片段——
    // 模型没收到片段却挂"材料出处"等于伪造来源；学习者本人轮可以声称自己是对着材料练习的。
    const sourceLink =
      fragment !== null
        ? linkFromFragment(fragment)
        : material !== null && input.author === 'user'
          ? linkFromMaterial(material)
          : UNLINKED_SOURCE;
    const turn: AstrynLearningTurn = {
      turnId: this.nextId('turn'),
      journeyId,
      kind: input.kind,
      intent,
      author: input.author,
      text,
      materialId,
      sourceLink,
      recordedAt: this.isoNow()
    };
    if (journeyId === null) {
      this.contextLog = [...this.contextLog, turn].slice(-CONTEXT_LOG_LIMIT);
    } else {
      this.journeys = this.journeys.map((journey) =>
        journey.journeyId === journeyId ? { ...journey, turns: [...journey.turns, turn] } : journey
      );
    }
    this.invalidate();
    return { ok: true, turn };
  }

  /** 显式自评：唯一能驱动掌握度与复习计划的入口。同一条练习轮只可评定一次，防止重复刷次数。 */
  recordOutcome(input: { readonly journeyId: string; readonly turnId: string; readonly result: AstrynRecallOutcome }): AstrynRecordOutcomeResult {
    const journey = this.journeyById(input.journeyId);
    if (!journey) return { ok: false, reason: 'JOURNEY_NOT_FOUND' };
    const turn = journey.turns.find((candidate) => candidate.turnId === input.turnId);
    if (!turn) return { ok: false, reason: 'TURN_NOT_FOUND' };
    const ratable = turn.author === 'user' && (turn.intent === 'attempt' || turn.intent === 'recall');
    if (!ratable) return { ok: false, reason: 'OUTCOME_REQUIRES_USER_PRACTICE_TURN' };
    if (this.outcomes.some((outcome) => outcome.turnId === input.turnId)) {
      return { ok: false, reason: 'OUTCOME_ALREADY_RECORDED' };
    }
    const outcome: AstrynOutcomeRecord = {
      outcomeId: this.nextId('out'),
      journeyId: input.journeyId,
      turnId: input.turnId,
      materialId: turn.materialId,
      result: input.result,
      recordedAt: this.isoNow()
    };
    this.outcomes = [...this.outcomes, outcome];
    let review: AstrynReviewState | null = null;
    if (outcome.materialId !== null) {
      review = scheduleFromOutcome(outcome.materialId, this.reviewByMaterial.get(outcome.materialId) ?? null, input.result, this.now());
      this.reviewByMaterial.set(outcome.materialId, review);
    }
    this.invalidate();
    return { ok: true, outcome, review };
  }

  masteryFor(materialId: string): AstrynMasteryReading {
    return masteryFromOutcomes(materialId, this.outcomes);
  }

  /** 已移除材料不出现在掌握度列表（材料没了，但历史读数仍在 masteryFor 里可查）。 */
  masteryReadings(): readonly AstrynMasteryReading[] {
    return this.materials.map((material) => this.masteryFor(material.materialId));
  }

  reviewStateFor(materialId: string): AstrynReviewState | null {
    return this.reviewByMaterial.get(materialId) ?? null;
  }

  dueReviews(nowMs?: number): readonly AstrynReviewState[] {
    const now = nowMs ?? this.now();
    return this.existingReviewStates()
      .filter((state) => Date.parse(state.dueAt) <= now)
      .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
  }

  reminderPlan(nowMs?: number): AstrynReminderPlan {
    const suppressedBy = !this.mindset.proactiveReminders ? 'REMINDERS_OFF' : this.mindset.focusMode ? 'FOCUS_MODE' : null;
    return { due: this.dueReviews(nowMs), suppressedBy };
  }

  setProactiveReminders(enabled: boolean): void {
    if (this.mindset.proactiveReminders === enabled) return;
    this.mindset = { ...this.mindset, proactiveReminders: enabled };
    this.invalidate();
  }

  setFocusMode(enabled: boolean): void {
    if (this.mindset.focusMode === enabled) return;
    this.mindset = { ...this.mindset, focusMode: enabled };
    this.invalidate();
  }

  private existingReviewStates(): readonly AstrynReviewState[] {
    return [...this.reviewByMaterial.values()].filter((state) => this.materialById(state.materialId) !== null);
  }

  private isoNow(): string {
    return new Date(this.now()).toISOString();
  }

  private invalidate(): void {
    this.snapshotCache = null;
    for (const listener of this.listeners) listener();
  }
}

export function createLearningCompanion(options: LearningCompanionOptions = {}): LearningCompanionStore {
  return new LearningCompanionStore(options);
}
