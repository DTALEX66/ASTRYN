import type { AstrynVisibleState } from '@astryn/contracts';

export interface XiaoqiVisualTokens {
  readonly ringColor: string;
  readonly eyeMode: 'open' | 'soft' | 'looking-up' | 'wide' | 'closed-glitch' | 'happy';
  readonly mouthMode: 'line' | 'smile' | 'open-cycle' | 'tight' | 'flat';
  readonly auraOpacity: number;
  readonly glyph: string;
  readonly motionAllowed: boolean;
}

/**
 * 状态 → 视觉特征的唯一映射表。
 * 任何新增可见状态都必须在这里落地，否则渲染层不允许出现"看不出来的状态"。
 */
export const STATE_VISUALS: Readonly<Record<AstrynVisibleState, XiaoqiVisualTokens>> = {
  idle: { ringColor: '#5ad1c8', eyeMode: 'open', mouthMode: 'smile', auraOpacity: 0.28, glyph: '', motionAllowed: true },
  listening: { ringColor: '#7aa2ff', eyeMode: 'wide', mouthMode: 'line', auraOpacity: 0.46, glyph: '', motionAllowed: true },
  thinking: { ringColor: '#c08bff', eyeMode: 'looking-up', mouthMode: 'tight', auraOpacity: 0.5, glyph: '', motionAllowed: true },
  speaking: { ringColor: '#ffb454', eyeMode: 'open', mouthMode: 'open-cycle', auraOpacity: 0.6, glyph: '', motionAllowed: true },
  interrupted: { ringColor: '#f2647c', eyeMode: 'closed-glitch', mouthMode: 'flat', auraOpacity: 0.4, glyph: '!', motionAllowed: false },
  awaiting_approval: { ringColor: '#ffd166', eyeMode: 'soft', mouthMode: 'tight', auraOpacity: 0.55, glyph: '?', motionAllowed: false },
  executing: { ringColor: '#4fd1ff', eyeMode: 'soft', mouthMode: 'line', auraOpacity: 0.7, glyph: '>', motionAllowed: true },
  completed: { ringColor: '#63e6a6', eyeMode: 'happy', mouthMode: 'smile', auraOpacity: 0.66, glyph: '✓', motionAllowed: false },
  failed: { ringColor: '#ff5d5d', eyeMode: 'closed-glitch', mouthMode: 'flat', auraOpacity: 0.5, glyph: '×', motionAllowed: false }
};

export const MOUTH_CYCLE: readonly string[] = ['M 52 78 Q 60 86 68 78', 'M 54 78 Q 60 82 66 78', 'M 53 77 Q 60 90 67 77', 'M 56 78 Q 60 80 64 78'];
const FALLBACK_MOUTH = 'M 54 79 L 66 79';

export function mouthPathFor(frame: number, tokens: XiaoqiVisualTokens): string {
  switch (tokens.mouthMode) {
    case 'open-cycle':
      return MOUTH_CYCLE[frame % MOUTH_CYCLE.length] ?? FALLBACK_MOUTH;
    case 'smile':
      return 'M 53 77 Q 60 84 67 77';
    case 'line':
      return 'M 54 79 L 66 79';
    case 'tight':
      return 'M 55 79 Q 60 77 65 79';
    case 'flat':
      return 'M 54 81 Q 60 77 66 81';
    default:
      return FALLBACK_MOUTH;
  }
}

export function eyesFor(tokens: XiaoqiVisualTokens): { readonly lidY: number; readonly lidHeight: number; readonly pupilDx: number; readonly pupilDy: number } {
  switch (tokens.eyeMode) {
    case 'wide':
      return { lidY: 54, lidHeight: 2, pupilDx: 0, pupilDy: 0 };
    case 'looking-up':
      return { lidY: 60, lidHeight: 7, pupilDx: 0, pupilDy: -3 };
    case 'soft':
      return { lidY: 61, lidHeight: 6, pupilDx: 0, pupilDy: 1 };
    case 'closed-glitch':
      return { lidY: 63, lidHeight: 5, pupilDx: -1, pupilDy: 0 };
    case 'happy':
      return { lidY: 62, lidHeight: 4, pupilDx: 0, pupilDy: -1 };
    case 'open':
    default:
      return { lidY: 58, lidHeight: 9, pupilDx: 0, pupilDy: 0 };
  }
}
