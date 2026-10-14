import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ASTRYN_FOCUS_PRESENTATION_TOKENS,
  ASTRYN_HIDDEN_FOOTPRINT_TOKEN,
  ASTRYN_HOST_SLOTS,
  ASTRYN_HOST_SLOT_SPECS,
  AVATAR_VIEW_PROFILES,
  hostSlotSpec,
  modeSpec
} from '@astryn/core';

/**
 * GF08 呈现尺寸令牌门禁：合同里声明的 token 名必须在样式表真实存在，
 * 组件尺寸必须引用令牌而不是字面值——否则"引用前端 tokens"只是注释里的口号。
 */
const css = readFileSync(join(process.cwd(), 'src/presentation/astryn.css'), 'utf8');

describe('呈现尺寸令牌门禁（GF08）', () => {
  it('合同里的槽位/专注/隐藏 token 全部在 CSS 中定义，且槽位只指向已实现模式', () => {
    expect(ASTRYN_HOST_SLOTS).toHaveLength(3);
    for (const spec of ASTRYN_HOST_SLOT_SPECS) {
      expect(css, `${spec.avatarSizeToken} 未定义`).toContain(`${spec.avatarSizeToken}:`);
      expect(css, `${spec.logHeightToken} 未定义`).toContain(`${spec.logHeightToken}:`);
      expect(modeSpec(spec.mode).implementedInM0, `槽位 ${spec.slot} 指向未实现模式 ${spec.mode}`).toBe(true);
    }
    expect(css).toContain(`${ASTRYN_FOCUS_PRESENTATION_TOKENS.avatarSize}:`);
    expect(css).toContain(`${ASTRYN_FOCUS_PRESENTATION_TOKENS.logHeight}:`);
    expect(css).toContain(`${ASTRYN_HIDDEN_FOOTPRINT_TOKEN}:`);
  });

  it('槽位/取景/隐藏的映射规则齐全（宿主覆盖点就是这些 base 令牌）', () => {
    for (const slot of ASTRYN_HOST_SLOTS) {
      expect(css, `缺少槽位映射：${slot}`).toContain(`.astryn-root[data-slot="${slot}"]`);
    }
    // 取景档名从真实 profile 注册表枚举：新增档位而未写 CSS 映射时此处变红。
    for (const view of Object.keys(AVATAR_VIEW_PROFILES)) {
      expect(css, `缺少取景档映射：${view}`).toContain(`.astryn-root[data-avatar-view="${view}"]`);
    }
    expect(css).toContain('.astryn-root[data-hidden="true"]');
  });

  it('专注规则必须写在全部槽位映射之后（同等特异性下最后书写者生效，顺序即语义）', () => {
    const lastSlot = Math.max(...ASTRYN_HOST_SLOTS.map((slot) => css.indexOf(`.astryn-root[data-slot="${slot}"]`)));
    const focusIndex = css.indexOf('.astryn-root[data-focus="true"]');
    expect(lastSlot).toBeGreaterThan(-1);
    expect(focusIndex, '专注规则必须排在槽位映射之后').toBeGreaterThan(lastSlot);
  });

  it('组件尺寸引用令牌：角色宽（SVG 与位图两条驱动）、对话高度、隐藏足迹均无字面值', () => {
    const avatarRule = css.match(/\.astryn-avatar svg\s*\{[^}]*\}/)?.[0] ?? '';
    expect(avatarRule).toContain('width: var(--astryn-avatar-size)');
    const avatarImageRule = css.match(/\.astryn-avatar img\s*\{[^}]*\}/)?.[0] ?? '';
    expect(avatarImageRule).toContain('width: var(--astryn-avatar-size)');
    const logRule = css.match(/\.astryn-log\s*\{[^}]*\}/)?.[0] ?? '';
    expect(logRule).toContain('max-height: var(--astryn-log-max-height)');
    const hiddenRule = css.match(/\.astryn-root\[data-hidden="true"\]\s*\{[^}]*\}/)?.[0] ?? '';
    expect(hiddenRule).toContain('min-height: var(--astryn-hidden-min-height)');
    expect(css, '对话区高度不应再有字面 240px').not.toMatch(/max-height:\s*240px/);
  });

  it('未知槽位显式抛错（未知不当可用）', () => {
    for (const slot of ASTRYN_HOST_SLOTS) {
      expect(Object.keys(AVATAR_VIEW_PROFILES)).toContain(hostSlotSpec(slot).avatarView);
    }
    expect(() => hostSlotSpec('nowhere' as never)).toThrow(/unknown host slot/);
  });
});
