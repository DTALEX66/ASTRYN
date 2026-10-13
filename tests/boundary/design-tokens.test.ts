import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 设计令牌门禁：DESIGN.md 里的每个数字都必须可重算。
 * 目的不是"检查样式写得好看不"，而是防止对比度、焦点可见性与动效降级在后续改动中静默回退。
 */
const repoRoot = process.cwd();
const css = readFileSync(join(repoRoot, 'src/presentation/astryn.css'), 'utf8');
const visuals = readFileSync(join(repoRoot, 'src/avatar/state-visuals.ts'), 'utf8');

const hexToRgb = (hex: string): [number, number, number] => {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
};

function relativeLuminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = hexToRgb(hex);
  const lin = (value: number): number => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: string, b: string): number {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/** 令牌可能写成 var(--astryn-x)；先收集全部自定义属性，再逐层解析引用。 */
const customProps: Record<string, string> = {};
for (const match of css.matchAll(/(--astryn-[a-z0-9-]+):\s*([^;]+);/g)) {
  if (match[1] && match[2]) customProps[match[1]] = match[2].trim();
}

function resolveToken(value: string, depth = 0): string {
  const reference = value.match(/var\((--astryn-[a-z0-9-]+)\)/);
  const name = reference?.[1];
  const replacement = name ? customProps[name] : undefined;
  const whole = reference?.[0];
  if (!reference || !replacement || !whole || depth > 3) return value;
  // 文本替换而不是整体返回：否则 "2px solid var(--astryn-accent)" 会被折成纯颜色，丢掉宽度。
  return resolveToken(value.replace(whole, replacement), depth + 1);
}

const tokens: Record<string, string> = {};
for (const match of css.matchAll(/--astryn-([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,6});/g)) {
  if (match[1] && match[2]) tokens[match[1]] = match[2];
}

const ringColors: Record<string, string> = {};
for (const match of visuals.matchAll(/(idle|listening|thinking|speaking|interrupted|awaiting_approval|executing|completed|failed):\s*\{\s*ringColor:\s*'(#[0-9a-fA-F]{6})'/g)) {
  if (match[1] && match[2]) ringColors[match[1]] = match[2];
}

describe('设计令牌对比度门禁（DESIGN.md 可重算）', () => {
  it('令牌表非空且包含语义角色', () => {
    expect(Object.keys(tokens).length).toBeGreaterThanOrEqual(15);
    for (const key of ['bg', 'surface', 'surface-2', 'text', 'muted', 'line', 'accent', 'placeholder']) {
      expect(tokens[key], `缺少令牌 --astryn-${key}`).toBeTruthy();
    }
  });

  const textPairs: ReadonlyArray<readonly [string, string, string]> = [
    ['text', 'bg', '正文 / 页面底'],
    ['text', 'surface', '正文 / 卡片'],
    ['text', 'surface-2', '正文 / 按钮底'],
    ['text', 'surface-sunken', '正文 / 角色气泡'],
    ['muted', 'surface', '次要说明 / 卡片'],
    ['muted', 'bg', '次要说明 / 页面底'],
    ['placeholder', 'surface', '输入占位符'],
    ['task-text', 'surface', '任务芯片文字'],
    ['error-text', 'surface', '错误芯片文字'],
    ['error-strong', 'error-surface', '错误正文'],
    ['warning-text', 'warning-surface', '审批卡文字'],
    ['success-text', 'surface', '真实来源徽标'],
    ['accent', 'surface', '强调色作文字']
  ];

  for (const [fgKey, bgKey, label] of textPairs) {
    it(`${label} ≥ 4.5:1`, () => {
      const fg = tokens[fgKey];
      const bg = tokens[bgKey];
      expect(fg, `缺少 --astryn-${fgKey}`).toBeTruthy();
      expect(bg, `缺少 --astryn-${bgKey}`).toBeTruthy();
      const value = contrast(fg as string, bg as string);
      expect(value, `${fg} on ${bg} 只有 ${value.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    });
  }

  it('九态环色对两种底面均 ≥ 3:1（非文字图形判据）', () => {
    expect(Object.keys(ringColors)).toHaveLength(9);
    for (const [state, color] of Object.entries(ringColors)) {
      expect(contrast(color, tokens.bg as string), `${state} 环色对页面底不足`).toBeGreaterThanOrEqual(3);
      expect(contrast(color, tokens.surface as string), `${state} 环色对卡片底不足`).toBeGreaterThanOrEqual(3);
    }
  });

  it('九态环色互不相同（颜色是状态载体）', () => {
    expect(new Set(Object.values(ringColors)).size).toBe(9);
  });
});

describe('可访问性实现门禁', () => {
  it('承载文字的容器不得使用渐变背景（否则 axe 无法判定对比度）', () => {
    const rootRule = css.match(/\.astryn-root\s*\{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(rootRule).toBeTruthy();
    const backgroundLine = rootRule.match(/^\s*background:\s*([^;]+);/m)?.[1]?.trim() ?? '';
    expect(backgroundLine, '根容器背景必须是纯色令牌').not.toMatch(/gradient/);
    expect(backgroundLine).toMatch(/^var\(--astryn-/);
  });

  it('输入占位符颜色被显式声明（不依赖浏览器默认灰）', () => {
    expect(css).toMatch(/::placeholder\s*\{\s*color:\s*var\(--astryn-placeholder\)/);
  });

  it('键盘焦点环显式声明且 ≥2px，不依赖 UA 默认', () => {
    const focusRule = css.match(/\.astryn-btn:focus-visible[\s\S]*?\{([\s\S]*?)\}/)?.[1] ?? '';
    expect(focusRule).toContain('outline');
    const outlineValue = resolveToken(focusRule.match(/outline:\s*([^;]+);/)?.[1]?.trim() ?? '');
    const width = Number(outlineValue.match(/([0-9.]+)px/)?.[1] ?? Number.NaN);
    expect(outlineValue, '焦点环必须显式声明宽度').not.toBe('none');
    expect(width, `焦点环宽度解析为 ${outlineValue}`).toBeGreaterThanOrEqual(2);
  });

  it('prefers-reduced-motion 停用全部环境动画类', () => {
    const block = css.match(/@media\s*\(prefers-reduced-motion[^{]*\{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(block).toBeTruthy();
    for (const cls of ['astryn-spin', 'astryn-breathe', 'astryn-dots']) {
      expect(block, `${cls} 未在 reduced-motion 下停用`).toContain(cls);
    }
    expect(block).toContain('animation: none');
  });

  it('动效只使用合成属性（transform / opacity）', () => {
    const keyframes = [...css.matchAll(/@keyframes[^{]*\{([\s\S]*?)\n\}/g)].map((m) => m[1]).join('\n');
    expect(keyframes).toBeTruthy();
    const animatedProperties = [...new Set([...keyframes.matchAll(/^\s*([a-z-]+):/gm)].map((m) => m[1] ?? ''))];
    const allowed = new Set(['transform', 'opacity']);
    const offenders = animatedProperties.filter((property) => !allowed.has(property));
    expect(offenders, `关键帧里出现了非合成属性：${offenders.join(', ')}`).toEqual([]);
  });

  it('组件规则里不残留硬编码十六进制色（令牌化约束）', () => {
    const tokenBlock = css.match(/\.astryn-root\s*\{[\s\S]*?\n\}/)?.[0] ?? '';
    const outside = css.replace(tokenBlock, '');
    const hardcoded = [...outside.matchAll(/(?:color|background|background-color|border-color|outline):\s*#[0-9a-fA-F]{3,6}/g)].map((m) => m[0]);
    expect(hardcoded, `未令牌化的色值：${hardcoded.join(' | ')}`).toEqual([]);
  });

  it('面板宽度自适应，不写死像素（375px 实测曾溢出）', () => {
    expect(css).toMatch(/\.astryn-root--panel\s*\{\s*width:\s*min\(360px,\s*100%\)/);
  });
});
