import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ASTRYN_CONVERSATION_STATES, ASTRYN_TASK_STATES, XIAOQI_PROFILE } from '@astryn/contracts';
import { AVATAR_RENDERERS, AVATAR_VIEW_PROFILES } from '@astryn/core';

/**
 * 角色资产清单门禁（GF03）：
 * 清单是"运行时用什么资产、权利是什么、升级到哪一步"的登记处；
 * 这个测试保证清单与代码常量不会静默漂移、落库字节与登记哈希一致、
 * 派生链完整，且验收红线（真人素材）不被写掉。
 */
const repoRoot = process.cwd();
const manifest = JSON.parse(readFileSync(join(repoRoot, 'assets/character/STATE-ASSET-INDEX.json'), 'utf8')) as {
  schema: string;
  character: { id: string };
  provenance: { origin: string; realPersonReference: boolean; note: string; knownGaps: string[] };
  runtime: {
    defaultRendererId: string;
    renderers: Array<{ rendererId: string; role: string; source: string }>;
    renderProfiles: string[];
  };
  states: string[];
  versions: Array<{
    id: string;
    status: string;
    targetDir?: string;
    deliveryRule?: string;
    brief?: string;
    deliveryList?: string;
    deliveryListBytes?: number;
    deliveryListSha256?: string;
    files?: Array<{
      path: string;
      bytes: number;
      sha256: string;
      role: string;
      state?: string;
      runtimeUsable: boolean;
    }>;
    derived?: Array<{
      path: string;
      name: string;
      bytes: number;
      sha256: string;
      forState: string;
      kind?: string;
      sourcePath: string;
      sourceSha256: string;
      algorithm: string;
      runtimeUsable: boolean;
    }>;
    candidateFrames?: Array<{
      path: string;
      name: string;
      bytes: number;
      sha256: string;
      kind: string;
      frame: string;
      sourcePath: string;
      sourceSha256: string;
      algorithm: string;
      runtimeUsable: boolean;
      status?: string;
      acceptance?: string;
    }>;
    derivedRefs?: Array<{
      path: string;
      name: string;
      bytes: number;
      sha256: string;
      kind: string;
      sourcePath: string;
      sourceSha256: string;
      algorithm: string;
      runtimeUsable: boolean;
    }>;
    gaps?: {
      decodeFailures: Array<{ state: string; taskId: string; status: string; kind?: string; retry?: string }>;
      avatarSafeArea: string;
      seedExposure: string;
      mouthFrames: string;
    };
  }>;
  superseded: { count: number; files: Array<{ file: string; bytes: number; sha256: string }> };
};

const v1 = manifest.versions.find((version) => version.id === 'v1');
const v2 = manifest.versions.find((version) => version.id === 'v2');
const supported = [...ASTRYN_CONVERSATION_STATES, ...ASTRYN_TASK_STATES.filter((state) => state !== 'none')];

function sha256Of(path: string): string {
  return createHash('sha256').update(readFileSync(join(repoRoot, path))).digest('hex');
}

describe('角色资产清单（assets/character/STATE-ASSET-INDEX.json，schema v2）', () => {
  it('schema 与角色标识正确，v1 基线保留为回退下限、v2 已交付', () => {
    expect(manifest.schema).toBe('astryn.character-assets/v2');
    expect(manifest.character.id).toBe('xiaoqi');
    expect(v1?.status).toBe('ACTIVE');
    expect(v2?.status).toBe('DELIVERED');
    expect(v2?.deliveryRule, '交付规则必须写明权利条款要求').toContain('权利');
    expect(v2?.targetDir).toBeTruthy();
    expect(existsSync(join(repoRoot, v2?.targetDir as string))).toBe(true);
    expect(existsSync(join(repoRoot, v2?.brief as string))).toBe(true);
    expect(existsSync(join(repoRoot, v2?.deliveryList as string))).toBe(true);
    // 交付清单本身是权利/参数记录的载体（D15）：登记字节与哈希，防"存在但被换过"。
    expect(readFileSync(join(repoRoot, v2?.deliveryList as string)).byteLength, '交付清单字节数漂移').toBe(
      v2?.deliveryListBytes
    );
    expect(sha256Of(v2?.deliveryList as string), '交付清单哈希漂移').toBe(v2?.deliveryListSha256);
  });

  it('状态集合与契约九态完全一致（多一个少一个都算漂移）', () => {
    expect([...manifest.states].sort()).toEqual([...supported].sort());
  });

  it('呈现档与代码常量一致', () => {
    expect([...manifest.runtime.renderProfiles].sort()).toEqual(Object.keys(AVATAR_VIEW_PROFILES).sort());
  });

  it('渲染驱动登记与代码注册表一致：默认驱动=档案默认，回退下限=注册表 index 0', () => {
    expect(manifest.runtime.renderers.map((entry) => entry.rendererId).sort()).toEqual(
      AVATAR_RENDERERS.map((renderer) => renderer.rendererId).sort()
    );
    expect(manifest.runtime.defaultRendererId).toBe(XIAOQI_PROFILE.appearance.rendererId);
    expect(manifest.runtime.renderers.find((entry) => entry.role === 'default')?.rendererId).toBe(
      manifest.runtime.defaultRendererId
    );
    expect(manifest.runtime.renderers.find((entry) => entry.role === 'fallback-floor')?.rendererId).toBe(
      AVATAR_RENDERERS[0]?.rendererId
    );
  });

  it('来源为 AI 生成并如实登记缺口，真人素材红线被明文声明', () => {
    expect(manifest.provenance.origin).toBe('ai-generated');
    expect(manifest.provenance.realPersonReference).toBe(false);
    expect(manifest.provenance.note).toContain('真人');
    expect(manifest.provenance.knownGaps.length).toBeGreaterThan(0);
  });

  it('每个落库文件与磁盘字节一致（sha256 + 字节数逐张核对）', () => {
    const files = v2?.files ?? [];
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(existsSync(join(repoRoot, file.path)), `${file.path} 不存在`).toBe(true);
      expect(readFileSync(join(repoRoot, file.path)).byteLength, `${file.path} 字节数漂移`).toBe(file.bytes);
      expect(sha256Of(file.path), `${file.path} 哈希漂移`).toBe(file.sha256);
    }
  });

  it('目录枚举：落库目录下每个 PNG 都必须登记在清单（未登记的多余图即红，C11）', () => {
    // 上一个测试是"清单 → 磁盘"；这里是反方向"磁盘 → 清单"：
    // 否则一张未登记的多余 PNG 落进 upgraded/v1/，所有断言仍全绿。
    const registered = new Set([
      ...(v2?.files ?? []).map((file) => file.path),
      ...(v2?.derived ?? []).map((entry) => `${entry.path}${entry.name}`),
      ...(v2?.candidateFrames ?? []).map((entry) => `${entry.path}${entry.name}`),
      ...(v2?.derivedRefs ?? []).map((entry) => `${entry.path}${entry.name}`)
    ]);
    const walk = (dir: string): string[] => {
      const entries = readdirSync(join(repoRoot, dir), { withFileTypes: true });
      const out: string[] = [];
      for (const entry of entries) {
        const path = `${dir}${entry.name}`;
        if (entry.isDirectory()) out.push(...walk(`${path}/`));
        else if (entry.name.endsWith('.png')) out.push(path);
      }
      return out;
    };
    const onDisk = walk(v2?.targetDir as string);
    expect(onDisk.length).toBeGreaterThan(0);
    // 覆盖两条支路：顶层直用件与 derived-alpha 子目录的派生件都被走到。
    expect(onDisk.some((path) => path.includes('/derived-alpha/')), '枚举未下钻 derived-alpha').toBe(true);
    expect(onDisk.some((path) => !path.includes('/derived-alpha/')), '枚举未覆盖顶层直用件').toBe(true);
    for (const path of onDisk) {
      expect(registered.has(path), `${path} 未登记在清单（未注册的落库文件）`).toBe(true);
    }
  });

  it('派生件登记完整：磁盘一致、来源链闭合、状态归属合法', () => {
    const derived = v2?.derived ?? [];
    const files = v2?.files ?? [];
    // 三张运行时过渡件（thinking/completed/failed）+ 一张 C 组体态参考件（pose_listening，不进运行时）。
    expect(derived.length).toBe(4);
    expect(derived.filter((entry) => entry.runtimeUsable).length).toBe(3);
    for (const entry of derived) {
      const path = `${entry.path}${entry.name}`;
      expect(existsSync(join(repoRoot, path)), `${path} 不存在`).toBe(true);
      expect(readFileSync(join(repoRoot, path)).byteLength, `${path} 字节数漂移`).toBe(entry.bytes);
      expect(sha256Of(path), `${path} 哈希漂移`).toBe(entry.sha256);
      // 来源链闭合：派生件的来源必须是同清单里的一张落库文件，且哈希对得上。
      const source = files.find((file) => file.path === entry.sourcePath);
      expect(source, `派生来源 ${entry.sourcePath} 未登记`).toBeTruthy();
      expect(source?.sha256).toBe(entry.sourceSha256);
      expect(manifest.states).toContain(entry.forState);
      expect(entry.algorithm.length).toBeGreaterThan(0);
    }
    // 运行时可用性白名单：只有三张状态过渡件可进运行时；pose_listening 必须保持 runtimeUsable=false。
    const runtimeDerived = derived.filter((entry) => entry.runtimeUsable).map((entry) => entry.forState);
    expect([...runtimeDerived].sort()).toEqual(['completed', 'failed', 'thinking']);
    const pose = derived.find((entry) => entry.kind === 'pose');
    expect(pose?.runtimeUsable, 'pose 参考件不得进入运行时').toBe(false);
    expect(pose?.forState).toBe('listening');
  });

  it('候选帧与参考派生件登记完整：磁盘一致、来源链闭合、验收状态如实', () => {
    const files = v2?.files ?? [];
    const candidateFrames = v2?.candidateFrames ?? [];
    expect(candidateFrames.length).toBe(3);
    for (const entry of candidateFrames) {
      const path = `${entry.path}${entry.name}`;
      expect(existsSync(join(repoRoot, path)), `${path} 不存在`).toBe(true);
      expect(readFileSync(join(repoRoot, path)).byteLength, `${path} 字节数漂移`).toBe(entry.bytes);
      expect(sha256Of(path), `${path} 哈希漂移`).toBe(entry.sha256);
      const source = files.find((file) => file.path === entry.sourcePath);
      expect(source, `候选帧来源 ${entry.sourcePath} 未登记`).toBeTruthy();
      expect(source?.sha256).toBe(entry.sourceSha256);
      expect(entry.status, '候选帧必须有验收结论').toBe('ACCEPTED_LOCAL');
      expect(entry.acceptance, '候选帧必须有验收回执路径').toContain('.project-local/runs/');
    }
    const derivedRefs = v2?.derivedRefs ?? [];
    expect(derivedRefs.length).toBeGreaterThan(0);
    for (const entry of derivedRefs) {
      const path = `${entry.path}${entry.name}`;
      expect(existsSync(join(repoRoot, path)), `${path} 不存在`).toBe(true);
      expect(readFileSync(join(repoRoot, path)).byteLength, `${path} 字节数漂移`).toBe(entry.bytes);
      expect(sha256Of(path), `${path} 哈希漂移`).toBe(entry.sha256);
      expect(entry.runtimeUsable, '参考派生件不得进入运行时').toBe(false);
      const source = files.find((file) => file.path === entry.sourcePath);
      expect(source, `参考件来源 ${entry.sourcePath} 未登记`).toBeTruthy();
      expect(source?.sha256).toBe(entry.sourceSha256);
    }
  });

  it('运行时九态各有且仅有一张可用状态图（位图直用或派生）', () => {
    const runtimeStates = [
      ...(v2?.files ?? []).filter((file) => file.role === 'state-image' && file.runtimeUsable).map((file) => file.state),
      ...(v2?.derived ?? []).filter((entry) => entry.runtimeUsable).map((entry) => entry.forState)
    ];
    expect([...runtimeStates].sort()).toEqual([...supported].sort());
    expect(new Set(runtimeStates).size, '同一状态不得有两张运行时可用的图').toBe(runtimeStates.length);
  });

  it('未落库的早期轮次只登记哈希（字节不进入正式资产目录）', () => {
    expect(manifest.superseded.count).toBe(manifest.superseded.files.length);
    expect(manifest.superseded.count).toBeGreaterThan(0);
    const landed = new Set([
      ...(v2?.files ?? []).map((file) => file.path.split('/').pop()),
      ...(v2?.derived ?? []).map((entry) => entry.name)
    ]);
    for (const entry of manifest.superseded.files) {
      expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(entry.bytes).toBeGreaterThan(0);
      expect(landed.has(entry.file), `${entry.file} 不得同时登记为已落库`).toBe(false);
    }
  });

  it('交付缺口如实登记：四张去背失败带任务号，口型/种子/安全区缺口不隐藏', () => {
    const gaps = v2?.gaps;
    expect(gaps?.decodeFailures).toHaveLength(4);
    for (const failure of gaps?.decodeFailures ?? []) {
      expect(failure.taskId).toMatch(/^tsk_[0-9a-f]+$/);
    }
    expect(gaps?.decodeFailures.filter((failure) => failure.status === 'DERIVED_LOCALLY')).toHaveLength(4);
    // 第四张（listening，pose）：本地派生已闭合，但 v1 中止史与原生 429 重试待授权必须如实保留。
    const listening = gaps?.decodeFailures.find((failure) => failure.state === 'listening');
    expect(listening?.status).toBe('DERIVED_LOCALLY');
    expect(listening?.kind).toBe('pose');
    expect(listening?.retry, 'listening 必须保留 v1 中止史与原生重试待授权').toContain('ABORTED_BG_NONUNIFORM');
    expect(listening?.retry).toContain('需显式授权');
    // 安全区已从 UNVERIFIED 升级为本地几何实测（2026-10-14），断言实测口径与证据路径。
    expect(gaps?.avatarSafeArea).toContain('MEASURED');
    expect(gaps?.avatarSafeArea).toContain('avatar-safe-area-report.json');
    expect(gaps?.seedExposure).toContain('NONE');
    // 口型帧：E 组三帧本地验收通过，但非音素口型的诚实标注不得丢。
    expect(gaps?.mouthFrames).toContain('ACCEPTED_LOCAL');
    expect(gaps?.mouthFrames).toContain('非音素');
  });
});
