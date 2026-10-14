import { STATE_VISUALS, eyesFor, mouthPathFor } from './state-visuals';
import { bodyPresetFor } from './state-action-matrix';
import type { AstrynAvatarFrame, AstrynAvatarViewProfile } from '@astryn/contracts';

export interface XiaoqiAvatarProps {
  readonly frame: AstrynAvatarFrame;
  readonly size?: number | undefined;
  /** 呈现档（首页/头像/侧边）。缺省为整幅半身，与原行为一致。 */
  readonly view?: AstrynAvatarViewProfile | undefined;
}

/**
 * 原创角色"小栖"初始视觉。2D/SVG 自研，无第三方模型或素材。
 *
 * 层次从后到前：状态环 → 光晕 → 肩部 → 后发 → 颈 → 脸 → 五官 → 前发与发夹。
 * 视觉差异只来自 frame.visibleState 与 frame.expressionFrame，
 * 后者只由真实 stream.delta 递增，因此口型不可能自行播放。
 *
 * 注入不变量：本函数写入 DOM 的字符串只由内部常量与数值拼装，
 * 任何外部文本（模型正文、宿主摘要、文件名）都不得进入这里。
 */
export function XiaoqiAvatar({ frame, size, view }: XiaoqiAvatarProps): string {
  // 未登记的可见状态直接抛错：不把 undefined 令牌拼进 SVG（回退由上层 AvatarView 负责）。
  if (!(frame.visibleState in STATE_VISUALS)) {
    throw new Error(`未登记的可见状态：${String(frame.visibleState)}`);
  }
  const tokens = STATE_VISUALS[frame.visibleState];
  const eyes = eyesFor(tokens);
  const motion = tokens.motionAllowed && !frame.reducedMotion;
  const mouth = mouthPathFor(frame.expressionFrame, tokens);
  const color = tokens.ringColor;
  const [vx = 0, vy = 0, vw = 120, vh = 140] = view?.viewBox ?? [];
  const width = size ?? view?.width ?? 200;
  const height = view ? Math.round(width * (vh / vw) * 100) / 100 : width * 1.1667;

  // 状态环紧贴头部轮廓，并配一条完整底轨：
  // 没有底轨时，单段虚线弧会被读成"悬在头顶的独立铁圈"而不是环绕角色的状态光环。
  const ringDash =
    frame.visibleState === 'executing' ? '34 210'
    : frame.visibleState === 'completed' ? '244 0'
    : frame.visibleState === 'failed' || frame.visibleState === 'interrupted' ? '14 230'
    : '78 166';

  return `
<svg data-testid="astryn-avatar" data-visible-state="${frame.visibleState}" data-expression-frame="${frame.expressionFrame}"
     data-motion="${motion ? 'on' : 'off'}" role="img" aria-label="小栖当前状态：${frame.visibleState}"
     viewBox="${vx} ${vy} ${vw} ${vh}" width="${width}" height="${height}" shape-rendering="geometricPrecision" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="astryn-aura" cx="50%" cy="44%" r="52%">
      <stop offset="0%" stop-color="${color}" stop-opacity="${tokens.auraOpacity * 0.55}" />
      <stop offset="62%" stop-color="${color}" stop-opacity="${tokens.auraOpacity * 0.16}" />
      <stop offset="100%" stop-color="${color}" stop-opacity="0" />
    </radialGradient>
    <linearGradient id="astryn-hair" x1="0.15" y1="0" x2="0.85" y2="1">
      <stop offset="0%" stop-color="#4a3a7d" />
      <stop offset="45%" stop-color="#2b2154" />
      <stop offset="100%" stop-color="#171232" />
    </linearGradient>
    <linearGradient id="astryn-face" x1="0.3" y1="0" x2="0.7" y2="1">
      <stop offset="0%" stop-color="#ffe3d2" />
      <stop offset="70%" stop-color="#f6cdb8" />
      <stop offset="100%" stop-color="#e6b09c" />
    </linearGradient>
    <linearGradient id="astryn-top" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#2a2a55" />
      <stop offset="100%" stop-color="#15152f" />
    </linearGradient>
  </defs>

  <circle cx="60" cy="64" r="44" fill="url(#astryn-aura)" />
  <circle data-testid="astryn-ring-track" cx="60" cy="64" r="37.5" fill="none" stroke="${color}" stroke-width="1.4" opacity="0.17" />
  <circle data-testid="astryn-ring" class="astryn-ring${motion ? ' astryn-spin' : ''}" cx="60" cy="64" r="37.5"
          fill="none" stroke="${color}" stroke-width="1.8" stroke-dasharray="${ringDash}" stroke-linecap="round" opacity="0.92" />

  <g class="astryn-body${motion ? ' astryn-breathe' : ''}">
    <!-- 后发：落在肩后的长发片 -->
    <path d="M 26 62 Q 20 96 30 122 L 90 122 Q 100 96 94 62 Q 92 40 60 36 Q 28 40 26 62 Z" fill="#191436" />
    <!-- 肩与上衣 -->
    <path d="M 22 140 Q 26 116 44 108 L 76 108 Q 94 116 98 140 Z" fill="url(#astryn-top)" />
    <path d="M 44 108 Q 60 118 76 108 L 76 113 Q 60 123 44 113 Z" fill="${color}" opacity="0.32" />
    <!-- 颈 -->
    <path d="M 50 92 L 70 92 L 70 108 Q 60 114 50 108 Z" fill="#eab7a2" />
    <path d="M 50 96 Q 60 104 70 96 L 70 100 Q 60 108 50 100 Z" fill="#d79a85" opacity="0.75" />

    <!-- 脸 -->
    <ellipse cx="60" cy="66" rx="27" ry="30" fill="url(#astryn-face)" />
    <path d="M 33 66 Q 33 96 60 96 Q 87 96 87 66" fill="none" stroke="#dda08a" stroke-width="0.8" opacity="0.5" />
    <!-- 耳 -->
    <path d="M 33 66 Q 27 64 28 72 Q 29 79 34 78 Z" fill="#f0c0ab" />
    <path d="M 87 66 Q 93 64 92 72 Q 91 79 86 78 Z" fill="#f0c0ab" />

    <!-- 眼 -->
    <g data-testid="astryn-eyes">
      <ellipse cx="49" cy="${eyes.lidY + eyes.lidHeight / 2}" rx="6.4" ry="${eyes.lidHeight / 2}" fill="#fffdfa" />
      <ellipse cx="71" cy="${eyes.lidY + eyes.lidHeight / 2}" rx="6.4" ry="${eyes.lidHeight / 2}" fill="#fffdfa" />
      <circle cx="${49 + eyes.pupilDx}" cy="${eyes.lidY + eyes.lidHeight / 2 + eyes.pupilDy}" r="3.1" fill="#2b2358" />
      <circle cx="${71 + eyes.pupilDx}" cy="${eyes.lidY + eyes.lidHeight / 2 + eyes.pupilDy}" r="3.1" fill="#2b2358" />
      <circle cx="${49 + eyes.pupilDx + 1.1}" cy="${eyes.lidY + eyes.lidHeight / 2 + eyes.pupilDy - 1.2}" r="1" fill="${color}" opacity="0.95" />
      <circle cx="${71 + eyes.pupilDx + 1.1}" cy="${eyes.lidY + eyes.lidHeight / 2 + eyes.pupilDy - 1.2}" r="1" fill="${color}" opacity="0.95" />
      <path d="M ${42} ${eyes.lidY - 0.5} Q 49 ${eyes.lidY - 3.4} ${56} ${eyes.lidY - 0.5}" fill="none" stroke="#3a2f63" stroke-width="1.5" stroke-linecap="round" />
      <path d="M ${64} ${eyes.lidY - 0.5} Q 71 ${eyes.lidY - 3.4} ${78} ${eyes.lidY - 0.5}" fill="none" stroke="#3a2f63" stroke-width="1.5" stroke-linecap="round" />
    </g>
    <path d="M 43 ${eyes.lidY - 7} Q 49 ${eyes.lidY - 10} 55 ${eyes.lidY - 7.6}" stroke="#463872" stroke-width="1.5" fill="none" stroke-linecap="round" />
    <path d="M 65 ${eyes.lidY - 7.6} Q 71 ${eyes.lidY - 10} 77 ${eyes.lidY - 7}" stroke="#463872" stroke-width="1.5" fill="none" stroke-linecap="round" />

    <!-- 鼻与腮红 -->
    <path d="M 60 ${eyes.lidY + eyes.lidHeight + 2} q 1.6 2.2 -0.6 3.4" stroke="#d99a86" stroke-width="1.1" fill="none" stroke-linecap="round" opacity="0.8" />
    <ellipse cx="42.5" cy="76" rx="5.2" ry="2.7" fill="#ef8f8f" opacity="0.3" />
    <ellipse cx="77.5" cy="76" rx="5.2" ry="2.7" fill="#ef8f8f" opacity="0.3" />

    <path data-testid="astryn-mouth" class="astryn-mouth" d="${mouth}" stroke="#c2575a" stroke-width="2.2" fill="none" stroke-linecap="round" />

    <!-- 前发：中分刘海 + 两侧鬓发，逐片描边避免糊成一块 -->
    <path d="M 60 34 Q 34 36 32 64 Q 36 52 44 47 Q 52 42 60 43 Z" fill="url(#astryn-hair)" />
    <path d="M 60 34 Q 86 36 88 64 Q 84 52 76 47 Q 68 42 60 43 Z" fill="url(#astryn-hair)" />
    <path d="M 32 62 Q 28 82 34 96 Q 33 78 37 66 Z" fill="#241b4a" />
    <path d="M 88 62 Q 92 82 86 96 Q 87 78 83 66 Z" fill="#241b4a" />
    <path d="M 60 35 Q 46 38 39 48" stroke="#6b57a8" stroke-width="1.1" fill="none" opacity="0.55" stroke-linecap="round" />
    <path d="M 60 35 Q 74 38 81 48" stroke="#6b57a8" stroke-width="1.1" fill="none" opacity="0.55" stroke-linecap="round" />
    <!-- 星形发夹（星栖的栖止之处） -->
    <path data-testid="astryn-hairpin" d="M 79 44 l 2.2 4.4 4.8 0.7 -3.5 3.4 0.8 4.8 -4.3 -2.3 -4.3 2.3 0.8 -4.8 -3.5 -3.4 4.8 -0.7 Z"
          fill="${color}" opacity="0.92" transform="scale(0.62) translate(48 26)" />
    <!-- 领口星标 -->
    <circle cx="60" cy="115" r="2.1" fill="${color}" opacity="0.9" />
  </g>

  ${tokens.glyph ? `<text data-testid="astryn-glyph" x="104" y="26" text-anchor="middle" font-size="13" fill="${color}" font-family="ui-monospace, Consolas, monospace">${tokens.glyph}</text>` : ''}
  ${frame.visibleState === 'thinking' ? `<g data-testid="astryn-thinking-dots" class="${motion ? 'astryn-dots' : ''}" opacity="0.85">
      <circle cx="92" cy="30" r="1.9" fill="${color}" /><circle cx="99" cy="25" r="2.3" fill="${color}" /><circle cx="106" cy="20" r="1.6" fill="${color}" />
    </g>` : ''}
</svg>`;
}

export function describeXiaoqiFrame(frame: AstrynAvatarFrame): Record<string, string | number | boolean> {
  const tokens = STATE_VISUALS[frame.visibleState];
  const eyes = eyesFor(tokens);
  return {
    visibleState: frame.visibleState,
    bodyPreset: bodyPresetFor(frame.visibleState),
    expressionDriver: 'text-event-frame',
    ringColor: tokens.ringColor,
    eyeMode: tokens.eyeMode,
    mouthMode: tokens.mouthMode,
    mouthPath: mouthPathFor(frame.expressionFrame, tokens),
    lidHeight: eyes.lidHeight,
    glyph: tokens.glyph,
    motion: tokens.motionAllowed && !frame.reducedMotion,
    expressionFrame: frame.expressionFrame
  };
}

export function assertStateHasDistinctVisual(state: string): void {
  if (!(state in STATE_VISUALS)) throw new Error(`state without visual mapping: ${state}`);
}
