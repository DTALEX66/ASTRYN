import type { AstrynAvatarRenderer } from '@astryn/contracts';
import { xiaoqiRasterRenderer } from './xiaoqi-raster-renderer';
import { xiaoqiSvgRenderer } from './xiaoqi-svg-renderer';

/**
 * 已实现的渲染驱动。P2 的 Live2D / VRM / 3D 驱动在这里注册，而不是在 UI 里加分支。
 * 顺序即回退优先级：index 0 是 v1 原创 SVG 基线——它是未注册 id 与位图失败时的回退下限。
 */
export const AVATAR_RENDERERS: readonly AstrynAvatarRenderer[] = [xiaoqiSvgRenderer, xiaoqiRasterRenderer];

export interface AstrynRendererResolution {
  readonly renderer: AstrynAvatarRenderer;
  /** false = 请求的 rendererId 未注册，已回退到回退下限；reason 说明原因（未知不当可用）。 */
  readonly exact: boolean;
  readonly reason: string | null;
}

/** 回退下限（注册表 index 0，v1 原创 SVG）：未注册 id 与位图加载失败共用的唯一回退。 */
export function fallbackAvatarRenderer(): AstrynAvatarRenderer {
  const floor = AVATAR_RENDERERS[0];
  if (!floor) throw new Error('没有已注册的渲染驱动');
  return floor;
}

export function resolveAvatarRenderer(rendererId: string): AstrynRendererResolution {
  const found = AVATAR_RENDERERS.find((renderer) => renderer.rendererId === rendererId);
  if (found) return { renderer: found, exact: true, reason: null };
  const fallback = fallbackAvatarRenderer();
  return {
    renderer: fallback,
    exact: false,
    reason: `rendererId「${rendererId}」未注册，已回退到回退下限 ${fallback.rendererId}（原始请求不静默）`
  };
}

/** 严格取驱动：rendererId 未注册时抛错，不静默降级（审计 A3——exact:false 信号不得被丢弃）。
    需要回退的调用方必须显式选择：resolveAvatarRenderer 判 exact，或 fallbackAvatarRenderer()。 */
export function selectAvatarRenderer(rendererId: string): AstrynAvatarRenderer {
  const resolution = resolveAvatarRenderer(rendererId);
  if (!resolution.exact) throw new Error(resolution.reason ?? `rendererId「${rendererId}」未注册`);
  return resolution.renderer;
}
