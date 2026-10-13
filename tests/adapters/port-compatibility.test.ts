import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ASTRYN_PRESENTATION_MODE_SPECS, ASTRYN_PRESENTATION_MODES } from '@astryn/contracts';
import {
  AVATAR_RENDERERS,
  ASTRYN_PORT_MANIFEST,
  describePortAvailability,
  modeSpec,
  resolveAvatarRenderer,
  selectAvatarRenderer,
  xiaoqiSvgRenderer
} from '@astryn/core';

describe('八端口一致性：清单、可用性推导与自有 seam 的真实能力', () => {
  it('八端口覆盖任务包点名的全部端口，且每个端口都有可用性结论', () => {
    const entries = describePortAvailability({ configured: false, capabilities: null });
    expect(entries).toHaveLength(8);
    expect(new Set(entries.map((entry) => entry.port))).toEqual(
      new Set(['host', 'conversation', 'memory', 'action', 'context', 'avatarRenderer', 'presentationMode', 'characterProfile'])
    );
    expect(describePortAvailability({ configured: true, capabilities: null })).toHaveLength(8);
  });

  it('渲染 seam：已注册 rendererId 精确命中，未知 rendererId 回退且显式不精确（未知不当可用）', () => {
    const known = resolveAvatarRenderer('xiaoqi-svg-v1');
    expect(known.exact).toBe(true);
    expect(known.reason).toBeNull();
    expect(known.renderer.rendererId).toBe('xiaoqi-svg-v1');

    const unknown = resolveAvatarRenderer('live2d-v0-not-registered');
    expect(unknown.exact).toBe(false);
    expect(unknown.reason).toContain('未注册');
    expect(unknown.renderer.rendererId).toBe(AVATAR_RENDERERS[0]?.rendererId);
    // 旧接口语义保持：select 只取 renderer，回退行为与 resolve 一致。
    expect(selectAvatarRenderer('live2d-v0-not-registered').rendererId).toBe(unknown.renderer.rendererId);
  });

  it('渲染驱动声明与实现相称：原创出处、合成预算、支持态非空', () => {
    expect(AVATAR_RENDERERS.length).toBeGreaterThan(0);
    for (const renderer of AVATAR_RENDERERS) {
      expect(renderer.rendererId.length).toBeGreaterThan(0);
      expect(renderer.supportedStates.length).toBeGreaterThan(0);
      expect(renderer.budget.compositedOnly).toBe(true);
      expect(renderer.budget.respectReducedMotion).toBe(true);
      expect(renderer.provenance.origin).toBe('original');
    }
    expect(xiaoqiSvgRenderer.rendererId).toBe('xiaoqi-svg-v1');
  });

  it('呈现 seam：未实现形态必须带 blockedBy；描述文本与契约事实一致', () => {
    for (const mode of ASTRYN_PRESENTATION_MODES) {
      const spec = modeSpec(mode);
      if (spec.implementedInM0) expect(spec.blockedBy, `${mode} 已实现不应有 blockedBy`).toBeNull();
      else expect(spec.blockedBy, `${mode} 未实现必须给 blockedBy`).toBeTruthy();
    }
    expect(ASTRYN_PRESENTATION_MODE_SPECS.map((spec) => spec.mode)).toEqual([...ASTRYN_PRESENTATION_MODES]);
    expect(() => modeSpec('hologram' as never)).toThrow(/unknown presentation mode/);

    const detail = describePortAvailability({ configured: false, capabilities: null }).find((entry) => entry.port === 'presentationMode')?.detail ?? '';
    expect(detail).toContain('embedded/panel 已实现');
    // 描述里的"已实现"名单与契约事实逐项核对，防止描述漂移。
    expect(ASTRYN_PRESENTATION_MODE_SPECS.filter((spec) => spec.implementedInM0).map((spec) => spec.mode)).toEqual(['embedded', 'panel']);
  });

  it('档案 seam：宿主持久化缺项标注 BLOCKED_BY_HOST_CONTRACT，且不冒充已接', () => {
    const entry = describePortAvailability({ configured: false, capabilities: null }).find((item) => item.port === 'characterProfile');
    expect(entry?.available).toBe(true); // 自有本地回退存储可用
    expect(entry?.detail).toContain('BLOCKED_BY_HOST_CONTRACT');
    expect(entry?.detail).toContain('BE06');
  });
});

describe('边界守卫：launch token 只存在于适配器层', () => {
  const repoRoot = process.cwd();

  function collectSourceFiles(roots: readonly string[]): string[] {
    const files: string[] = [];
    for (const root of roots) {
      const stack = [path.join(repoRoot, root)];
      while (stack.length > 0) {
        const current = stack.pop() as string;
        for (const item of readdirSync(current, { withFileTypes: true })) {
          const full = path.join(current, item.name);
          if (item.isDirectory()) {
            if (item.name === 'node_modules' || item.name.startsWith('.')) continue;
            stack.push(full);
          } else if (/\.(ts|tsx)$/.test(item.name)) {
            files.push(path.relative(repoRoot, full).split(path.sep).join('/'));
          }
        }
      }
    }
    return files;
  }

  it('头名字面量在非测试代码中只出现在宿主适配器一处', () => {
    const files = collectSourceFiles(['src', 'dev-host', 'contracts']);
    const carriers = files.filter((file) => /x-archeaxis-launch-token/i.test(readFileSync(path.join(repoRoot, file), 'utf8')));
    expect(carriers).toEqual(['src/adapters/aaos-bridge.ts']);
  });

  it('任何 launchToken 处理都不得出现在 presentation 与 dev-host 组件层（React 不碰凭据）', () => {
    const files = collectSourceFiles(['src', 'dev-host', 'contracts']);
    const carriers = files.filter((file) => /launchToken|launch_token/i.test(readFileSync(path.join(repoRoot, file), 'utf8')));
    expect(carriers.length).toBeGreaterThan(0); // 适配器里必须有（seam 存在）
    for (const file of carriers) expect(file.startsWith('src/adapters/'), `${file} 不应处理 launch token`).toBe(true);
  });
});

describe('八端口清单与契约枚举同源', () => {
  it('端口清单是数据而不是分支：每个宿主边都带能力候选键', () => {
    const hostBacked = ASTRYN_PORT_MANIFEST.filter((entry) => entry.owner === 'host');
    expect(hostBacked.map((entry) => entry.port)).toEqual(['host', 'conversation', 'memory', 'action', 'context']);
    for (const entry of hostBacked.filter((item) => item.port !== 'host')) {
      for (const candidate of entry.hostCapabilityCandidates) expect(candidate.trim()).toBe(candidate);
    }
  });
});
