import { describe, expect, it } from 'vitest';
import type { AstrynAvatarFrame, AstrynVisibleState } from '@astryn/contracts';
import type { AstrynBodyPreset } from '@astryn/core';
import {
  ASTRYN_BODY_PRESETS,
  RESERVED_BODY_PRESETS,
  STATE_ACTIONS,
  STATE_VISUALS,
  bodyPresetFor,
  describeXiaoqiFrame,
  renderXiaoqiMarkup,
  unreachedBodyPresets
} from '@astryn/core';

const frame = (visibleState: AstrynVisibleState, expressionFrame = 0): AstrynAvatarFrame => ({
  characterId: 'xiaoqi',
  sessionId: 's1',
  visibleState,
  expressionFrame,
  streamedText: '',
  taskStep: null,
  failureMessage: null,
  reducedMotion: false
});

const allStates = Object.keys(STATE_VISUALS) as AstrynVisibleState[];

describe('GF03 状态-动作映射（design/STATE-ACTION-MATRIX.json 的运行时落地）', () => {
  it('九态全量覆盖，与视觉令牌表一一对应', () => {
    expect(Object.keys(STATE_ACTIONS).sort()).toEqual([...allStates].sort());
    expect(allStates).toHaveLength(9);
  });

  it('每态映射到合法体态，且所有权恒为 1 路音频 / 1 个昂贵渲染器', () => {
    for (const state of allStates) {
      const action = STATE_ACTIONS[state];
      expect(ASTRYN_BODY_PRESETS, state).toContain(action.bodyPreset);
      expect(action.state, state).toBe(state);
      expect(action.owners.activeAudio, state).toBe(1);
      expect(action.owners.expensiveRenderer, state).toBe(1);
    }
  });

  it('表情/口型只由真实文本事件帧驱动；音频驱动为空且不得出现音素口型宣称', () => {
    for (const state of allStates) {
      expect(STATE_ACTIONS[state].expressionDriver, state).toBe('text-event-frame');
      expect(STATE_ACTIONS[state].audioDriver, state).toBeNull();
    }
    expect(JSON.stringify(STATE_ACTIONS)).not.toMatch(/viseme|音素/i);
  });

  it('未触达体态必须显式声明预留理由，不静默闲置', () => {
    const unreached = unreachedBodyPresets();
    expect(unreached).toEqual(['point']);
    for (const preset of unreached) {
      expect(RESERVED_BODY_PRESETS[preset], `${preset} 缺预留声明`).toBeTruthy();
    }
    // 预留项不得与已达项重叠。
    const reached = new Set(Object.values(STATE_ACTIONS).map((action) => action.bodyPreset));
    for (const preset of Object.keys(RESERVED_BODY_PRESETS)) {
      expect(reached.has(preset as AstrynBodyPreset), `${preset} 已触达就不该仍标记预留`).toBe(false);
    }
  });

  it('描述函数与映射表一致（调用点集成，不是只看常量）', () => {
    for (const state of allStates) {
      const described = describeXiaoqiFrame(frame(state));
      expect(described.bodyPreset, state).toBe(bodyPresetFor(state));
      expect(described.expressionDriver, state).toBe('text-event-frame');
    }
  });

  it('帧号是唯一表情输入：同帧输出逐字一致，异帧输出相异（离散帧交换）', () => {
    const at0 = renderXiaoqiMarkup(frame('speaking', 0));
    const at0Again = renderXiaoqiMarkup(frame('speaking', 0));
    const frames = [0, 1, 2, 3].map((n) => renderXiaoqiMarkup(frame('speaking', n)));
    expect(at0Again).toBe(at0);
    expect(new Set(frames).size).toBe(4);
  });
});
