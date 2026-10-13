import type { AstrynVisibleState } from '@astryn/contracts';

/**
 * 状态-动作映射（GF03 交付）。与任务包 design/STATE-ACTION-MATRIX.json 对齐：
 * - 体态取简报 §8.2 的最近基线；状态差异主要由表情与状态环承载，不为每态新造体态。
 * - 表情/口型只有唯一驱动：真实文本事件的离散帧号（expressionDriver）。
 *   中文音素口型未实现，也不得对外宣称（audioDriver 恒为 null 即该红线的运行时注记）。
 * - 所有权恒等：同一时刻只允许 1 路音频与 1 个昂贵渲染器。
 */
export const ASTRYN_BODY_PRESETS = ['idle', 'listening', 'thinking', 'nod', 'point', 'speaking'] as const;
export type AstrynBodyPreset = (typeof ASTRYN_BODY_PRESETS)[number];

/** 预留体态：已定稿但尚无状态触发路径；有声明才允许闲置，防止枚举静默死亡。 */
export const RESERVED_BODY_PRESETS: Readonly<Partial<Record<AstrynBodyPreset, string>>> = {
  point: '“解释选中内容”的指向手势，待交互层按上下文接线（GF05/GF07）'
};

export interface AstrynStateActionSpec {
  readonly state: AstrynVisibleState;
  readonly bodyPreset: AstrynBodyPreset;
  readonly expressionDriver: 'text-event-frame';
  readonly audioDriver: null;
  readonly owners: {
    readonly activeAudio: 1;
    readonly expensiveRenderer: 1;
  };
}

function spec(state: AstrynVisibleState, bodyPreset: AstrynBodyPreset): AstrynStateActionSpec {
  return {
    state,
    bodyPreset,
    expressionDriver: 'text-event-frame',
    audioDriver: null,
    owners: { activeAudio: 1, expensiveRenderer: 1 }
  };
}

export const STATE_ACTIONS: Readonly<Record<AstrynVisibleState, AstrynStateActionSpec>> = {
  idle: spec('idle', 'idle'),
  listening: spec('listening', 'listening'),
  thinking: spec('thinking', 'thinking'),
  speaking: spec('speaking', 'speaking'),
  interrupted: spec('interrupted', 'idle'),
  awaiting_approval: spec('awaiting_approval', 'idle'),
  executing: spec('executing', 'idle'),
  completed: spec('completed', 'nod'),
  failed: spec('failed', 'idle')
};

export function bodyPresetFor(state: AstrynVisibleState): AstrynBodyPreset {
  return STATE_ACTIONS[state].bodyPreset;
}

/** 当前没有状态触达的体态；必须为空，或每一项都已在 RESERVED_BODY_PRESETS 中声明理由。 */
export function unreachedBodyPresets(): readonly AstrynBodyPreset[] {
  const used = new Set(Object.values(STATE_ACTIONS).map((action) => action.bodyPreset));
  return ASTRYN_BODY_PRESETS.filter((preset) => !used.has(preset));
}
