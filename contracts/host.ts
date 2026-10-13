import type { AstrynActionPort } from './action';
import type { AstrynConversationPort } from './conversation';
import type { AstrynContextPort } from './context';
import type { AstrynMemoryPort } from './memory';
import type { AstrynAnyEvent } from './events';
import type { AstrynProtocolVersion } from './protocol';

/** 宿主能力声明。不支持的能力必须显式缺失，不得用假实现填补。 */
export interface AstrynHostCapabilities {
  readonly protocol: AstrynProtocolVersion;
  readonly conversation: boolean;
  readonly memory: boolean;
  readonly context: boolean;
  readonly actions: boolean;
  readonly authoritativeReceipts: boolean;
  readonly streamResume: boolean;
  readonly hostBuildIdentity: string | null;
  /** 宿主自报的 api_contract 协议串原样保留；null=宿主未报告（未知不当可用）。 */
  readonly observedProtocol: string | null;
  /** 只有宿主明确报告了兼容协议串才为 true；未报告或不可比都保持 false。 */
  readonly protocolConfirmed: boolean;
  /** 宿主自报的 runtime 标识（如 archeaxis-api）；原样保留不推断。 */
  readonly hostRuntime: string | null;
  /** 能力注册表逐项读数：enabled/health 原样映射，未知值落 UNKNOWN。 */
  readonly capabilityRegistry: readonly AstrynHostCapabilityReading[];
  /** 注册表整体不可读时的原因；null 表示读取成功。 */
  readonly capabilityRegistryNote: string | null;
}

export const ASTRYN_HOST_CAPABILITY_STATES = ['AVAILABLE_UNVERIFIED', 'DISABLED', 'WORKER_MISSING', 'UNKNOWN'] as const;
export type AstrynHostCapabilityState = (typeof ASTRYN_HOST_CAPABILITY_STATES)[number];

export interface AstrynHostCapabilityReading {
  /** 宿主注册表里报告的键名，原样保留。 */
  readonly capability: string;
  readonly state: AstrynHostCapabilityState;
  /** 判定的原始依据（enabled/health 原文），供复核。 */
  readonly detail: string;
}

export interface AstrynHostUnavailable {
  readonly available: false;
  readonly code: 'HOST_CONTRACT_MISSING' | 'AUTHORITY_REFERENCE_MISSING' | 'PROTOCOL_MISMATCH';
  readonly detail: string;
}

/** 断线恢复游标：宿主不支持 streamResume 时适配器必须返回能力缺失。 */
export interface AstrynResumeCursor {
  readonly sessionId: string;
  readonly lastAppliedSeq: number;
  readonly supported: boolean;
}

export type AstrynHostEvent = AstrynAnyEvent;

export interface AstrynGrantRequest {
  readonly sessionId: string;
  readonly scopes: readonly string[];
  readonly purpose: string;
}

/**
 * 星栖接触 AAOS 的唯一入口。所有子端口都必须经过授权，
 * 角色身份不提升权限。
 */
export interface AstrynHostPort {
  readonly hostId: string;
  readonly protocol: AstrynProtocolVersion;
  probeCapabilities(): Promise<AstrynHostCapabilities | AstrynHostUnavailable>;
  conversation(): AstrynConversationPort | null;
  memory(): AstrynMemoryPort | null;
  context(): AstrynContextPort | null;
  actions(): AstrynActionPort | null;
  requestGrant(request: AstrynGrantRequest): Promise<{ readonly granted: readonly string[]; readonly denied: readonly string[] }>;
  onAuthoritativeEvent(handler: (event: AstrynHostEvent) => void): () => void;
}
