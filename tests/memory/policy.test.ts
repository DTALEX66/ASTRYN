import { describe, expect, it } from 'vitest';
import { SyntheticMemoryFixture, decideLifecycle, decideRead, decideWrite } from '@astryn/core';
import type { MemoryDecision } from '@astryn/core';
import type { AstrynMemoryCandidate, AstrynMemoryScopeGrant } from '@astryn/contracts';

/** 拒绝必须有原因；放行则直接让测试失败，避免"undefined 也等于通过"。 */
function denialReason(decision: MemoryDecision): string {
  if (decision.allowed) throw new Error('期望被拒绝，实际被放行');
  return decision.reason;
}

const NOW = '2026-10-13T00:00:00.000Z';
const grant = (scope: string, overrides: Partial<AstrynMemoryScopeGrant> = {}): AstrynMemoryScopeGrant => ({
  scope: scope as AstrynMemoryScopeGrant['scope'],
  read: true,
  write: true,
  grantedBy: 'user',
  grantedAt: NOW,
  expiresAt: null,
  ...overrides
});

const candidate = (overrides: Partial<AstrynMemoryCandidate>): AstrynMemoryCandidate => ({
  schemaVersion: 1,
  id: 'c1',
  scope: 'companion_private',
  origin: 'user-stated',
  lifecycle: 'candidate',
  summary: 's',
  sessionId: 's1',
  requestId: null,
  createdAt: NOW,
  confidence: null,
  confirmedByReceiptId: null,
  consentRecordId: null,
  ...overrides
});

describe('记忆作用域与生命周期（A11）', () => {
  it('任务与知识模块读不到私密陪伴内容', () => {
    const grants = [grant('companion_private'), grant('user_preference')];
    expect(decideRead('task', 'companion_private', grants, NOW)).toEqual({ allowed: false, reason: 'PRIVATE_CONTENT_NOT_SHAREABLE' });
    expect(decideRead('knowledge', 'companion_private', grants, NOW).allowed).toBe(false);
    expect(decideRead('companion', 'companion_private', grants, NOW).allowed).toBe(true);
  });

  it('未获准作用域即使策略允许也读不到；过期授权失效', () => {
    expect(denialReason(decideRead('companion', 'user_preference', [], NOW))).toBe('SCOPE_NOT_GRANTED');
    const expired = [grant('user_preference', { expiresAt: '2026-01-01T00:00:00.000Z' })];
    expect(denialReason(decideRead('companion', 'user_preference', expired, NOW))).toBe('SCOPE_NOT_GRANTED');
    expect(decideWrite('user_preference', expired, NOW).allowed).toBe(false);
  });

  it('虚构剧情不可晋升为事实', () => {
    const fiction = candidate({ scope: 'character_fiction', origin: 'model-generated' });
    expect(decideLifecycle(fiction, 'confirmed', ['aaos-core'])).toEqual({ allowed: false, reason: 'FICTION_NOT_PROMOTABLE_TO_FACT' });
  });

  it('模型生成的候选必须经宿主确认，星栖不能自我加冕', () => {
    const modelMade = candidate({ scope: 'verified_fact', origin: 'model-generated' });
    expect(denialReason(decideLifecycle(modelMade, 'confirmed', ['somebody-else']))).toBe('HOST_CONTRACT_MISSING');
    expect(decideLifecycle(modelMade, 'confirmed', ['aaos-core']).allowed).toBe(true);
  });

  it('夹具端到端：越权查询被拒、候选可撤销与删除、dispose 后清空', async () => {
    const memory = new SyntheticMemoryFixture({ now: () => NOW });
    const privateOutcome = await memory.propose({ scope: 'companion_private', origin: 'user-stated', summary: '今天很难受', sessionId: 's1' });
    expect(privateOutcome.ok).toBe(true);
    await memory.propose({ scope: 'character_fiction', origin: 'model-generated', summary: '我们一起看过海', sessionId: 's1' });

    const asCompanion = await memory.query({ consumer: 'companion', scopes: ['companion_private'] });
    expect(asCompanion.ok).toBe(true);
    if (asCompanion.ok) {
      expect(asCompanion.evidenceLevel).toBe('SYNTHETIC');
      expect(asCompanion.records).toHaveLength(1);
    }

    const asTask = await memory.query({ consumer: 'task', scopes: ['companion_private'] });
    expect(asTask.ok).toBe(false);
    if (!asTask.ok) expect(asTask.reason).toBe('PRIVATE_CONTENT_NOT_SHAREABLE');
    const taskFiction = await memory.query({ consumer: 'task', scopes: ['character_fiction'] });
    expect(taskFiction.ok).toBe(false);
    if (!taskFiction.ok) expect(taskFiction.reason).toBe('CONSUMER_FORBIDDEN_FOR_SCOPE');

    const fiction = (await memory.query({ consumer: 'companion', scopes: ['character_fiction'] }));
    expect(fiction.ok).toBe(true);
    if (fiction.ok) {
      const promotion = await memory.confirm({ receiptId: 'r1', candidateId: fiction.records[0]?.id ?? '', to: 'confirmed', issuedBy: 'aaos-core', issuedAt: NOW });
      expect(promotion.ok).toBe(false);
      if (!promotion.ok) expect(promotion.reason).toBe('FICTION_NOT_PROMOTABLE_TO_FACT');
    }

    if (privateOutcome.ok) {
      const revoked = await memory.revoke({ receiptId: 'r2', candidateId: privateOutcome.candidate.id, to: 'revoked', issuedBy: 'aaos-core', issuedAt: NOW });
      expect(revoked.ok).toBe(true);
      const deleted = await memory.delete({ receiptId: 'r3', candidateId: privateOutcome.candidate.id, to: 'deleted', issuedBy: 'aaos-core', issuedAt: NOW });
      expect(deleted.ok).toBe(true);
    }
    expect(await memory.listForReview('s1')).toHaveLength(1);

    memory.dispose();
    const afterDispose = await memory.query({ consumer: 'companion', scopes: ['companion_private'] });
    expect(afterDispose.ok).toBe(false);
  });

  it('命中消费方禁止表：任务/知识读虚构剧情被拒，即使持有授权也读不到', () => {
    // 静态禁止表优先于任何授权：故意给足授权，证明拒绝不来自"没授权"。
    const grants = [grant('character_fiction'), grant('companion_private')];
    expect(denialReason(decideRead('task', 'character_fiction', grants, NOW))).toBe('CONSUMER_FORBIDDEN_FOR_SCOPE');
    expect(denialReason(decideRead('knowledge', 'character_fiction', grants, NOW))).toBe('CONSUMER_FORBIDDEN_FOR_SCOPE');
    // 正控制：同一作用域对陪伴自身可读——拒绝是消费方维度的，不是作用域被全局封死。
    expect(decideRead('companion', 'character_fiction', grants, NOW).allowed).toBe(true);
  });

  it('无可信宿主合同时：模型生成候选不可确认，回执自报签发方不作数', async () => {
    const memory = new SyntheticMemoryFixture({ now: () => NOW, trustedIssuers: [] });
    const outcome = await memory.propose({ scope: 'verified_fact', origin: 'model-generated', summary: '我记住了', sessionId: 's1' });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('unreachable');
    expect(outcome.candidate.lifecycle).toBe('candidate');
    const byModel = await memory.confirm({ receiptId: 'r9', candidateId: outcome.candidate.id, to: 'confirmed', issuedBy: 'model', issuedAt: NOW });
    expect(byModel.ok).toBe(false);
    if (!byModel.ok) expect(byModel.reason).toBe('HOST_CONTRACT_MISSING');
    // 门禁读的是配置下的可信签发表而非 receipt.issuedBy：自称 aaos-core 的同一回执同样被拒。
    const byClaimedCore = await memory.confirm({ receiptId: 'r10', candidateId: outcome.candidate.id, to: 'confirmed', issuedBy: 'aaos-core', issuedAt: NOW });
    expect(byClaimedCore.ok).toBe(false);
    if (!byClaimedCore.ok) expect(byClaimedCore.reason).toBe('HOST_CONTRACT_MISSING');
    // 两次被拒后候选仍在，等待真实宿主合同接通。
    expect(await memory.listForReview('s1')).toHaveLength(1);
  });
});
