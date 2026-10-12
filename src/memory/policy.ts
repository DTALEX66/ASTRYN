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
 * 生命周期迁移规则。虚构剧情永不可晋升；模型生成内容必须经宿主回执才可确认；
 * 撤销与删除是治理动作，任何作用域都允许（用户可查看/编辑/删除自己的数据）。
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

export function scopesOf(grants: readonly AstrynMemoryScopeGrant[]): readonly AstrynMemoryScope[] {
  return grants.filter((grant) => grant.read).map((grant) => grant.scope);
}
