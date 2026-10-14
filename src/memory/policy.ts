import { ASTRYN_MEMORY_CONSUMER_FORBIDDEN } from '@astryn/contracts';
import type {
  AstrynMemoryCandidate,
  AstrynMemoryConsumer,
  AstrynMemoryDenialReason,
  AstrynMemoryScope,
  AstrynMemoryScopeGrant
} from '@astryn/contracts';

export type MemoryDecision = { readonly allowed: true } | { readonly allowed: false; readonly reason: AstrynMemoryDenialReason };

function grantAllows(grants: readonly AstrynMemoryScopeGrant[], scope: AstrynMemoryScope, mode: 'read' | 'write', now: string): boolean {
  return grants.some(
    (grant) =>
      grant.scope === scope &&
      (mode === 'read' ? grant.read : grant.write) &&
      (grant.expiresAt === null || Date.parse(grant.expiresAt) > Date.parse(now))
  );
}

/** 消费方 × 作用域 的静态禁止表优先于任何授权：即使误授予也读不到。 */
export function decideRead(
  consumer: AstrynMemoryConsumer,
  scope: AstrynMemoryScope,
  grants: readonly AstrynMemoryScopeGrant[],
  now: string
): MemoryDecision {
  if (scope === 'companion_private' && consumer !== 'companion' && consumer !== 'ui') {
    return { allowed: false, reason: 'PRIVATE_CONTENT_NOT_SHAREABLE' };
  }
  if (ASTRYN_MEMORY_CONSUMER_FORBIDDEN[consumer].includes(scope)) {
    return { allowed: false, reason: 'CONSUMER_FORBIDDEN_FOR_SCOPE' };
  }
  if (!grantAllows(grants, scope, 'read', now)) return { allowed: false, reason: 'SCOPE_NOT_GRANTED' };
  return { allowed: true };
}

export function decideWrite(scope: AstrynMemoryScope, grants: readonly AstrynMemoryScopeGrant[], now: string): MemoryDecision {
  if (!grantAllows(grants, scope, 'write', now)) return { allowed: false, reason: 'SCOPE_NOT_GRANTED' };
  return { allowed: true };
}

/**
 * 生命周期迁移规则。虚构剧情永不可晋升；撤销与删除是治理动作，
 * 任何作用域都允许（用户可查看/编辑/删除自己的数据）。
 *
 * 确认（confirmed）的"宿主回执"判定为可信签发方名单近似，而非签名校验（审计 A11）：
 * 模型生成内容要求名单包含 'aaos-core'（宿主回执签发方的代表）；名单为空即
 * 宿主合同未接通，返回 HOST_CONTRACT_MISSING。真实签名校验在宿主适配器
 * （verify）一侧——合成夹具不持有宿主密钥，其自签 receiptId 只能证明
 * "走了同一条治理路径"，不构成真实授权证据。
 */
export function decideLifecycle(
  candidate: AstrynMemoryCandidate,
  to: 'confirmed' | 'revoked' | 'deleted',
  trustedIssuers: readonly string[]
): MemoryDecision {
  if (to === 'confirmed') {
    if (candidate.scope === 'character_fiction') return { allowed: false, reason: 'FICTION_NOT_PROMOTABLE_TO_FACT' };
    if (candidate.lifecycle === 'deleted') return { allowed: false, reason: 'SCOPE_NOT_GRANTED' };
    if (candidate.origin === 'model-generated' && !trustedIssuers.includes('aaos-core')) {
      return { allowed: false, reason: 'HOST_CONTRACT_MISSING' };
    }
    return { allowed: true };
  }
  if (candidate.lifecycle === 'deleted') return { allowed: false, reason: 'SCOPE_NOT_GRANTED' };
  return { allowed: true };
}
