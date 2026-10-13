import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ASTRYN_CONVERSATION_STATES, ASTRYN_TASK_STATES } from '@astryn/contracts';
import { AVATAR_VIEW_PROFILES, xiaoqiSvgRenderer } from '@astryn/core';

/**
 * 角色资产清单门禁（GF03）：
 * 清单是"运行时用什么资产、权利是什么、升级到哪一步"的登记处；
 * 这个测试保证清单与代码常量不会静默漂移，且验收红线（真人素材）不被写掉。
 */
const repoRoot = process.cwd();
const manifest = JSON.parse(readFileSync(join(repoRoot, 'assets/character/STATE-ASSET-INDEX.json'), 'utf8')) as {
  schema: string;
  character: { id: string };
  provenance: { origin: string; realPersonReference: boolean; note: string };
  runtime: { rendererId: string; renderProfiles: string[] };
  states: string[];
  versions: Array<{ id: string; status: string; targetDir?: string; deliveryRule?: string }>;
};

const supported = [...ASTRYN_CONVERSATION_STATES, ...ASTRYN_TASK_STATES.filter((state) => state !== 'none')];

describe('角色资产清单（assets/character/STATE-ASSET-INDEX.json）', () => {
  it('schema 与角色标识正确', () => {
    expect(manifest.schema).toBe('astryn.character-assets/v1');
    expect(manifest.character.id).toBe('xiaoqi');
  });

  it('状态集合与契约九态完全一致（多一个少一个都算漂移）', () => {
    expect([...manifest.states].sort()).toEqual([...supported].sort());
  });

  it('呈现档与代码常量一致', () => {
    expect([...manifest.runtime.renderProfiles].sort()).toEqual(Object.keys(AVATAR_VIEW_PROFILES).sort());
  });

  it('渲染驱动登记与代码一致', () => {
    expect(manifest.runtime.rendererId).toBe(xiaoqiSvgRenderer.rendererId);
  });

  it('来源为原创，且真人素材红线被明文声明', () => {
    expect(manifest.provenance.origin).toBe('original');
    expect(manifest.provenance.realPersonReference).toBe(false);
    expect(manifest.provenance.note).toContain('真人');
  });

  it('v1 基线保留（ACTIVE），v2 升级位显式待外部且目标目录存在', () => {
    const v1 = manifest.versions.find((version) => version.id === 'v1');
    const v2 = manifest.versions.find((version) => version.id === 'v2');
    expect(v1?.status).toBe('ACTIVE');
    expect(v2?.status).toBe('PENDING_EXTERNAL');
    expect(v2?.deliveryRule, '升级登记必须写明权利条款要求').toContain('权利');
    expect(v2?.targetDir).toBeTruthy();
    expect(existsSync(join(repoRoot, v2?.targetDir as string)), '升级落库目录应存在（占位）').toBe(true);
  });
});
