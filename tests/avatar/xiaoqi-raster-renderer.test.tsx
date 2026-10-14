import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ASTRYN_CONVERSATION_STATES, ASTRYN_TASK_STATES, XIAOQI_PROFILE } from '@astryn/contracts';
import type { AstrynAvatarFrame, AstrynCompanionState, AstrynVisibleState } from '@astryn/contracts';
import {
  AVATAR_RENDERERS,
  AvatarView,
  avatarViewProfile,
  renderXiaoqiRasterMarkup,
  resolveAvatarRenderer,
  xiaoqiRasterRenderer,
  xiaoqiSvgRenderer
} from '@astryn/core';

/**
 * GF03 v2 位图驱动（MINIMAX DESIGN 交付）：
 * 九态位图是运行时默认画面；svg 保留为回退下限。
 * 这个测试保证"交付的文件名 ↔ 状态映射 ↔ 注册表默认"三者不会静默漂移。
 */

const SUPPORTED: readonly AstrynVisibleState[] = [
  ...ASTRYN_CONVERSATION_STATES,
  ...ASTRYN_TASK_STATES.filter((state) => state !== 'none')
];

function frameFor(state: AstrynVisibleState, overrides: Partial<AstrynAvatarFrame> = {}): AstrynAvatarFrame {
  return {
    characterId: 'xiaoqi',
    sessionId: 's1',
    visibleState: state,
    expressionFrame: 0,
    streamedText: '',
    taskStep: null,
    failureMessage: null,
    reducedMotion: false,
    ...overrides
  };
}

const baseState: AstrynCompanionState = {
  protocol: 'astryn-1',
  sessionId: 's1',
  revision: 0,
  conversation: 'idle',
  activeRequestId: null,
  streamedText: '',
  expressionFrame: 0,
  task: { status: 'none', taskId: null, requestId: null, actionSummary: null, riskTier: null, step: null, percent: null, failure: null, receiptId: null },
  failure: null,
  model: { kind: 'none', providerId: null, modelId: null, available: false, reason: null, evidenceLevel: 'NO_EVIDENCE' }
};

describe('九态位图驱动（xiaoqi-raster-v2）', () => {
  it('每个契约可见状态映射到对应交付文件，且九张两两不同', () => {
    const sources = SUPPORTED.map((state) => {
      const markup = renderXiaoqiRasterMarkup(frameFor(state));
      const match = markup.match(/src="([^"]+)"/);
      expect(match, `${state} 未渲染图像`).toBeTruthy();
      const src = match?.[1] ?? '';
      // 文件名与状态一一对应（派生件沿用同名），改名或错配即红。
      expect(src, `${state} 映射到错误文件`).toMatch(new RegExp(`xiaoqi_state_${state}_sleepwear_v1\\.png$`));
      return src;
    });
    expect(new Set(sources).size).toBe(SUPPORTED.length);
  });

  it('src 落到磁盘真实文件，且与 STATE-ASSET-INDEX.json 登记的字节数/哈希逐张相符（C5）', () => {
    interface ManifestEntry {
      readonly path: string;
      readonly name?: string;
      readonly bytes: number;
      readonly sha256: string;
      readonly runtimeUsable: boolean;
      readonly forState?: string;
      readonly sourcePath?: string;
      readonly sourceSha256?: string;
    }
    const manifest = JSON.parse(readFileSync('assets/character/STATE-ASSET-INDEX.json', 'utf8')) as {
      versions: readonly { id: string; files: readonly ManifestEntry[]; derived: readonly ManifestEntry[] }[];
    };
    const v2 = manifest.versions.find((version) => version.id === 'v2');
    expect(v2, '清单缺少 v2 版本节').toBeTruthy();
    const direct = new Map((v2?.files ?? []).map((entry) => [entry.path, entry]));
    const derived = new Map((v2?.derived ?? []).map((entry) => [`${entry.path}${entry.name ?? ''}`, entry]));

    const hashCache = new Map<string, { bytes: number; sha256: string }>();
    const digest = (relative: string) => {
      const cached = hashCache.get(relative);
      if (cached) return cached;
      const absolute = join(process.cwd(), relative);
      expect(existsSync(absolute), `${relative} 在磁盘上不存在`).toBe(true);
      const bytes = readFileSync(absolute);
      const value = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
      hashCache.set(relative, value);
      return value;
    };

    for (const state of SUPPORTED) {
      const src = renderXiaoqiRasterMarkup(frameFor(state)).match(/src="([^"]+)"/)?.[1] ?? '';
      // vitest 下构建期资源 URL 为仓库根相对形式（/assets/...）；换成别的形态（如 /@fs/）时这里直接红，
      // 不允许静默跳过磁盘核对。
      expect(src, `${state} 的 src 形态与磁盘核对假设不符`).toMatch(/^\/assets\/character\/upgraded\/v1\//);
      const relative = src.replace(/^\//, '');
      const onDisk = digest(relative);
      const isDerived = src.includes('derived-alpha');
      const registered = isDerived ? derived.get(relative) : direct.get(relative);
      expect(registered, `${state} 的 ${relative} 未登记在清单对应节（derived=${isDerived}）`).toBeTruthy();
      expect(registered?.runtimeUsable, `${state} 登记为不可运行时消费`).toBe(true);
      expect(onDisk.bytes, `${state} 磁盘字节数与清单不符`).toBe(registered?.bytes);
      expect(onDisk.sha256, `${state} 磁盘哈希与清单不符`).toBe(registered?.sha256);
      if (isDerived) {
        expect(registered?.forState, `${state} 派生登记的 forState 与状态不符`).toBe(state);
        // 派生链必须可验证：来源文件在清单里存在，且其哈希与 sourceSha256 一致。
        const source = registered?.sourcePath ?? '';
        const sourceEntry = direct.get(source);
        expect(sourceEntry, `${state} 派生来源 ${source} 未登记`).toBeTruthy();
        expect(digest(source).sha256, `${state} 派生来源哈希与 sourceSha256 不符`).toBe(registered?.sourceSha256);
      } else {
        expect(registered?.runtimeUsable, `${state} 直用件应为去背成功件`).toBe(true);
      }
    }
  });

  it('thinking/completed/failed 使用本地派生去背件（derived-alpha），其余直用交付件', () => {
    for (const state of SUPPORTED) {
      const src = renderXiaoqiRasterMarkup(frameFor(state)).match(/src="([^"]+)"/)?.[1] ?? '';
      const derived = src.includes('derived-alpha');
      expect(derived, `${state} 的派生归属与登记不符`).toBe(['thinking', 'completed', 'failed'].includes(state));
    }
  });

  it('标记只由内部常量拼装：单张 img、无外部协议、无脚本协议、带状态与替代文本', () => {
    const markup = renderXiaoqiRasterMarkup(frameFor('speaking'));
    expect(markup.match(/<img/g)).toHaveLength(1);
    expect(markup).not.toMatch(/https?:\/\//);
    expect(markup).not.toMatch(/javascript:/i);
    expect(markup).toContain('data-testid="astryn-avatar"');
    expect(markup).toContain('data-visible-state="speaking"');
    expect(markup).toContain('alt="小栖当前状态：speaking"');
  });

  it('宽度沿用槽位令牌链：显式 size 优先，其次呈现档，缺省 240', () => {
    expect(renderXiaoqiRasterMarkup(frameFor('idle'))).toContain('width="240"');
    expect(renderXiaoqiRasterMarkup(frameFor('idle'), 120)).toContain('width="120"');
    expect(renderXiaoqiRasterMarkup(frameFor('idle'), undefined, avatarViewProfile('hero'))).toContain('width="240"');
    expect(renderXiaoqiRasterMarkup(frameFor('idle'), undefined, avatarViewProfile('sidebar'))).toContain('width="168"');
    expect(renderXiaoqiRasterMarkup(frameFor('idle'), undefined, avatarViewProfile('avatar'))).toContain('width="96"');
    // 优先级冲突驱动（C6）：size 与 view 同时给出时必须取 size——两值不同才能证明比较的是优先级而不是巧合。
    const conflicted = renderXiaoqiRasterMarkup(frameFor('idle'), 120, avatarViewProfile('sidebar'));
    expect(conflicted).toContain('width="120"');
    expect(conflicted).not.toContain('width="168"');
  });

  it('静帧预算与出处如实：无环境动画、AI 生成声明、缺口写进 note', () => {
    expect(xiaoqiRasterRenderer.budget.maxAmbientAnimations).toBe(0);
    expect(xiaoqiRasterRenderer.budget.compositedOnly).toBe(true);
    expect(xiaoqiRasterRenderer.budget.respectReducedMotion).toBe(true);
    expect(xiaoqiRasterRenderer.provenance.origin).toBe('ai-generated');
    expect(xiaoqiRasterRenderer.provenance.note).toContain('派生');
    expect(xiaoqiRasterRenderer.provenance.note).toContain('真人');
    expect(xiaoqiRasterRenderer.provenance.note).toContain('种子');
    expect(xiaoqiRasterRenderer.supportedStates).toHaveLength(SUPPORTED.length);
    // 静帧没有可动的口型：不得声明文本帧口型驱动器。
    expect(xiaoqiRasterRenderer.describe?.(frameFor('speaking'))['motion']).toBe(false);
  });

  it('注册表：默认档案精确命中位图驱动，SVG 仍是 index 0 回退下限', () => {
    expect(AVATAR_RENDERERS[0]?.rendererId).toBe(xiaoqiSvgRenderer.rendererId);
    const resolved = resolveAvatarRenderer(XIAOQI_PROFILE.appearance.rendererId);
    expect(resolved.exact).toBe(true);
    expect(resolved.renderer.rendererId).toBe(xiaoqiRasterRenderer.rendererId);
    expect(resolveAvatarRenderer('live2d-not-installed').renderer.rendererId).toBe(xiaoqiSvgRenderer.rendererId);
  });

  it('AvatarView 集成：默认档案渲染 img 主机，data-renderer 指向位图驱动', () => {
    render(<AvatarView state={baseState} profile={XIAOQI_PROFILE} reducedMotion={false} view={avatarViewProfile('hero')} />);
    const host = screen.getByTestId('astryn-avatar-host');
    expect(host.getAttribute('data-renderer')).toBe('xiaoqi-raster-v2');
    expect(host.getAttribute('data-renderer-exact')).toBeNull();
    const img = screen.getByTestId('astryn-avatar');
    expect(img.tagName).toBe('IMG');
    expect(img.getAttribute('data-visible-state')).toBe('idle');
  });
});
