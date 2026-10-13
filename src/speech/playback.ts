import { resolveMouthMode, unconnectedSpeechAvailability } from '@astryn/contracts';
import type {
  AstrynMouthMode,
  AstrynSpeechAvailability,
  AstrynSpeechChunk,
  AstrynSpeechFeatureAvailability,
  AstrynSpeechPort,
  AstrynSpeechStopReason,
  AstrynSpeechSubtitleSegment
} from '@astryn/contracts';

/**
 * 朗读回放外壳（GF09）：音频主时钟驱动的字幕与口型模式投影。
 *
 * - 规则一：音频回放时钟是主时钟——字幕按 segments 与时钟的交叠投影，
 *   `tick()` 接收宿主音频引擎的时钟读数，回退的时钟读数静默忽略。
 * - 规则二：停止原子复位音频订阅、字幕与嘴形；结清后到达的块一律作废。
 * - 规则三：没有音素时间戳只允许基础口型（resolveMouthMode 判定）。
 *
 * 本外壳不驱动渲染器的嘴型：mouthMode 是给未来口型驱动器的模式状态；
 * M0 呈现层仍是文本帧口型。端口缺席时 speak 直接拒绝，不播放任何占位语音。
 */
export interface SpeechPlaybackSnapshot {
  readonly status: 'idle' | 'speaking' | 'finished';
  readonly utteranceId: string | null;
  readonly clockMs: number;
  /** 当前时钟命中的字幕（多段重叠按序拼接）；声画间隙为 null，结束后保留末条。 */
  readonly subtitle: string | null;
  readonly mouthMode: AstrynMouthMode;
  readonly hasAudio: boolean;
  readonly hasVisemeEvents: boolean;
  readonly provenance: 'REAL' | 'SYNTHETIC' | null;
  readonly lastSequence: number | null;
  /** 最近一次拒收/复位说明（迟到、乱序、重复、跨会话、端口缺席），供如实呈报。 */
  readonly lastNotice: string | null;
}

export type SpeechSpeakResult =
  | { readonly accepted: true; readonly utteranceId: string }
  | {
      readonly accepted: false;
      readonly reason: 'NO_PORT' | 'BUSY' | 'EMPTY_TEXT';
      readonly message: string;
    };

export type SpeechIngestResult =
  | { readonly accepted: true }
  | {
      readonly accepted: false;
      readonly reason: 'NOT_SPEAKING' | 'FOREIGN_SESSION' | 'STALE_UTTERANCE' | 'OUT_OF_ORDER';
      readonly message: string;
    };

export interface SpeechStopResult {
  readonly wasSpeaking: boolean;
  readonly utteranceId: string | null;
}

export interface SpeechPlaybackController {
  readonly snapshot: SpeechPlaybackSnapshot;
  subscribe(listener: () => void): () => void;
  /** 开始朗读：端口缺席即拒绝；端口在场时消费块流。 */
  speak(text: string): SpeechSpeakResult;
  ingest(chunk: AstrynSpeechChunk): SpeechIngestResult;
  /** 音频主时钟推进（正式实现由宿主音频引擎回调）；单调，回退读数忽略。 */
  tick(clockMs: number): void;
  /** 停止：原子复位音频订阅/字幕/嘴形；幂等。 */
  stop(reason: AstrynSpeechStopReason): SpeechStopResult;
  /** 当前块流已结束（或从未开始）；供宿主与测试等待。 */
  whenSettled(): Promise<void>;
}

const IDLE_SNAPSHOT: SpeechPlaybackSnapshot = {
  status: 'idle',
  utteranceId: null,
  clockMs: 0,
  subtitle: null,
  mouthMode: 'text-frames',
  hasAudio: false,
  hasVisemeEvents: false,
  provenance: null,
  lastSequence: null,
  lastNotice: null
};

function projectSubtitle(segments: readonly AstrynSpeechSubtitleSegment[], clockMs: number): string | null {
  const active = segments.filter((segment) => clockMs >= segment.startMs && clockMs < segment.endMs);
  return active.length > 0 ? active.map((segment) => segment.text).join('') : null;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 语音可用性读数：端口缺席即四项未接通；读取失败按未接通处理并如实说明。 */
export async function readSpeechAvailability(port: AstrynSpeechPort | null): Promise<AstrynSpeechAvailability> {
  if (port === null) return unconnectedSpeechAvailability();
  try {
    return await port.availability();
  } catch (error) {
    const entry: AstrynSpeechFeatureAvailability = {
      available: false,
      reason: `语音可用性读取失败（按未接通处理）：${describeError(error)}`,
      failureCode: 'UNKNOWN'
    };
    return { microphone: entry, asr: entry, tts: entry, playback: entry };
  }
}

/** 消费块流：逐块 ingest；端口异常如实上抛，停止导致的中断不算故障。 */
export async function consumeSpeechChunks(
  controller: SpeechPlaybackController,
  chunks: AsyncIterable<AstrynSpeechChunk>,
  signal?: AbortSignal
): Promise<{ readonly ingested: number; readonly refused: number; readonly aborted: boolean }> {
  let ingested = 0;
  let refused = 0;
  let aborted = false;
  try {
    for await (const chunk of chunks) {
      if (signal?.aborted) {
        aborted = true;
        break;
      }
      if (controller.ingest(chunk).accepted) ingested += 1;
      else refused += 1;
    }
  } catch (error) {
    if (!signal?.aborted) throw error;
    aborted = true;
  }
  return { ingested, refused, aborted };
}

export function createSpeechPlayback(options: {
  readonly sessionId: string;
  readonly port: AstrynSpeechPort | null;
}): SpeechPlaybackController {
  let snapshot: SpeechPlaybackSnapshot = IDLE_SNAPSHOT;
  const listeners = new Set<() => void>();
  let utteranceCounter = 0;
  let segments: readonly AstrynSpeechSubtitleSegment[] = [];
  let activeUtterance: string | null = null;
  let activeAbort: AbortController | null = null;
  let settled: Promise<void> = Promise.resolve();

  const set = (partial: Partial<SpeechPlaybackSnapshot>): void => {
    snapshot = { ...snapshot, ...partial };
    for (const listener of listeners) listener();
  };

  const finishUtterance = (utteranceId: string): void => {
    if (activeUtterance !== utteranceId || snapshot.status !== 'speaking') return;
    activeUtterance = null;
    const lastSegment = segments.at(-1);
    // 结束时保留末条字幕（字幕持久），嘴形交还给文本帧；音频已停，不再自称口型。
    set({
      status: 'finished',
      subtitle: lastSegment ? lastSegment.text : snapshot.subtitle,
      mouthMode: 'text-frames'
    });
  };

  const controller: SpeechPlaybackController = {
    get snapshot(): SpeechPlaybackSnapshot {
      return snapshot;
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    speak(text: string): SpeechSpeakResult {
      if (text.trim().length === 0) {
        return { accepted: false, reason: 'EMPTY_TEXT', message: '朗读文本为空：未开始。' };
      }
      if (snapshot.status === 'speaking') {
        return { accepted: false, reason: 'BUSY', message: `正在朗读 ${snapshot.utteranceId ?? ''}：先停止再开始新的一段。` };
      }
      const port = options.port;
      if (port === null) {
        const message = `语音端口未接通：${unconnectedSpeechAvailability().tts.reason ?? '未知原因'} 未开始朗读，也不播放占位语音。`;
        set({ lastNotice: message });
        return { accepted: false, reason: 'NO_PORT', message };
      }
      utteranceCounter += 1;
      const utteranceId = `utt-${options.sessionId}-${utteranceCounter}`;
      segments = [];
      activeUtterance = utteranceId;
      activeAbort = new AbortController();
      set({
        status: 'speaking',
        utteranceId,
        clockMs: 0,
        subtitle: null,
        mouthMode: 'text-frames',
        hasAudio: false,
        hasVisemeEvents: false,
        provenance: null,
        lastSequence: null,
        lastNotice: null
      });
      const signal = activeAbort.signal;
      const stream = port.speak(
        { protocol: port.protocol, sessionId: options.sessionId, utteranceId, text, locale: null },
        signal
      );
      settled = consumeSpeechChunks(controller, stream, signal)
        .then((result) => {
          // 流结束而未见 end_of_utterance：如实收束，不假装仍在说话。
          finishUtterance(utteranceId);
          if (result.refused > 0) {
            set({ lastNotice: `${result.refused} 个块被拒收（迟到/乱序/重复/跨会话），未改变投影。` });
          }
        })
        .catch((error: unknown) => {
          if (activeUtterance === utteranceId && snapshot.status === 'speaking') {
            activeUtterance = null;
            set({ status: 'idle', mouthMode: 'text-frames', lastNotice: `块流中断：${describeError(error)}` });
          }
        });
      return { accepted: true, utteranceId };
    },

    ingest(chunk: AstrynSpeechChunk): SpeechIngestResult {
      if (snapshot.status !== 'speaking' || activeUtterance === null) {
        const message = `块被作废：请求已结清（${snapshot.status}），结清后到达的块一律不采纳。`;
        set({ lastNotice: message });
        return { accepted: false, reason: 'NOT_SPEAKING', message };
      }
      if (chunk.sessionId !== options.sessionId) {
        const message = `块被拒收：会话不匹配（${chunk.sessionId} ≠ ${options.sessionId}）。`;
        set({ lastNotice: message });
        return { accepted: false, reason: 'FOREIGN_SESSION', message };
      }
      if (chunk.utteranceId !== activeUtterance) {
        const message = `块被作废：来自旧 utterance（${chunk.utteranceId}），当前为 ${activeUtterance}。`;
        set({ lastNotice: message });
        return { accepted: false, reason: 'STALE_UTTERANCE', message };
      }
      if (snapshot.lastSequence !== null && chunk.sequence <= snapshot.lastSequence) {
        const message = `块被丢弃：序号 ${chunk.sequence} 未严格递增（上一块 ${snapshot.lastSequence}），乱序/重复不采纳。`;
        set({ lastNotice: message });
        return { accepted: false, reason: 'OUT_OF_ORDER', message };
      }
      segments = [...segments, ...chunk.subtitleSegments];
      const hasAudio = snapshot.hasAudio || chunk.audioRef !== null;
      const hasVisemeEvents =
        snapshot.hasVisemeEvents || (chunk.visemeEvents !== null && chunk.visemeEvents.length > 0);
      set({
        lastSequence: chunk.sequence,
        hasAudio,
        hasVisemeEvents,
        provenance: chunk.provenance,
        mouthMode: resolveMouthMode(hasAudio, hasVisemeEvents),
        subtitle: projectSubtitle(segments, snapshot.clockMs)
      });
      if (chunk.endOfUtterance) finishUtterance(chunk.utteranceId);
      return { accepted: true };
    },

    tick(clockMs: number): void {
      if (clockMs < snapshot.clockMs) return;
      const subtitle = snapshot.status === 'speaking' ? projectSubtitle(segments, clockMs) : snapshot.subtitle;
      set({ clockMs, subtitle });
    },

    stop(reason: AstrynSpeechStopReason): SpeechStopResult {
      const wasSpeaking = snapshot.status === 'speaking';
      const utteranceId = snapshot.utteranceId;
      activeAbort?.abort();
      activeAbort = null;
      activeUtterance = null;
      segments = [];
      set({
        ...IDLE_SNAPSHOT,
        clockMs: snapshot.clockMs,
        lastNotice: wasSpeaking
          ? `已停止朗读（${reason}）：音频订阅、字幕与嘴形已同步复位。`
          : snapshot.lastNotice
      });
      return { wasSpeaking, utteranceId };
    },

    whenSettled(): Promise<void> {
      return settled;
    }
  };

  return controller;
}
