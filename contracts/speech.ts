/**
 * 语音外壳提议（GF09）：麦克风、音色、朗读、字幕、音量与停止的前端字段与状态。
 *
 * 状态 FRONTEND_FIELDS_NOW_RUNTIME_OPTIONAL：字段与可替换适配器先行就位，
 * 运行时能力可缺席——首期没有真实语音端口时保持文本模式，不播放任何占位语音。
 * 正式登记归宿主合同（BE01）：本文件是提议，不是已生效接口；
 * 端口的缺席必须如实呈报，不得由前端伪造 audio_ref 或假播放。
 */
import type { AstrynFailureCode } from './events';
import type { AstrynProtocolVersion } from './protocol';

/** 与任务包 shared/UI-HOST-CONTRACT-PROPOSAL.json → speech_optional 逐字一致。 */
export const ASTRYN_SPEECH_PROPOSAL = {
  state: 'FRONTEND_FIELDS_NOW_RUNTIME_OPTIONAL',
  fields: [
    'session_id',
    'utterance_id',
    'chunk_id',
    'sequence',
    'audio_ref',
    'sample_rate',
    'start_offset_ms',
    'viseme_events',
    'subtitle_segments',
    'locale',
    'provenance',
    'end_of_utterance'
  ],
  rules: [
    'audio playback clock is master',
    'cancel stops audio/subtitles/mouth',
    'no phoneme events means basic amplitude mouth only'
  ]
} as const;

export const ASTRYN_SPEECH_CONTRACT_OWNER = 'AX-HOST-20261013/BE01';

/** 提议的登记门槛（与任务包 proposal 的 formalization_gate 逐字一致）。 */
export const ASTRYN_SPEECH_FORMALIZATION_GATE: readonly string[] = [
  'BE01 publishes request/response JSON Schema and Rust/TS DTOs for each admitted operation',
  'bind exact finite native command route',
  'contract and negative tests',
  'all consumers pin identical version and checksum'
];

export type AstrynSpeechFeature = 'microphone' | 'asr' | 'tts' | 'playback';

export interface AstrynSpeechFeatureAvailability {
  readonly available: boolean;
  /** 未接通/降级原因；available=true 时可为 null。界面必须原样显示，不得美化。 */
  readonly reason: string | null;
  readonly failureCode: AstrynFailureCode | null;
}

export type AstrynSpeechAvailability = Readonly<Record<AstrynSpeechFeature, AstrynSpeechFeatureAvailability>>;

export const ASTRYN_SPEECH_UNCONNECTED_REASON =
  'BLOCKED_BY_HOST_CONTRACT：语音操作未登记（BE01），前端字段先行、运行时可选项缺席；此状态下不播放任何语音，也不启用麦克风。';

/** 语音端口缺席时的如实读数：四项能力全部未接通，同一原因。 */
export function unconnectedSpeechAvailability(): AstrynSpeechAvailability {
  const entry: AstrynSpeechFeatureAvailability = {
    available: false,
    reason: ASTRYN_SPEECH_UNCONNECTED_REASON,
    failureCode: 'HOST_CONTRACT_MISSING'
  };
  return { microphone: entry, asr: entry, tts: entry, playback: entry };
}

/** 口型模式：由"是否有音频 + 是否有音素时间戳"三态判定，编码规则三。 */
export type AstrynMouthMode = 'text-frames' | 'basic-amplitude' | 'viseme';

export const ASTRYN_MOUTH_MODE_LABELS: Readonly<Record<AstrynMouthMode, string>> = {
  'text-frames': '文本帧口型（无音频）',
  'basic-amplitude': '基础口型（仅振幅，无音素时间戳）',
  viseme: '音素口型（viseme 时间戳）'
};

export function resolveMouthMode(hasAudio: boolean, hasVisemeEvents: boolean): AstrynMouthMode {
  if (!hasAudio) return 'text-frames';
  return hasVisemeEvents ? 'viseme' : 'basic-amplitude';
}

/** viseme 事件偏移与 start_offset_ms 同口径：相对 utterance 起点。 */
export interface AstrynSpeechVisemeEvent {
  readonly atMs: number;
  readonly viseme: string;
}

export interface AstrynSpeechSubtitleSegment {
  readonly startMs: number;
  readonly endMs: number;
  readonly text: string;
}

/** 建议中的块结构：字段名对应 speech_optional.fields（snake_case → camelCase）。 */
export interface AstrynSpeechChunk {
  readonly sessionId: string;
  readonly utteranceId: string;
  readonly chunkId: string;
  /** 同一 utterance 内严格递增；乱序/重复由消费侧守卫丢弃。 */
  readonly sequence: number;
  /** null = 本块无音频（仅字幕/文本帧），不得由前端补造引用。 */
  readonly audioRef: string | null;
  readonly sampleRate: number | null;
  readonly startOffsetMs: number;
  /** null/空 = 宿主不提供音素时间戳 → 只允许基础口型。 */
  readonly visemeEvents: readonly AstrynSpeechVisemeEvent[] | null;
  readonly subtitleSegments: readonly AstrynSpeechSubtitleSegment[];
  readonly locale: string | null;
  readonly provenance: 'REAL' | 'SYNTHETIC';
  readonly endOfUtterance: boolean;
}

export interface AstrynSpeechRequest {
  readonly protocol: AstrynProtocolVersion;
  readonly sessionId: string;
  readonly utteranceId: string;
  readonly text: string;
  readonly locale: string | null;
}

/**
 * 语音端口提议（可替换适配器）。BE01 正式登记前不提供任何实现；
 * 停止 = 中止 speak 的 AbortSignal + 本地原子复位（规则二：cancel stops audio/subtitles/mouth）。
 */
export interface AstrynSpeechPort {
  readonly protocol: AstrynProtocolVersion;
  readonly providerId: string;
  readonly evidenceLevel: 'REAL' | 'SYNTHETIC';
  availability(): Promise<AstrynSpeechAvailability>;
  speak(request: AstrynSpeechRequest, signal: AbortSignal): AsyncIterable<AstrynSpeechChunk>;
}

export type AstrynSpeechStopReason = 'user' | 'cancel' | 'dispose';
