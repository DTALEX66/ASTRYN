/**
 * 宿主握手与八端口可用性（GF04）。
 *
 * 三条铁律（任务包验收逐字对应）：
 *  1. 未接端口返回明确原因，未知不当可用（fail-closed：读不到/不认识 = 不可用）。
 *  2. 不能以非空回执或 digest 充当数字签名；没有校验器不冒充验证（见 AaosHostBridge.verify）。
 *  3. 握手核对版本、能力、范围与身份；原样保留宿主自报字段，不推断、不补齐。
 *
 * 本模块是纯函数集合：不发起网络请求（传输归 AaosHostBridge），
 * 解析规则全部可被单元测试用固定夹具驱动。
 */

import type {
  AstrynHostCapabilities,
  AstrynHostCapabilityReading,
  AstrynHostUnavailable
} from '@astryn/contracts';

export type AstrynPortId =
  | 'host'
  | 'conversation'
  | 'memory'
  | 'action'
  | 'context'
  | 'avatarRenderer'
  | 'presentationMode'
  | 'characterProfile';

export interface AstrynPortManifestEntry {
  readonly port: AstrynPortId;
  readonly label: string;
  readonly owner: 'host' | 'astryn';
  /**
   * 该端口依赖的宿主能力注册表键名候选（已知端点族的别名）。
   * 命中要求宿主注册表里存在 enabled 且可读的对应项；一个都不命中 → 不可用。
   * 真实键名待宿主握手回填（GF10），在未确认前一律 fail-closed。
   */
  readonly hostCapabilityCandidates: readonly string[];
}

export const ASTRYN_PORT_MANIFEST: readonly AstrynPortManifestEntry[] = [
  { port: 'host', label: '宿主入口 AstrynHostPort', owner: 'host', hostCapabilityCandidates: [] },
  { port: 'conversation', label: '会话 AstrynConversationPort', owner: 'host', hostCapabilityCandidates: ['conversation', 'machine_answers', 'machine.answers', 'machine-answers'] },
  { port: 'memory', label: '记忆 AstrynMemoryPort', owner: 'host', hostCapabilityCandidates: ['memory', 'knowledge', 'knowledge_items', 'knowledge-items'] },
  { port: 'action', label: '动作 AstrynActionPort', owner: 'host', hostCapabilityCandidates: ['actions', 'action', 'jobs'] },
  { port: 'context', label: '上下文 AstrynContextPort', owner: 'host', hostCapabilityCandidates: ['context', 'contexts', 'context_packets', 'context-packets'] },
  { port: 'avatarRenderer', label: '角色渲染 AstrynAvatarRenderer', owner: 'astryn', hostCapabilityCandidates: [] },
  { port: 'presentationMode', label: '呈现形态 AstrynPresentationMode', owner: 'astryn', hostCapabilityCandidates: [] },
  { port: 'characterProfile', label: '人物档案 AstrynCharacterProfile', owner: 'astryn', hostCapabilityCandidates: [] }
] as const;

export interface AstrynPortAvailability {
  readonly port: AstrynPortId;
  readonly label: string;
  readonly owner: 'host' | 'astryn';
  readonly available: boolean;
  /** available=false 时必须非空：未接的明确原因。 */
  readonly reason: string | null;
  /** 判定依据（注册表原文或固定说明）。 */
  readonly detail: string;
}

/** 宿主 api_contract 的兼容主版本；版本串比较只看主版本前导。 */
export function isCompatibleHostContract(observed: string): boolean {
  return /^1(\.|$)/.test(observed.trim());
}

export interface AstrynHostVersionReading {
  readonly hostBuildIdentity: string | null;
  readonly observedProtocol: string | null;
  readonly hostRuntime: string | null;
}

/** 版本面解析：只读不猜，字段缺失保持 null。 */
export function interpretVersionPayload(body: unknown): AstrynHostVersionReading {
  if (typeof body !== 'object' || body === null) {
    return { hostBuildIdentity: null, observedProtocol: null, hostRuntime: null };
  }
  const record = body as Record<string, unknown>;
  const asString = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null);
  return {
    hostBuildIdentity: asString(record.version),
    observedProtocol: asString(record.api_contract) ?? asString(record.protocol),
    hostRuntime: asString(record.runtime)
  };
}

/**
 * 能力注册表解析。注册表形态按 AAOS_HAND_VERIFIED 记录允许两种：
 * 数组本体，或 { capabilities: [...] } 包装。条目的 enabled/health 原文进 detail。
 * enabled 缺失/非布尔、或无法识别的条目 → UNKNOWN（不得猜测为可用）。
 */
export function interpretCapabilityRegistry(body: unknown): readonly AstrynHostCapabilityReading[] {
  const list = Array.isArray(body)
    ? body
    : typeof body === 'object' && body !== null && Array.isArray((body as Record<string, unknown>).capabilities)
      ? ((body as Record<string, unknown>).capabilities as unknown[])
      : null;
  if (!list) return [];
  const readings: AstrynHostCapabilityReading[] = [];
  for (const entry of list) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const name = [record.capability, record.cap, record.name, record.id].find((value) => typeof value === 'string' && value.length > 0);
    if (typeof name !== 'string') continue;
    const health = [record.health, record.state, record.status].find((value) => typeof value === 'string' && value.length > 0);
    const enabled = record.enabled;
    const detail = `capability=${name} enabled=${String(enabled)} health=${typeof health === 'string' ? health : '未报告'}`;
    let state: AstrynHostCapabilityReading['state'] = 'UNKNOWN';
    if (enabled === false) state = 'DISABLED';
    else if (typeof health === 'string' && health === 'worker_missing') state = 'WORKER_MISSING';
    else if (enabled === true) state = 'AVAILABLE_UNVERIFIED';
    readings.push({ capability: name, state, detail });
  }
  return readings;
}

export function readingFor(readings: readonly AstrynHostCapabilityReading[], candidates: readonly string[]): AstrynHostCapabilityReading | null {
  for (const candidate of candidates) {
    const found = readings.find((reading) => reading.capability === candidate);
    if (found) return found;
  }
  return null;
}

/**
 * 八端口可用性推导。host 端口以外的五个宿主端口只有在
 * 协议已确认 && 注册表命中 AVAILABLE_UNVERIFIED 时才可用；
 * DISABLED / WORKER_MISSING / UNKNOWN / 未命中 → 全部不可用并带原始依据。
 * 三个 ASTRYN 自有 seam 本地可用，但按各自真实能力标注 detail（不夸大）。
 */
export function describePortAvailability(input: {
  readonly configured: boolean;
  readonly capabilities: AstrynHostCapabilities | AstrynHostUnavailable | null;
}): readonly AstrynPortAvailability[] {
  const caps = input.capabilities && !('available' in input.capabilities) ? input.capabilities : null;
  const unavailable = input.capabilities && 'available' in input.capabilities ? input.capabilities : null;
  const hostReason = !input.configured
    ? 'AAOS Core 地址未配置：HOST_CONTRACT_MISSING（星栖不猜测宿主现场）'
    : unavailable
      ? `${unavailable.code}：${unavailable.detail}`
      : null;

  const hostBacked = (port: AstrynPortId, flag: boolean, candidates: readonly string[]): AstrynPortAvailability => {
    const entry = ASTRYN_PORT_MANIFEST.find((item) => item.port === port) as AstrynPortManifestEntry;
    if (hostReason) return { port, label: entry.label, owner: 'host', available: false, reason: hostReason, detail: '宿主不可用' };
    if (!caps) return { port, label: entry.label, owner: 'host', available: false, reason: '宿主能力未探测：未知不当可用', detail: '尚未 probeCapabilities' };
    if (!caps.protocolConfirmed) {
      return {
        port, label: entry.label, owner: 'host', available: false,
        reason: `宿主未报告兼容的 api_contract（observed=${caps.observedProtocol ?? '未报告'}）：协议未确认，未知不当可用`,
        detail: '需宿主在版本面报告 api_contract 主版本 1'
      };
    }
    const reading = readingFor(caps.capabilityRegistry, candidates);
    if (!flag || !reading) {
      return {
        port, label: entry.label, owner: 'host', available: false,
        reason: reading ? `能力注册表状态 ${reading.state}：${reading.detail}` : `注册表未出现该能力（候选 ${candidates.join('/')}）：未知不当可用`,
        detail: caps.capabilityRegistryNote ?? (reading?.detail ?? '无对应注册表条目')
      };
    }
    return { port, label: entry.label, owner: 'host', available: true, reason: null, detail: reading.detail };
  };

  const astrynOwned = (port: AstrynPortId, detail: string): AstrynPortAvailability => {
    const entry = ASTRYN_PORT_MANIFEST.find((item) => item.port === port) as AstrynPortManifestEntry;
    return { port, label: entry.label, owner: 'astryn', available: true, reason: null, detail };
  };

  return [
    {
      port: 'host', label: ASTRYN_PORT_MANIFEST[0]?.label ?? '宿主入口', owner: 'host',
      available: input.configured && caps !== null,
      reason: hostReason ?? (caps ? null : '宿主能力未探测：未知不当可用'),
      detail: caps ? `runtime=${caps.hostRuntime ?? '未报告'} identity=${caps.hostBuildIdentity ?? '未报告'}` : '未配置或未探测'
    },
    hostBacked('conversation', caps?.conversation ?? false, ASTRYN_PORT_MANIFEST[1]?.hostCapabilityCandidates ?? []),
    hostBacked('memory', caps?.memory ?? false, ASTRYN_PORT_MANIFEST[2]?.hostCapabilityCandidates ?? []),
    hostBacked('action', caps?.actions ?? false, ASTRYN_PORT_MANIFEST[3]?.hostCapabilityCandidates ?? []),
    hostBacked('context', caps?.context ?? false, ASTRYN_PORT_MANIFEST[4]?.hostCapabilityCandidates ?? []),
    astrynOwned('avatarRenderer', 'ASTRYN 自有渲染 seam；未注册的 rendererId 回退并显式标注 data-renderer-exact=false'),
    astrynOwned('presentationMode', 'ASTRYN 自有呈现 seam；未实现形态带 blockedBy 原因（embedded/panel 已实现）'),
    astrynOwned('characterProfile', '仅进程内回退存储；宿主持久化 BLOCKED_BY_HOST_CONTRACT（character.profile.read/write，BE06）')
  ];
}
