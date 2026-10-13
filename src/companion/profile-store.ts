import { ASTRYN_PROFILE_STORAGE, XIAOQI_PROFILE, migrateCharacterProfile } from '@astryn/contracts';
import type { AstrynCharacterProfile } from '@astryn/contracts';

/** 档案保存去向：正式版归宿主（BE06）；ASTRYN 侧只有进程内开发回退。 */
export interface AstrynProfileStore {
  readonly kind: 'ephemeral-dev' | 'host-blocked';
  /** 给配置界面显示的去向说明，不含实现细节。 */
  readonly label: string;
  readonly persistent: boolean;
  load(): Promise<AstrynProfileLoad>;
  /**
   * 乐观并发：expectedRevision 与当前存档不一致时拒绝写入，
   * 避免两个入口（如设置面板与会话内覆盖）互相覆盖。
   */
  save(profile: AstrynCharacterProfile, expectedRevision: number): Promise<AstrynProfileSave>;
}

export interface AstrynProfileLoad {
  readonly profile: AstrynCharacterProfile;
  /** 返回档案的来源说明，供界面与日志如实标注。 */
  readonly note: 'LOADED' | 'EMPTY_DEFAULT' | 'MIGRATED_V1_TO_V2' | 'INVALID_FALLBACK' | 'HOST_UNAVAILABLE_DEFAULT';
}

export type AstrynProfileSave =
  | { readonly ok: true; readonly profile: AstrynCharacterProfile }
  | { readonly ok: false; readonly reason: 'REVISION_CONFLICT'; readonly currentRevision: number }
  | { readonly ok: false; readonly reason: 'UNAVAILABLE'; readonly message: string };

/**
 * 开发回退存储：进程内内存，刷新即失。
 * 不落浏览器本地持久化、也不落文件——那会造出第二份档案库的雏形（边界测试按默认权限禁止）。
 */
export function createEphemeralProfileStore(seed?: unknown): AstrynProfileStore {
  let stored: AstrynCharacterProfile | null = null;
  let loadNote: AstrynProfileLoad['note'] = 'EMPTY_DEFAULT';

  if (seed !== undefined) {
    const migrated = migrateCharacterProfile(seed);
    stored = migrated.profile;
    loadNote = migrated.note === null ? 'LOADED' : migrated.note;
  }

  return {
    kind: 'ephemeral-dev',
    label: `进程内（开发回退）· ${ASTRYN_PROFILE_STORAGE.devFallback}`,
    persistent: false,
    async load(): Promise<AstrynProfileLoad> {
      if (stored === null) return { profile: XIAOQI_PROFILE, note: 'EMPTY_DEFAULT' };
      return { profile: stored, note: loadNote };
    },
    async save(profile: AstrynCharacterProfile, expectedRevision: number): Promise<AstrynProfileSave> {
      const currentRevision = (stored ?? XIAOQI_PROFILE).profileRevision;
      if (currentRevision !== expectedRevision) {
        return { ok: false, reason: 'REVISION_CONFLICT', currentRevision };
      }
      const next: AstrynCharacterProfile = { ...profile, profileRevision: expectedRevision + 1 };
      stored = next;
      loadNote = 'LOADED';
      return { ok: true, profile: next };
    }
  };
}

/**
 * 正式存储端口：宿主合同（character.profile.read/write，BE06）尚未正式登记，
 * 当前一切 load/save 都显式失败或回退默认，绝不假装保存成功。
 */
export function createHostProfileStore(): AstrynProfileStore {
  const dependency = `${ASTRYN_PROFILE_STORAGE.operations.join(' / ')}（BE06）· ${ASTRYN_PROFILE_STORAGE.admission}`;
  return {
    kind: 'host-blocked',
    label: `宿主存储（${ASTRYN_PROFILE_STORAGE.owner}）· 未接通`,
    persistent: true,
    async load(): Promise<AstrynProfileLoad> {
      return { profile: XIAOQI_PROFILE, note: 'HOST_UNAVAILABLE_DEFAULT' };
    },
    async save(): Promise<AstrynProfileSave> {
      return {
        ok: false,
        reason: 'UNAVAILABLE',
        message: `BLOCKED_BY_HOST_CONTRACT：${dependency}`
      };
    }
  };
}
