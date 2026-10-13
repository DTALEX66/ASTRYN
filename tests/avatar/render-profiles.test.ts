import { describe, expect, it } from 'vitest';
import type { AstrynAvatarFrame, AstrynVisibleState } from '@astryn/contracts';
import { AVATAR_VIEW_PROFILES, avatarViewForMode, renderXiaoqiMarkup } from '@astryn/core';

const frame = (visibleState: AstrynVisibleState = 'idle'): AstrynAvatarFrame => ({
  characterId: 'xiaoqi',
  sessionId: 's1',
  visibleState,
  expressionFrame: 0,
  streamedText: '',
  taskStep: null,
  failureMessage: null,
  reducedMotion: false
});

function svgAttrs(markup: string): { viewBox: string; width: string; height: string; shapeRendering: string } {
  const viewBox = markup.match(/viewBox="([^"]+)"/)?.[1] ?? '';
  const width = markup.match(/width="([^"]+)"/)?.[1] ?? '';
  const height = markup.match(/height="([^"]+)"/)?.[1] ?? '';
  const shapeRendering = markup.match(/shape-rendering="([^"]+)"/)?.[1] ?? '';
  return { viewBox, width, height, shapeRendering };
}

describe('GF03 三呈现档（首页 / 对话头像 / 阅读侧边）', () => {
  it('三个档位齐备，取景框都在 120×140 渲染源坐标系内', () => {
    expect(Object.keys(AVATAR_VIEW_PROFILES).sort()).toEqual(['avatar', 'hero', 'sidebar']);
    for (const profile of Object.values(AVATAR_VIEW_PROFILES)) {
      const [x, y, w, h] = profile.viewBox;
      expect(x, profile.id).toBeGreaterThanOrEqual(0);
      expect(y, profile.id).toBeGreaterThanOrEqual(0);
      expect(x + w, profile.id).toBeLessThanOrEqual(120);
      expect(y + h, profile.id).toBeLessThanOrEqual(140);
      expect(w, profile.id).toBeGreaterThan(0);
      expect(h, profile.id).toBeGreaterThan(0);
      expect(profile.width, profile.id).toBeGreaterThan(0);
      expect(profile.purpose.length, profile.id).toBeGreaterThan(0);
    }
  });

  it('头像档确实裁到头肩，而不是整幅换尺寸', () => {
    const heroBox: readonly number[] = AVATAR_VIEW_PROFILES.hero.viewBox;
    const avatarBox: readonly number[] = AVATAR_VIEW_PROFILES.avatar.viewBox;
    const [hx, hy, hw, hh] = heroBox;
    const [ax, ay, aw, ah] = avatarBox;
    expect(hx === ax && hy === ay && hw === aw && hh === ah).toBe(false);
    expect(ay as number).toBeGreaterThan(hy as number);
    expect(ah as number).toBeLessThan(hh as number);
  });

  it('头像档仍完整包含状态环与光晕（几何判据，不是目测）', () => {
    const [x, y, w, h] = AVATAR_VIEW_PROFILES.avatar.viewBox;
    // 环中心 (60,64)，环半径 37.5+描边半宽 0.9；光晕半径 44。
    const ringOuter = 37.5 + 0.9;
    const aura = 44;
    expect(x, '环左缘被裁').toBeLessThanOrEqual(60 - ringOuter);
    expect(x + w, '环右缘被裁').toBeGreaterThanOrEqual(60 + ringOuter);
    expect(y, '环顶被裁').toBeLessThanOrEqual(64 - ringOuter);
    expect(y + h, '环底被裁').toBeGreaterThanOrEqual(64 + ringOuter);
    expect(x, '光晕左缘被裁').toBeLessThanOrEqual(60 - aura);
    expect(x + w, '光晕右缘被裁').toBeGreaterThanOrEqual(60 + aura);
    expect(y, '光晕顶被裁').toBeLessThanOrEqual(64 - aura);
  });

  it('缺省渲染与原行为一致（整幅 120×140 / 宽 200），并带清晰度提示', () => {
    const attrs = svgAttrs(renderXiaoqiMarkup(frame()));
    expect(attrs.viewBox).toBe('0 0 120 140');
    expect(attrs.width).toBe('200');
    expect(attrs.shapeRendering).toBe('geometricPrecision');
  });

  it('档位驱动 viewBox 与尺寸：hero 240×280、sidebar 168×196、avatar 96×99.84', () => {
    expect(svgAttrs(renderXiaoqiMarkup(frame(), 240, AVATAR_VIEW_PROFILES.hero))).toMatchObject({
      viewBox: '0 0 120 140',
      width: '240',
      height: '280'
    });
    expect(svgAttrs(renderXiaoqiMarkup(frame(), 168, AVATAR_VIEW_PROFILES.sidebar))).toMatchObject({
      viewBox: '0 0 120 140',
      width: '168',
      height: '196'
    });
    expect(svgAttrs(renderXiaoqiMarkup(frame(), undefined, AVATAR_VIEW_PROFILES.avatar))).toMatchObject({
      viewBox: '10 16 100 104',
      width: '96',
      height: '99.84'
    });
  });

  it('同尺寸下 hero 与 avatar 输出不同取景', () => {
    const hero = renderXiaoqiMarkup(frame(), 120, AVATAR_VIEW_PROFILES.hero);
    const avatar = renderXiaoqiMarkup(frame(), 120, AVATAR_VIEW_PROFILES.avatar);
    expect(hero).not.toBe(avatar);
    expect(new Set([hero, avatar]).size).toBe(2);
  });

  it('呈现模式映射：嵌入首页用主视觉，侧栏用竖向半身', () => {
    expect(avatarViewForMode('embedded').id).toBe('hero');
    expect(avatarViewForMode('panel').id).toBe('sidebar');
  });
});
