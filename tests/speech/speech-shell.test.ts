import { describe, expect, it, vi } from 'vitest';
import {
  ASTRYN_PROTOCOL_VERSION,
  ASTRYN_SPEECH_CONTRACT_OWNER,
  ASTRYN_SPEECH_FORMALIZATION_GATE,
  ASTRYN_SPEECH_PROPOSAL,
  ASTRYN_SPEECH_UNCONNECTED_REASON,
  resolveMouthMode,
  unconnectedSpeechAvailability
} from '@astryn/contracts';
import type { AstrynSpeechAvailability, AstrynSpeechChunk, AstrynSpeechPort } from '@astryn/contracts';
import { createSpeechPlayback, readSpeechAvailability } from '@astryn/core';

const ALL_AVAILABLE: AstrynSpeechAvailability = {
  microphone: { available: true, reason: null, failureCode: null },
  asr: { available: true, reason: null, failureCode: null },
  tts: { available: true, reason: null, failureCode: null },
  playback: { available: true, reason: null, failureCode: null }
};

function chunk(partial: Partial<AstrynSpeechChunk> & { sequence: number }): AstrynSpeechChunk {
  return {
    sessionId: 's1',
    utteranceId: 'utt-s1-1',
    chunkId: `c-${partial.sequence}`,
    audioRef: null,
    sampleRate: null,
    startOffsetMs: 0,
    visemeEvents: null,
    subtitleSegments: [],
    locale: null,
    provenance: 'SYNTHETIC',
    endOfUtterance: false,
    ...partial
  };
}

interface ControllablePort extends AstrynSpeechPort {
  push(chunk: AstrynSpeechChunk): void;
  end(): void;
}

/** 可控块流：push 逐块到达；end 收束。availability 中麦克风保持未接通（与产品默认一致）。 */
function controllablePort(): ControllablePort {
  const queue: AstrynSpeechChunk[] = [];
  let done = false;
  let wake: (() => void) | null = null;
  return {
    protocol: ASTRYN_PROTOCOL_VERSION,
    providerId: 'test-controllable',
    evidenceLevel: 'SYNTHETIC',
    async availability(): Promise<AstrynSpeechAvailability> {
      return { ...ALL_AVAILABLE, microphone: { available: false, reason: '测试：不启用采集', failureCode: null } };
    },
    speak() {
      return {
        [Symbol.asyncIterator]() {
          return {
            next: async (): Promise<IteratorResult<AstrynSpeechChunk>> => {
              while (queue.length === 0 && !done) {
                await new Promise<void>((resolve) => {
                  wake = resolve;
                });
              }
              const nextChunk = queue.shift();
              return nextChunk ? { value: nextChunk, done: false } : { value: undefined, done: true };
            }
          };
        }
      };
    },
    push(nextChunk: AstrynSpeechChunk): void {
      queue.push(nextChunk);
      wake?.();
      wake = null;
    },
    end(): void {
      done = true;
      wake?.();
      wake = null;
    }
  };
}

describe('语音提议与口型模式（GF09）', () => {
  it('提议与任务包 speech_optional 逐字一致：12 字段 / 3 规则 / BE01 登记门槛', () => {
    expect(ASTRYN_SPEECH_PROPOSAL.state).toBe('FRONTEND_FIELDS_NOW_RUNTIME_OPTIONAL');
    expect([...ASTRYN_SPEECH_PROPOSAL.fields]).toEqual([
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
    ]);
    expect([...ASTRYN_SPEECH_PROPOSAL.rules]).toEqual([
      'audio playback clock is master',
      'cancel stops audio/subtitles/mouth',
      'no phoneme events means basic amplitude mouth only'
    ]);
    expect(ASTRYN_SPEECH_CONTRACT_OWNER).toContain('BE01');
    expect(ASTRYN_SPEECH_FORMALIZATION_GATE).toHaveLength(4);
  });

  it('口型三态：无音频→文本帧；有音频无音素→基础口型；有音素→viseme', () => {
    expect(resolveMouthMode(false, false)).toBe('text-frames');
    expect(resolveMouthMode(false, true)).toBe('text-frames');
    expect(resolveMouthMode(true, false)).toBe('basic-amplitude');
    expect(resolveMouthMode(true, true)).toBe('viseme');
  });
});

describe('语音端口缺席：未接语音明确禁用', () => {
  it('缺席读数：四项能力全部未接通，原因指名 BLOCKED_BY_HOST_CONTRACT 与 BE01', async () => {
    const reading = unconnectedSpeechAvailability();
    for (const feature of ['microphone', 'asr', 'tts', 'playback'] as const) {
      expect(reading[feature].available).toBe(false);
      expect(reading[feature].failureCode).toBe('HOST_CONTRACT_MISSING');
      expect(reading[feature].reason).toBe(ASTRYN_SPEECH_UNCONNECTED_REASON);
    }
    expect(ASTRYN_SPEECH_UNCONNECTED_REASON).toContain('BLOCKED_BY_HOST_CONTRACT');
    expect(ASTRYN_SPEECH_UNCONNECTED_REASON).toContain('BE01');
    expect(await readSpeechAvailability(null)).toEqual(reading);
  });

  it('端口缺席时 speak 拒绝：不进入朗读态，不播放任何语音', () => {
    const playback = createSpeechPlayback({ sessionId: 's1', port: null });
    const result = playback.speak('你好');
    expect(result.accepted).toBe(false);
    if (result.accepted) return;
    expect(result.reason).toBe('NO_PORT');
    expect(result.message).toContain('BE01');
    expect(playback.snapshot.status).toBe('idle');
    expect(playback.snapshot.subtitle).toBe(null);
    expect(playback.snapshot.lastNotice).toContain('不播放占位语音');
  });

  it('可用性读取异常按未接通处理并如实说明', async () => {
    const broken: AstrynSpeechPort = {
      protocol: ASTRYN_PROTOCOL_VERSION,
      providerId: 'test-broken',
      evidenceLevel: 'SYNTHETIC',
      async availability(): Promise<AstrynSpeechAvailability> {
        throw new Error('bridge down');
      },
      speak() {
        throw new Error('unused');
      }
    };
    const reading = await readSpeechAvailability(broken);
    expect(reading.tts.available).toBe(false);
    expect(reading.tts.failureCode).toBe('UNKNOWN');
    expect(reading.tts.reason).toContain('bridge down');
  });
});

describe('朗读回放外壳：块守卫、字幕投影与原子停止', () => {
  it('块守护：跨会话/旧 utterance/乱序重复不采纳；结清后块作废、投影复位', () => {
    const port = controllablePort();
    const playback = createSpeechPlayback({ sessionId: 's1', port });
    const begin = playback.speak('第一段');
    expect(begin.accepted).toBe(true);
    if (!begin.accepted) return;
    const uid = begin.utteranceId;

    expect(playback.ingest(chunk({ sequence: 0, sessionId: 's2', utteranceId: uid }))).toMatchObject({
      accepted: false,
      reason: 'FOREIGN_SESSION'
    });
    expect(playback.ingest(chunk({ sequence: 0, utteranceId: 'utt-other' }))).toMatchObject({
      accepted: false,
      reason: 'STALE_UTTERANCE'
    });
    expect(playback.ingest(chunk({ sequence: 0, utteranceId: uid, audioRef: 'a1' })).accepted).toBe(true);
    expect(playback.ingest(chunk({ sequence: 0, utteranceId: uid }))).toMatchObject({
      accepted: false,
      reason: 'OUT_OF_ORDER'
    });
    expect(playback.ingest(chunk({ sequence: -1, utteranceId: uid }))).toMatchObject({
      accepted: false,
      reason: 'OUT_OF_ORDER'
    });
    expect(playback.snapshot.lastSequence).toBe(0);

    const stopResult = playback.stop('user');
    expect(stopResult.wasSpeaking).toBe(true);
    expect(stopResult.utteranceId).toBe(uid);
    expect(playback.snapshot.status).toBe('idle');
    expect(playback.snapshot.subtitle).toBe(null);
    expect(playback.snapshot.mouthMode).toBe('text-frames');
    expect(playback.snapshot.lastNotice).toContain('已停止');
    expect(playback.ingest(chunk({ sequence: 1, utteranceId: uid }))).toMatchObject({
      accepted: false,
      reason: 'NOT_SPEAKING'
    });
    port.end();
  });

  it('字幕按音频主时钟投影；回退的时钟读数被忽略', () => {
    const port = controllablePort();
    const playback = createSpeechPlayback({ sessionId: 's1', port });
    const begin = playback.speak('你好世界');
    if (!begin.accepted) throw new Error('expected accepted');
    const uid = begin.utteranceId;
    playback.ingest(
      chunk({
        sequence: 0,
        utteranceId: uid,
        audioRef: 'a1',
        subtitleSegments: [
          { startMs: 0, endMs: 1000, text: '你好' },
          { startMs: 1000, endMs: 2000, text: '世界' }
        ]
      })
    );
    expect(playback.snapshot.mouthMode).toBe('basic-amplitude');
    playback.tick(500);
    expect(playback.snapshot.subtitle).toBe('你好');
    playback.tick(1500);
    expect(playback.snapshot.subtitle).toBe('世界');
    playback.tick(1000);
    expect(playback.snapshot.clockMs).toBe(1500);
    expect(playback.snapshot.subtitle).toBe('世界');
    playback.tick(2500);
    expect(playback.snapshot.subtitle).toBe(null);
    port.end();
  });

  it('有音素时间戳→viseme；end_of_utterance 收束并保留末条字幕', () => {
    const port = controllablePort();
    const playback = createSpeechPlayback({ sessionId: 's1', port });
    const begin = playback.speak('带口型的一段');
    if (!begin.accepted) throw new Error('expected accepted');
    const uid = begin.utteranceId;
    playback.ingest(
      chunk({
        sequence: 0,
        utteranceId: uid,
        audioRef: 'a1',
        visemeEvents: [{ atMs: 100, viseme: 'A' }],
        subtitleSegments: [{ startMs: 0, endMs: 800, text: '带口型' }]
      })
    );
    expect(playback.snapshot.mouthMode).toBe('viseme');
    playback.tick(400);
    expect(playback.snapshot.subtitle).toBe('带口型');
    playback.ingest(chunk({ sequence: 1, utteranceId: uid, audioRef: 'a1', endOfUtterance: true }));
    expect(playback.snapshot.status).toBe('finished');
    expect(playback.snapshot.subtitle).toBe('带口型');
    expect(playback.snapshot.mouthMode).toBe('text-frames');
    expect(playback.ingest(chunk({ sequence: 2, utteranceId: uid }))).toMatchObject({
      accepted: false,
      reason: 'NOT_SPEAKING'
    });
    port.end();
  });

  it('停止中止块流：迟到块不改变投影', async () => {
    const port = controllablePort();
    const playback = createSpeechPlayback({ sessionId: 's1', port });
    const begin = playback.speak('中止测试');
    if (!begin.accepted) throw new Error('expected accepted');
    const uid = begin.utteranceId;
    port.push(chunk({ sequence: 0, utteranceId: uid, subtitleSegments: [{ startMs: 0, endMs: 500, text: '早' }] }));
    await vi.waitFor(() => expect(playback.snapshot.lastSequence).toBe(0));
    playback.stop('cancel');
    port.push(
      chunk({ sequence: 1, utteranceId: uid, subtitleSegments: [{ startMs: 500, endMs: 900, text: '迟到' }] })
    );
    port.end();
    await playback.whenSettled();
    expect(playback.snapshot.status).toBe('idle');
    expect(playback.snapshot.subtitle).toBe(null);
    expect(playback.snapshot.lastSequence).toBe(null);
    expect(playback.snapshot.lastNotice).toContain('已停止');
  });

  it('整段消费：块按序入账，末块结束收束', async () => {
    const port = controllablePort();
    const playback = createSpeechPlayback({ sessionId: 's1', port });
    const begin = playback.speak('整段');
    if (!begin.accepted) throw new Error('expected accepted');
    const uid = begin.utteranceId;
    port.push(
      chunk({ sequence: 0, utteranceId: uid, audioRef: 'a1', subtitleSegments: [{ startMs: 0, endMs: 300, text: '整' }] })
    );
    port.push(
      chunk({ sequence: 1, utteranceId: uid, audioRef: 'a1', subtitleSegments: [{ startMs: 300, endMs: 600, text: '段' }] })
    );
    port.push(chunk({ sequence: 2, utteranceId: uid, audioRef: 'a1', endOfUtterance: true }));
    port.end();
    await playback.whenSettled();
    expect(playback.snapshot.status).toBe('finished');
    expect(playback.snapshot.lastSequence).toBe(2);
    expect(playback.snapshot.provenance).toBe('SYNTHETIC');
    expect(playback.snapshot.hasAudio).toBe(true);
    expect(playback.snapshot.subtitle).toBe('段');
    playback.tick(400);
    expect(playback.snapshot.subtitle).toBe('段');
  });

  it('订阅者每次状态变化都收到通知', () => {
    const port = controllablePort();
    const playback = createSpeechPlayback({ sessionId: 's1', port });
    const seen: string[] = [];
    const unsubscribe = playback.subscribe(() => seen.push(playback.snapshot.status));
    const begin = playback.speak('a');
    if (!begin.accepted) throw new Error('expected accepted');
    playback.stop('user');
    unsubscribe();
    expect(seen[0]).toBe('speaking');
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(seen.at(-1)).toBe('idle');
    expect(playback.speak('   ').accepted).toBe(false);
    port.end();
  });
});
