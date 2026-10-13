/**
 * 多形态呈现契约。声明全部目标形态，但只有 implementedInM0=true 的形态
 * 才算本轮交付；浏览器预览不等于原生悬浮窗或桌宠。
 */

export const ASTRYN_PRESENTATION_MODES = [
  'embedded',
  'panel',
  'floating',
  'pet',
  'voice-only'
] as const;
export type AstrynPresentationMode = (typeof ASTRYN_PRESENTATION_MODES)[number];

export type AstrynWindowRequirement = 'none' | 'browser-overlay' | 'native-window' | 'audio-only';

export interface AstrynPresentationModeSpec {
  readonly mode: AstrynPresentationMode;
  readonly label: string;
  readonly windowRequirement: AstrynWindowRequirement;
  readonly implementedInM0: boolean;
  readonly blockedBy: string | null;
}

export const ASTRYN_PRESENTATION_MODE_SPECS: readonly AstrynPresentationModeSpec[] = [
  { mode: 'embedded', label: '嵌入 AAOS 页面', windowRequirement: 'none', implementedInM0: true, blockedBy: null },
  { mode: 'panel', label: '侧栏角色与对话', windowRequirement: 'none', implementedInM0: true, blockedBy: null },
  { mode: 'floating', label: '独立悬浮角色窗口', windowRequirement: 'native-window', implementedInM0: false, blockedBy: '需要 Tauri 窗口与置顶/穿透能力，属 P2' },
  { mode: 'pet', label: '低干扰桌面宠物', windowRequirement: 'native-window', implementedInM0: false, blockedBy: '需要原生窗口、托盘与拖拽，属 P2' },
  { mode: 'voice-only', label: '仅语音与状态反馈', windowRequirement: 'audio-only', implementedInM0: false, blockedBy: '需要 AAOS ASR/TTS 服务，属 P2' }
];

export function modeSpec(mode: AstrynPresentationMode): AstrynPresentationModeSpec {
  const found = ASTRYN_PRESENTATION_MODE_SPECS.find((spec) => spec.mode === mode);
  if (!found) throw new Error(`unknown presentation mode: ${mode}`);
  return found;
}

/**
 * 宿主集成槽位（GF08）：主页、阅读嵌入、侧边面板三处挂载共用同一会话服务。
 * 槽位只决定"用什么模式、用什么取景档、尺寸看哪个令牌"；它不拥有会话，
 * 会话归属于宿主传入的共享管理器（见集成交接说明 docs/companion/GF08-SLOTS-AND-HANDOFF.md）。
 */
export const ASTRYN_HOST_SLOTS = ['home', 'reading', 'sidebar'] as const;
export type AstrynHostSlot = (typeof ASTRYN_HOST_SLOTS)[number];

export interface AstrynHostSlotSpec {
  readonly slot: AstrynHostSlot;
  readonly label: string;
  readonly mode: Extract<AstrynPresentationMode, 'embedded' | 'panel'>;
  /** 取景档 id（src/avatar/render-profiles.ts 的 AVATAR_VIEW_PROFILES 键）。 */
  readonly avatarView: 'hero' | 'avatar' | 'sidebar';
  /** 该槽位的角色大小令牌：宿主可在容器上覆盖此变量，不改组件代码。 */
  readonly avatarSizeToken: string;
  /** 该槽位的对话区高度令牌。 */
  readonly logHeightToken: string;
}

export const ASTRYN_HOST_SLOT_SPECS: readonly AstrynHostSlotSpec[] = [
  {
    slot: 'home',
    label: '主页嵌入',
    mode: 'embedded',
    avatarView: 'hero',
    avatarSizeToken: '--astryn-avatar-size-home',
    logHeightToken: '--astryn-log-height-home'
  },
  {
    slot: 'reading',
    label: '阅读嵌入',
    mode: 'embedded',
    avatarView: 'sidebar',
    avatarSizeToken: '--astryn-avatar-size-reading',
    logHeightToken: '--astryn-log-height-reading'
  },
  {
    slot: 'sidebar',
    label: '侧边面板',
    mode: 'panel',
    avatarView: 'sidebar',
    avatarSizeToken: '--astryn-avatar-size-sidebar',
    logHeightToken: '--astryn-log-height-sidebar'
  }
];

export function hostSlotSpec(slot: AstrynHostSlot): AstrynHostSlotSpec {
  const found = ASTRYN_HOST_SLOT_SPECS.find((spec) => spec.slot === slot);
  if (!found) throw new Error(`unknown host slot: ${slot}`);
  return found;
}

/** 专注呈现令牌（GF08）：用户专注时角色与对话区收敛；宿主可覆盖这两个变量的数值。 */
export const ASTRYN_FOCUS_PRESENTATION_TOKENS = {
  avatarSize: '--astryn-avatar-size-focus',
  logHeight: '--astryn-log-height-focus'
} as const;

/** 隐藏态足迹令牌：角色隐藏后保留的精简高度。 */
export const ASTRYN_HIDDEN_FOOTPRINT_TOKEN = '--astryn-hidden-min-height';
