import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ASTRYN_PROTOCOL_VERSION, XIAOQI_PROFILE } from '@astryn/contracts';
import type { AstrynSpeechAvailability, AstrynSpeechChunk, AstrynSpeechPort } from '@astryn/contracts';
import { CompanionShell, SyntheticConversationPort, createEphemeralProfileStore } from '@astryn/core';

interface ControllablePort extends AstrynSpeechPort {
  push(chunk: AstrynSpeechChunk): void;
  end(): void;
}

function controllablePort(): ControllablePort {
  const queue: AstrynSpeechChunk[] = [];
  let done = false;
  let wake: (() => void) | null = null;
  const available: AstrynSpeechAvailability = {
    microphone: { available: false, reason: '测试端口：不启用采集', failureCode: null },
    asr: { available: true, reason: null, failureCode: null },
    tts: { available: true, reason: null, failureCode: null },
    playback: { available: true, reason: null, failureCode: null }
  };
  return {
    protocol: ASTRYN_PROTOCOL_VERSION,
    providerId: 'test-ui-controllable',
    evidenceLevel: 'SYNTHETIC',
    async availability(): Promise<AstrynSpeechAvailability> {
      return available;
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

function renderShell(speech: AstrynSpeechPort | null): ReturnType<typeof render> {
  return render(
    <CompanionShell
      mode="panel"
      sessionId="s1"
      profile={XIAOQI_PROFILE}
      conversation={new SyntheticConversationPort({ steps: [{ text: '我在呢' }, { finish: 'stop' }] })}
      profileStore={createEphemeralProfileStore()}
      speech={speech}
    />
  );
}

function openSettings(): void {
  fireEvent.click(screen.getByTestId('astryn-settings-toggle'));
}

describe('声音设置（GF09）：未接语音明确禁用，不播放假语音', () => {
  it('四项能力读数未接并给出原因；运行按钮禁用；界面不出现音频元素', () => {
    renderShell(null);
    openSettings();

    for (const feature of ['microphone', 'asr', 'tts', 'playback']) {
      const chip = screen.getByTestId(`astryn-speech-avail-${feature}`);
      expect(chip.textContent).toContain('未接');
      expect(chip.getAttribute('data-available')).toBe('false');
    }
    const note = screen.getByTestId('astryn-voice-note').textContent ?? '';
    expect(note).toContain('BLOCKED_BY_HOST_CONTRACT');
    expect(note).toContain('BE01');

    const sample = screen.getByTestId('astryn-voice-sample') as HTMLButtonElement;
    expect(sample.disabled).toBe(true);
    expect(sample.getAttribute('title') ?? '').toContain('BLOCKED_BY_HOST_CONTRACT');
    expect((screen.getByTestId('astryn-voice-stop') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('astryn-voice-mic-hold') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('astryn-voice-style') as HTMLSelectElement).disabled).toBe(true);
    expect(screen.getByTestId('astryn-voice-mouth-mode').textContent).toContain('文本帧');
    expect(document.querySelector('audio')).toBe(null);
  });

  it('偏好可编辑并标注接通后生效；开启朗读偏好出现未接通提示', () => {
    renderShell(null);
    openSettings();

    const subtitles = screen.getByTestId('astryn-voice-subtitles') as HTMLInputElement;
    expect(subtitles.checked).toBe(true);
    fireEvent.click(subtitles);
    expect(subtitles.checked).toBe(false);

    const microphone = screen.getByTestId('astryn-voice-microphone') as HTMLInputElement;
    expect(microphone.checked).toBe(false);
    fireEvent.click(microphone);
    expect(microphone.checked).toBe(true);

    const enabled = screen.getByTestId('astryn-voice-enabled') as HTMLInputElement;
    expect(enabled.checked).toBe(false);
    expect(screen.queryByTestId('astryn-voice-preference-note')).toBe(null);
    fireEvent.click(enabled);
    expect(enabled.checked).toBe(true);
    expect(screen.getByTestId('astryn-voice-preference-note').textContent).toContain('不播放任何语音');

    const volume = screen.getByTestId('astryn-voice-volume') as HTMLInputElement;
    fireEvent.change(volume, { target: { value: '0.5' } });
    expect(volume.closest('label')?.textContent ?? '').toContain('音量 50%');
  });

  it('接通（合成脚本）时：读数可用、试听驱动字幕、停止同步清空', async () => {
    const port = controllablePort();
    renderShell(port);
    openSettings();

    await vi.waitFor(() => {
      expect(screen.getByTestId('astryn-speech-avail-tts').getAttribute('data-available')).toBe('true');
    });
    expect(screen.getByTestId('astryn-speech-avail-microphone').getAttribute('data-available')).toBe('false');

    const sample = screen.getByTestId('astryn-voice-sample') as HTMLButtonElement;
    expect(sample.disabled).toBe(false);
    fireEvent.click(sample);

    port.push({
      sessionId: 's1',
      utteranceId: 'utt-s1-1',
      chunkId: 'c-0',
      sequence: 0,
      audioRef: 'a1',
      sampleRate: 24000,
      startOffsetMs: 0,
      visemeEvents: null,
      subtitleSegments: [{ startMs: 0, endMs: 1000, text: '你好，我是小栖。' }],
      locale: 'zh-CN',
      provenance: 'SYNTHETIC',
      endOfUtterance: false
    });

    await vi.waitFor(() => {
      expect(screen.getByTestId('astryn-voice-subtitle').textContent).toContain('你好，我是小栖。');
    });
    expect(screen.getByTestId('astryn-voice-runtime').textContent).toContain('朗读中');
    expect(screen.getByTestId('astryn-voice-mouth-mode').textContent).toContain('基础口型');

    const stop = screen.getByTestId('astryn-voice-stop') as HTMLButtonElement;
    expect(stop.disabled).toBe(false);
    fireEvent.click(stop);
    expect(screen.queryByTestId('astryn-voice-subtitle')).toBe(null);
    expect(screen.getByTestId('astryn-voice-runtime').textContent).toContain('空闲');
    expect(screen.getByTestId('astryn-voice-mouth-mode').textContent).toContain('文本帧');
    port.end();
  });
});
