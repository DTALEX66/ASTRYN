import { ASTRYN_CONVERSATION_STATES, ASTRYN_TASK_STATES } from '@astryn/contracts';
import type { AstrynAvatarFrame, AstrynAvatarRenderer, AstrynVisibleState } from '@astryn/contracts';
import { STATE_VISUALS } from './state-visuals';
import { XiaoqiAvatar, describeXiaoqiFrame } from './xiaoqi-avatar';

const SUPPORTED: readonly AstrynVisibleState[] = [
  ...ASTRYN_CONVERSATION_STATES,
  ...ASTRYN_TASK_STATES.filter((state) => state !== 'none')
];

/**
 * M0 唯一渲染驱动：原创 SVG。保留 renderer seam，未来 Live2D / VRM / 3D
 * 只需替换本实现，状态机与角色 UI 不变。
 *
 * 不变量：写入 DOM 的 SVG 只由内部常量与数值拼装，任何外部文本
 * （模型正文、宿主摘要、文件名）都不得进入该字符串，因此不存在注入面。
 */
export const xiaoqiSvgRenderer: AstrynAvatarRenderer = {
  rendererId: 'xiaoqi-svg-v1',
  displayName: '小栖 · 原创 SVG',
  provenance: {
    origin: 'original',
    license: '原创（本项目撰写），未使用任何第三方角色模型、贴图或素材',
    note: '形状与配色由 src/avatar/* 手写；assets/original/README 记录来源声明。'
  },
  budget: { compositedOnly: true, respectReducedMotion: true, maxAmbientAnimations: 2 },
  supportedStates: SUPPORTED,
  supports: (state) => state in STATE_VISUALS,
  renderMarkup: (frame, size = 200) => XiaoqiAvatar({ frame, size }),
  createFrame: (): AstrynAvatarFrame => ({
    characterId: 'xiaoqi',
    sessionId: '',
    visibleState: 'idle',
    expressionFrame: 0,
    streamedText: '',
    taskStep: null,
    failureMessage: null,
    reducedMotion: false
  }),
  describe: (frame) => describeXiaoqiFrame(frame)
};

export function renderXiaoqiMarkup(frame: AstrynAvatarFrame, size = 200): string {
  return XiaoqiAvatar({ frame, size });
}

/** 已实现的渲染驱动。P2 的 Live2D / VRM / 3D 驱动在这里注册，而不是在 UI 里加分支。 */
export const AVATAR_RENDERERS: readonly AstrynAvatarRenderer[] = [xiaoqiSvgRenderer];

export function selectAvatarRenderer(rendererId: string): AstrynAvatarRenderer {
  const found = AVATAR_RENDERERS.find((renderer) => renderer.rendererId === rendererId);
  if (found) return found;
  const fallback = AVATAR_RENDERERS[0];
  if (!fallback) throw new Error('没有已注册的渲染驱动');
  return fallback;
}
