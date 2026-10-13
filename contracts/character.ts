/**
 * 角色档案：身份与表达配置必须是结构化、可维护、可版本化的，
 * 而不是把全部人格塞进一段不可配置的大提示词。
 *
 * v2（GF01）：人格（persona）、主动程度、学习偏好与声音连接从表达风格里分开配置；
 * 档案带 schemaVersion + profileRevision，并声明宿主保存去向（profile 的持久化归宿主）。
 */

export interface AstrynCharacterExpressionStyle {
  readonly greetingTone: 'warm' | 'calm' | 'playful';
  readonly replyLength: 'brief' | 'balanced' | 'detailed';
  readonly emojiUse: 'none' | 'sparse';
}

export interface AstrynCharacterInitiative {
  readonly proactiveNudging: boolean;
  readonly nudgingCadence: 'off' | 'low' | 'medium';
}

export interface AstrynCharacterLearning {
  readonly explanationDepth: 'brief' | 'standard' | 'deep';
  readonly examplesFirst: boolean;
  readonly quizMe: boolean;
}

export interface AstrynCharacterVoiceStyle {
  readonly styleId: string;
  readonly speakingRate: number;
  readonly pitchOffset: number;
  /** 声音端口由宿主提供（GF09 预留）；未接通前保持 false，不得播放假语音。 */
  readonly enabled: boolean;
  readonly connectionRef: string | null;
}

export interface AstrynCharacterAppearance {
  readonly rendererId: 'xiaoqi-svg-v1';
  readonly theme: 'nightfall' | 'dawn';
  readonly scale: number;
  readonly reducedMotion: boolean;
}

/** 人格选择：默认学习伴侣；女友语气必须由用户本人显式选择。 */
export type AstrynCompanionPersonaId = 'learning' | 'close_companion' | 'girlfriend_style_opt_in';

export interface AstrynCompanionPersonaSpec {
  readonly id: AstrynCompanionPersonaId;
  readonly label: string;
  readonly summary: string;
  /** 需要用户显式选择才可启用；不得作为默认，也不得随其他开关连带打开。 */
  readonly optIn: boolean;
  /** 只追加表达层特质；不得触碰边界、事实来源与授权规则。 */
  readonly traitAdditions: readonly string[];
}

export const ASTRYN_COMPANION_PERSONAS: readonly AstrynCompanionPersonaSpec[] = [
  {
    id: 'learning',
    label: '学习伴侣',
    summary: '围绕资料学习：尝试、提示、解释、复述与复习，陪伴感服务于学习目标。',
    optIn: false,
    traitAdditions: [
      '学习优先：先确认学习目标与资料范围，再组织讲解与练习。',
      '不替用户完成练习；提示分层给出，先提示后解释。'
    ]
  },
  {
    id: 'close_companion',
    label: '亲近陪伴',
    summary: '更主动的日常陪伴：关心日常状态、适度主动开启话题，但不打断专注。',
    optIn: false,
    traitAdditions: [
      '陪伴优先：更多承接情绪与日常，主动但不纠缠。',
      '尊重专注：用户进入学习状态时收敛闲谈。'
    ]
  },
  {
    id: 'girlfriend_style_opt_in',
    label: '女友语气（本人选择后启用）',
    summary: '在亲近陪伴之上的亲密语气开关，仅在用户本人显式选择后启用，可随时关闭。',
    optIn: true,
    traitAdditions: [
      '语气可以更亲密，但不得声称拥有真实情感、不得情感绑架。',
      '亲密只影响表达方式，不改变事实来源、工具权限与授权流程。'
    ]
  }
];

export function personaSpec(id: AstrynCompanionPersonaId): AstrynCompanionPersonaSpec {
  const spec = ASTRYN_COMPANION_PERSONAS.find((candidate) => candidate.id === id);
  if (!spec) throw new Error(`unknown persona: ${id}`);
  return spec;
}

export interface AstrynCharacterProfile {
  readonly schemaVersion: 2;
  /** 每次成功保存自增；用于乐观并发与冲突检测（宿主与开发回退共用同一语义）。 */
  readonly profileRevision: number;
  readonly characterId: string;
  readonly displayName: string;
  readonly displayNameLatin: string;
  /** 必须始终向用户表明 AI 身份。 */
  readonly aiDisclosure: string;
  readonly personaSummary: string;
  readonly persona: AstrynCompanionPersonaId;
  /** 分节的人格要素，供提示组装器使用，不是单块不可拆文本。 */
  readonly personaTraits: readonly string[];
  readonly boundaries: readonly string[];
  readonly relationshipMode: 'companionship';
  readonly continuityPolicy: {
    readonly referencePastSessions: 'via-host-memory-only';
    readonly fabricateSharedHistory: false;
  };
  readonly expressionStyle: AstrynCharacterExpressionStyle;
  readonly initiative: AstrynCharacterInitiative;
  readonly learning: AstrynCharacterLearning;
  readonly voiceStyle: AstrynCharacterVoiceStyle;
  readonly appearance: AstrynCharacterAppearance;
}

/** 档案的持久化去向：正式版归宿主；ASTRYN 侧只有进程内开发回退，不落第二份档案库。 */
export const ASTRYN_PROFILE_STORAGE = {
  owner: 'ArcheAxis Core（宿主）',
  operations: ['character.profile.read', 'character.profile.write'],
  routeOwnerTask: 'BE06',
  admission: 'PROPOSED_REQUIRES_BE01_FORMAL_ADMISSION',
  devFallback: 'EPHEMERAL_DEV_MEMORY（进程内，刷新即失，仅开发宿主）'
} as const;

export const DEFAULT_CHARACTER_ID = 'xiaoqi' as const;

export const XIAOQI_PROFILE: AstrynCharacterProfile = {
  schemaVersion: 2,
  profileRevision: 0,
  characterId: DEFAULT_CHARACTER_ID,
  displayName: '小栖',
  displayNameLatin: 'Xiaoqi',
  aiDisclosure: '我是小栖，星栖里的 AI 角色，不是真人。',
  personaSummary: '赛博陪伴角色，语气亲近、克制、有生活感；主动但不越权。',
  persona: 'learning',
  personaTraits: [
    '陪伴优先：先接住用户当下的状态，再提供建议。',
    '诚实：不确定就说不确定，不编造经历与能力。',
    '克制：不催促、不情感绑架、不假装人类情感。',
    '有生活感：会用日常化的比喻，但不虚构共同经历。'
  ],
  boundaries: [
    '不得声称自己是人类或拥有真实情感体验。',
    '不得为营造亲密感而编造过去会话中未发生的事。',
    '不得把模型自述的任务结果当作系统事实。',
    '涉及删除、发送、购买、执行命令等动作必须走宿主授权。',
    '用户可随时暂停、退出并删除与自己相关的数据。'
  ],
  relationshipMode: 'companionship',
  continuityPolicy: {
    referencePastSessions: 'via-host-memory-only',
    fabricateSharedHistory: false
  },
  expressionStyle: {
    greetingTone: 'warm',
    replyLength: 'balanced',
    emojiUse: 'sparse'
  },
  initiative: { proactiveNudging: false, nudgingCadence: 'off' },
  learning: { explanationDepth: 'standard', examplesFirst: false, quizMe: false },
  voiceStyle: { styleId: 'xiaoqi-soft-zh', speakingRate: 1.0, pitchOffset: 0, enabled: false, connectionRef: null },
  appearance: { rendererId: 'xiaoqi-svg-v1', theme: 'nightfall', scale: 1, reducedMotion: false }
};

/** 覆盖按节生效：改一项表达风格不必重传整块配置。 */
export type ProfileOverrides = {
  readonly [K in 'expressionStyle' | 'appearance' | 'voiceStyle' | 'initiative' | 'learning']?: Partial<AstrynCharacterProfile[K]>;
} & {
  readonly persona?: AstrynCompanionPersonaId;
};

export function withOverrides(
  base: AstrynCharacterProfile,
  overrides: ProfileOverrides
): AstrynCharacterProfile {
  return {
    ...base,
    ...(overrides.persona ? { persona: overrides.persona } : {}),
    ...(overrides.expressionStyle ? { expressionStyle: { ...base.expressionStyle, ...overrides.expressionStyle } } : {}),
    ...(overrides.initiative ? { initiative: { ...base.initiative, ...overrides.initiative } } : {}),
    ...(overrides.learning ? { learning: { ...base.learning, ...overrides.learning } } : {}),
    ...(overrides.voiceStyle ? { voiceStyle: { ...base.voiceStyle, ...overrides.voiceStyle } } : {}),
    ...(overrides.appearance ? { appearance: { ...base.appearance, ...overrides.appearance } } : {})
  };
}

export interface ProfileMigrationResult {
  readonly profile: AstrynCharacterProfile;
  /** null = 输入已是 v2；否则说明迁移/回退原因。 */
  readonly note: 'MIGRATED_V1_TO_V2' | 'EMPTY_DEFAULT' | 'INVALID_FALLBACK' | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

const PERSONA_IDS: readonly AstrynCompanionPersonaId[] = ASTRYN_COMPANION_PERSONAS.map((spec) => spec.id);

/** 损坏或未知输入回退到默认档案，并给出原因——静默吞掉坏档案会让"设置丢了"无从解释。 */
export function migrateCharacterProfile(raw: unknown): ProfileMigrationResult {
  if (raw === null || raw === undefined) return { profile: XIAOQI_PROFILE, note: 'EMPTY_DEFAULT' };
  if (!isRecord(raw)) return { profile: XIAOQI_PROFILE, note: 'INVALID_FALLBACK' };
  if (raw.schemaVersion !== 1 && raw.schemaVersion !== 2) return { profile: XIAOQI_PROFILE, note: 'INVALID_FALLBACK' };

  const base = XIAOQI_PROFILE;
  const styleSource = isRecord(raw.expressionStyle) ? raw.expressionStyle : {};
  const initiativeSource = isRecord(raw.initiative)
    ? raw.initiative
    : {
        proactiveNudging: typeof styleSource.proactiveNudging === 'boolean' ? styleSource.proactiveNudging : false,
        nudgingCadence: styleSource.proactiveNudging === true ? 'low' : 'off'
      };
  const learningSource = isRecord(raw.learning) ? raw.learning : {};
  const voiceSource = isRecord(raw.voiceStyle) ? raw.voiceStyle : {};
  const appearanceSource = isRecord(raw.appearance) ? raw.appearance : {};

  const profile: AstrynCharacterProfile = {
    ...base,
    profileRevision: raw.schemaVersion === 2 && typeof raw.profileRevision === 'number' ? raw.profileRevision : 0,
    persona: pick(raw.persona, PERSONA_IDS, base.persona),
    displayName: typeof raw.displayName === 'string' && raw.displayName.length > 0 ? raw.displayName : base.displayName,
    expressionStyle: {
      greetingTone: pick(styleSource.greetingTone, ['warm', 'calm', 'playful'] as const, base.expressionStyle.greetingTone),
      replyLength: pick(styleSource.replyLength, ['brief', 'balanced', 'detailed'] as const, base.expressionStyle.replyLength),
      emojiUse: pick(styleSource.emojiUse, ['none', 'sparse'] as const, base.expressionStyle.emojiUse)
    },
    initiative: {
      proactiveNudging:
        typeof initiativeSource.proactiveNudging === 'boolean' ? initiativeSource.proactiveNudging : base.initiative.proactiveNudging,
      nudgingCadence: pick(initiativeSource.nudgingCadence, ['off', 'low', 'medium'] as const, base.initiative.nudgingCadence)
    },
    learning: {
      explanationDepth: pick(learningSource.explanationDepth, ['brief', 'standard', 'deep'] as const, base.learning.explanationDepth),
      examplesFirst: typeof learningSource.examplesFirst === 'boolean' ? learningSource.examplesFirst : base.learning.examplesFirst,
      quizMe: typeof learningSource.quizMe === 'boolean' ? learningSource.quizMe : base.learning.quizMe
    },
    voiceStyle: {
      styleId: typeof voiceSource.styleId === 'string' && voiceSource.styleId.length > 0 ? voiceSource.styleId : base.voiceStyle.styleId,
      speakingRate: typeof voiceSource.speakingRate === 'number' ? voiceSource.speakingRate : base.voiceStyle.speakingRate,
      pitchOffset: typeof voiceSource.pitchOffset === 'number' ? voiceSource.pitchOffset : base.voiceStyle.pitchOffset,
      enabled: typeof voiceSource.enabled === 'boolean' ? voiceSource.enabled : false,
      connectionRef: typeof voiceSource.connectionRef === 'string' ? voiceSource.connectionRef : null
    },
    appearance: {
      rendererId: 'xiaoqi-svg-v1',
      theme: pick(appearanceSource.theme, ['nightfall', 'dawn'] as const, base.appearance.theme),
      scale: typeof appearanceSource.scale === 'number' && appearanceSource.scale > 0 ? appearanceSource.scale : base.appearance.scale,
      reducedMotion: typeof appearanceSource.reducedMotion === 'boolean' ? appearanceSource.reducedMotion : base.appearance.reducedMotion
    }
  };
  return { profile, note: raw.schemaVersion === 1 ? 'MIGRATED_V1_TO_V2' : null };
}
