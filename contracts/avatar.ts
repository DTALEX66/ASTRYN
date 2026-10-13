import type { AstrynVisibleState } from './state';

/**
 * 可替换渲染驱动接口。M0 用原创 SVG 实现；未来 Live2D / VRM / 3D 驱动
 * 只需实现同一接口，角色 UI 与状态机不得因此改动。
 */

export interface AstrynAvatarFrame {
  readonly characterId: string;
  readonly sessionId: string;
  readonly visibleState: AstrynVisibleState;
  /** 只由真实 stream.delta 推进的帧号，渲染层据此做口型/表情离散帧。 */
  readonly expressionFrame: number;
  readonly streamedText: string;
  readonly taskStep: string | null;
  readonly failureMessage: string | null;
  readonly reducedMotion: boolean;
}

export interface AstrynRenderBudget {
  readonly compositedOnly: boolean;
  readonly respectReducedMotion: boolean;
  readonly maxAmbientAnimations: number;
}

export interface AstrynAvatarInstance {
  update(frame: AstrynAvatarFrame): void;
  dispose(): void;
}

/** 素材来源必须在契约层面可声明，便于审查许可证与原创性。 */
export interface AstrynAssetProvenance {
  readonly origin: 'original' | 'licensed-third-party' | 'unknown';
  readonly license: string;
  readonly note: string;
}

/**
 * 呈现档：同一角色源在三种落点（首页主视觉 / 对话头像 / 阅读侧边）的
 * 取景框与建议尺寸。取景坐标系与渲染源一致（x y w h，单位同 viewBox）。
 */
export interface AstrynAvatarViewProfile {
  readonly id: string;
  readonly label: string;
  readonly purpose: string;
  readonly viewBox: readonly [number, number, number, number];
  readonly width: number;
}

export interface AstrynAvatarRenderer {
  readonly rendererId: string;
  readonly displayName: string;
  readonly provenance: AstrynAssetProvenance;
  readonly budget: AstrynRenderBudget;
  readonly supportedStates: readonly AstrynVisibleState[];
  supports(state: AstrynVisibleState): boolean;
  createFrame(): AstrynAvatarFrame;
  /** 无 DOM 环境（测试）下也必须能算出帧描述，保证逻辑与渲染分离。 */
  describe?(frame: AstrynAvatarFrame): Record<string, string | number | boolean>;
  /**
   * 两种落地方式至少提供一种：字符串标记（SVG/HTML 驱动）或命令式挂载（WebGL/Live2D 驱动）。
   * 呈现层必须通过这里取画面，不得直接 import 具体渲染实现——否则 seam 只是装饰。
   * view 为呈现档；size 显式给出时优先于档位建议宽度。
   */
  renderMarkup?(frame: AstrynAvatarFrame, size?: number, view?: AstrynAvatarViewProfile): string;
  mount?(host: HTMLElement, frame: AstrynAvatarFrame): AstrynAvatarInstance;
}
