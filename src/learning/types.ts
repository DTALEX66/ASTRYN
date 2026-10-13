import type { AstrynContextFragment, AstrynContextProvenance } from '@astryn/contracts';

/**
 * GF05 学习陪伴域类型与纯策略。
 * 两条贯穿全模块的诚实纪律：
 * 1. 掌握度的唯一来源是学习者的显式自评结果（attempt/recall 轮 + 用户勾选），角色文本永不参与；
 * 2. 出处反馈只引用真实登记的材料或经授权的片段，绝不从模型文本里"推断来源"。
 */

/** 六类学习意图：尝试、提示、解释、复述、出处反馈、复习。 */
export const ASTRYN_LEARNING_INTENTS = ['attempt', 'hint', 'explain', 'recall', 'feedback', 'review'] as const;
export type AstrynLearningIntent = (typeof ASTRYN_LEARNING_INTENTS)[number];

/** 轮次类型：学习、知识回答、同伴闲聊——每一轮都必须带明确类型与上下文标签。 */
export const ASTRYN_TURN_KINDS = ['learning', 'knowledge-answer', 'companion-chat'] as const;
export type AstrynTurnKind = (typeof ASTRYN_TURN_KINDS)[number];

export const ASTRYN_RECALL_OUTCOMES = ['correct', 'partial', 'missed'] as const;
export type AstrynRecallOutcome = (typeof ASTRYN_RECALL_OUTCOMES)[number];

export interface AstrynLearningMaterial {
  readonly materialId: string;
  readonly sourceId: string;
  readonly title: string;
  readonly version: string;
  readonly text: string;
  readonly provenance: AstrynContextProvenance;
  readonly evidenceLevel: 'REAL' | 'SYNTHETIC';
  readonly addedAt: string;
}

export type AstrynMaterialInput = Omit<AstrynLearningMaterial, 'materialId' | 'addedAt'>;

export type AstrynSourceLink =
  | {
      readonly linked: true;
      /** 授权片段优先于登记材料：片段带 authorizationId，材料只有登记身份。 */
      readonly origin: 'authorized-fragment' | 'registered-material';
      readonly sourceId: string;
      readonly sourceTitle: string;
      readonly sourceVersion: string;
      readonly provenance: AstrynContextProvenance;
      readonly evidenceLevel: 'REAL' | 'SYNTHETIC';
      readonly authorizationId: string | null;
    }
  | { readonly linked: false; readonly reason: 'NO_MATERIAL_OR_FRAGMENT' };

export const UNLINKED_SOURCE: AstrynSourceLink = { linked: false, reason: 'NO_MATERIAL_OR_FRAGMENT' };

export function linkFromFragment(fragment: AstrynContextFragment): AstrynSourceLink {
  return {
    linked: true,
    origin: 'authorized-fragment',
    sourceId: fragment.sourceId,
    sourceTitle: fragment.sourceTitle,
    sourceVersion: fragment.sourceVersion,
    provenance: fragment.provenance,
    evidenceLevel: fragment.evidenceLevel,
    authorizationId: fragment.authorizationId
  };
}

export function linkFromMaterial(material: AstrynLearningMaterial): AstrynSourceLink {
  return {
    linked: true,
    origin: 'registered-material',
    sourceId: material.sourceId,
    sourceTitle: material.title,
    sourceVersion: material.version,
    provenance: material.provenance,
    evidenceLevel: material.evidenceLevel,
    authorizationId: null
  };
}

export interface AstrynLearningTurn {
  readonly turnId: string;
  /** null = 上下文标签记录（未绑定学习旅程），如闲聊与知识回答。 */
  readonly journeyId: string | null;
  readonly kind: AstrynTurnKind;
  /** 学习轮必填；非学习轮的意图必须为 null（类型即约束）。 */
  readonly intent: AstrynLearningIntent | null;
  readonly author: 'user' | 'character';
  readonly text: string;
  readonly materialId: string | null;
  readonly sourceLink: AstrynSourceLink;
  readonly recordedAt: string;
}

export interface AstrynOutcomeRecord {
  readonly outcomeId: string;
  readonly journeyId: string;
  readonly turnId: string;
  readonly materialId: string | null;
  readonly result: AstrynRecallOutcome;
  readonly recordedAt: string;
}

export type AstrynMasteryLevel = 'unrated' | 'emerging' | 'practiced' | 'solid';

export interface AstrynMasteryReading {
  readonly materialId: string;
  readonly level: AstrynMasteryLevel;
  readonly outcomeCount: number;
  readonly correctCount: number;
  readonly lastResult: AstrynRecallOutcome | null;
  readonly lastRecordedAt: string | null;
  /** 掌握度的唯一来源：学习者显式自评结果；角色文本永不参与。 */
  readonly basis: 'explicit-user-outcomes-only';
}

export interface AstrynReviewState {
  readonly materialId: string;
  readonly step: number;
  readonly dueAt: string;
}

export interface AstrynLearningJourney {
  readonly journeyId: string;
  readonly materialId: string;
  readonly goal: string;
  readonly state: 'active' | 'completed' | 'abandoned';
  readonly startedAt: string;
  readonly closedAt: string | null;
  readonly turns: readonly AstrynLearningTurn[];
}

export interface AstrynLearningMindset {
  readonly proactiveReminders: boolean;
  readonly focusMode: boolean;
}

/** 意图与作者的静态配对：尝试与复述只能是学习者本人，提示与解释只能是角色。 */
const INTENT_AUTHOR: Readonly<Record<AstrynLearningIntent, 'user' | 'character' | 'both'>> = {
  attempt: 'user',
  recall: 'user',
  hint: 'character',
  explain: 'character',
  feedback: 'both',
  review: 'both'
};

export function intentAllowsAuthor(intent: AstrynLearningIntent, author: 'user' | 'character'): boolean {
  const allowed = INTENT_AUTHOR[intent];
  return allowed === 'both' || allowed === author;
}

const MISS_RETRY_MS = 10 * 60 * 1000;
export const ASTRYN_REVIEW_INTERVALS_MS = [24 * 60 * 60 * 1000, 72 * 60 * 60 * 1000, 168 * 60 * 60 * 1000] as const;

/** 复习计划只由显式结果驱动：想不起来→10 分钟后重来；部分想起→回到第一步；想起→步进加长。 */
export function scheduleFromOutcome(
  materialId: string,
  previous: AstrynReviewState | null,
  result: AstrynRecallOutcome,
  nowMs: number
): AstrynReviewState {
  if (result === 'missed') {
    return { materialId, step: 0, dueAt: new Date(nowMs + MISS_RETRY_MS).toISOString() };
  }
  if (result === 'partial') {
    return { materialId, step: 0, dueAt: new Date(nowMs + ASTRYN_REVIEW_INTERVALS_MS[0]).toISOString() };
  }
  const step = Math.min((previous?.step ?? -1) + 1, ASTRYN_REVIEW_INTERVALS_MS.length - 1);
  const interval = ASTRYN_REVIEW_INTERVALS_MS[step] ?? ASTRYN_REVIEW_INTERVALS_MS[0];
  return { materialId, step, dueAt: new Date(nowMs + interval).toISOString() };
}

/** 掌握度：纯函数，输入只有显式结果记录。没有任何结果 → unrated，永不猜测。 */
export function masteryFromOutcomes(materialId: string, outcomes: readonly AstrynOutcomeRecord[]): AstrynMasteryReading {
  const relevant = outcomes.filter((outcome) => outcome.materialId === materialId);
  const last = relevant.length > 0 ? (relevant[relevant.length - 1] ?? null) : null;
  const correctCount = relevant.filter((outcome) => outcome.result === 'correct').length;
  let level: AstrynMasteryLevel;
  if (last === null) level = 'unrated';
  else if (last.result === 'missed') level = 'emerging';
  else if (correctCount >= 2 && relevant.length >= 3) level = 'solid';
  else level = 'practiced';
  return {
    materialId,
    level,
    outcomeCount: relevant.length,
    correctCount,
    lastResult: last?.result ?? null,
    lastRecordedAt: last?.recordedAt ?? null,
    basis: 'explicit-user-outcomes-only'
  };
}

export interface AstrynKnowledgeRouting {
  /** 恒定 false：任何轮次都不自动进入正式知识，登记必须由本人显式发起。 */
  readonly autoCapture: false;
  readonly eligible: boolean;
  readonly reason: 'COMPANION_CHAT_EXCLUDED' | 'SOURCE_UNLINKED' | 'USER_INITIATED_ONLY';
}

/** 闲聊永不进入正式知识；无来源的知识回答进不去；其余只在用户显式发起时可被登记。 */
export function knowledgeRouting(turn: AstrynLearningTurn): AstrynKnowledgeRouting {
  if (turn.kind === 'companion-chat') {
    return { autoCapture: false, eligible: false, reason: 'COMPANION_CHAT_EXCLUDED' };
  }
  if (!turn.sourceLink.linked) {
    return { autoCapture: false, eligible: false, reason: 'SOURCE_UNLINKED' };
  }
  return { autoCapture: false, eligible: true, reason: 'USER_INITIATED_ONLY' };
}
