import type { AstrynAvatarViewProfile } from '@astryn/contracts';

/**
 * 三种呈现档（GF03 交付：首页 / 对话头像 / 阅读侧边）。
 * 取景坐标系与渲染源一致（120×140 的腰上半身构图）：
 * - hero/sidebar 用整幅半身；avatar 裁到头肩（保留完整状态环与光晕）。
 * 外观升级（v2 位图资产）到位后只换渲染源，不改本表语义。
 */
export const AVATAR_VIEW_PROFILES = {
  hero: {
    id: 'hero',
    label: '首页主视觉',
    purpose: '首页嵌入的腰上半身主视觉',
    viewBox: [0, 0, 120, 140],
    width: 240
  },
  avatar: {
    id: 'avatar',
    label: '对话头像',
    purpose: '对话区头肩近景（保留完整状态环）',
    viewBox: [10, 16, 100, 104],
    width: 96
  },
  sidebar: {
    id: 'sidebar',
    label: '阅读侧边',
    purpose: '阅读侧边栏的竖向半身',
    viewBox: [0, 0, 120, 140],
    width: 168
  }
} as const satisfies Record<string, AstrynAvatarViewProfile>;

export type AstrynAvatarViewId = keyof typeof AVATAR_VIEW_PROFILES;

export function avatarViewProfile(id: AstrynAvatarViewId): AstrynAvatarViewProfile {
  return AVATAR_VIEW_PROFILES[id];
}

/** 呈现模式 → 默认取景档：嵌入首页用主视觉，侧栏用竖向半身。 */
export function avatarViewForMode(mode: 'embedded' | 'panel'): AstrynAvatarViewProfile {
  return mode === 'panel' ? AVATAR_VIEW_PROFILES.sidebar : AVATAR_VIEW_PROFILES.hero;
}
