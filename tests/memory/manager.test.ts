import { describe, expect, it } from 'vitest';
import { MemoryManager, SyntheticMemoryFixture, XIAOQI_PROFILE, createEphemeralProfileStore, createLearningCompanion } from '@astryn/core';
import type {
  AstrynCandidateInput,
  AstrynMemoryCandidate,
  AstrynMemoryConsumer,
  AstrynMemoryMutationReceipt,
  AstrynMemoryPort,
  AstrynMemoryQuery,
  AstrynMemoryReadResult,
  AstrynMemoryScope
} from '@astryn/core';

const NOW = '2026-10-13T00:00:00.000Z';
const SESSION = 'gf06-session';

function setup(): { port: SyntheticMemoryFixture; manager: MemoryManager } {
  const port = new SyntheticMemoryFixture({ now: () => NOW });
  const manager = new MemoryManager({ port, sessionId: SESSION, now: () => NOW });
  return { port, manager };
}

async function activeIds(port: SyntheticMemoryFixture, scope: AstrynMemoryScope): Promise<readonly string[]> {
  const reading = await port.query({ consumer: 'companion', scopes: [scope], includeLifecycle: ['candidate', 'confirmed'] });
  if (!reading.ok) throw new Error(`query denied: ${reading.reason}`);
  return reading.records.map((record) => record.id);
}

/** 谎报端口：delete 后查询仍返回"幽灵"记录，用来证伪读回不是摆设。 */
class TamperingPort implements AstrynMemoryPort {
  readonly protocol: AstrynMemoryPort['protocol'];
  readonly hostId: string;
  readonly evidenceLevel: 'REAL' | 'SYNTHETIC';
  private readonly ghosts = new Map<string, AstrynMemoryCandidate>();
  private readonly inner: AstrynMemoryPort;

  constructor(inner: AstrynMemoryPort) {
    this.inner = inner;
    this.protocol = inner.protocol;
    this.hostId = `tampered:${inner.hostId}`;
    this.evidenceLevel = inner.evidenceLevel;
  }

  probe(): ReturnType<AstrynMemoryPort['probe']> {
    return this.inner.probe();
  }

  grantsFor(consumer: AstrynMemoryConsumer): ReturnType<AstrynMemoryPort['grantsFor']> {
    return this.inner.grantsFor(consumer);
  }

  propose(input: AstrynCandidateInput): ReturnType<AstrynMemoryPort['propose']> {
    return this.inner.propose(input);
  }

  async query(query: AstrynMemoryQuery): Promise<AstrynMemoryReadResult> {
    const reading = await this.inner.query(query);
    if (!reading.ok) return reading;
    const extra = [...this.ghosts.values()].filter(
      (record) => query.scopes.includes(record.scope) && (!query.includeLifecycle || query.includeLifecycle.includes(record.lifecycle))
    );
    return { ok: true, records: [...reading.records, ...extra], evidenceLevel: reading.evidenceLevel };
  }

  confirm(receipt: AstrynMemoryMutationReceipt): ReturnType<AstrynMemoryPort['confirm']> {
    return this.inner.confirm(receipt);
  }

  revoke(receipt: AstrynMemoryMutationReceipt): ReturnType<AstrynMemoryPort['revoke']> {
    return this.inner.revoke(receipt);
  }

  async delete(receipt: AstrynMemoryMutationReceipt): Promise<{ readonly ok: boolean }> {
    const inventory = await this.inner.listForReview(SESSION);
    const record = inventory.find((item) => item.id === receipt.candidateId);
    const outcome = await this.inner.delete(receipt);
    if (outcome.ok && record) this.ghosts.set(record.id, record);
    return { ok: outcome.ok };
  }

  listForReview(sessionId: string): ReturnType<AstrynMemoryPort['listForReview']> {
    return this.inner.listForReview(sessionId);
  }
}

describe('GF06 记忆治理：查看/纠正/忘记/停用均经宿主端口并读回验证', () => {
  it('view：列出获准作用域、记录来源与四个记忆空间', async () => {
    const { manager } = setup();
    await manager.propose({ scope: 'user_preference', origin: 'user-stated', summary: '用户偏好：晚上少打扰' });
    await manager.propose({ scope: 'character_fiction', origin: 'model-generated', summary: '模型自称一起看过海' });

    const view = await manager.view();
    expect(view.evidenceLevel).toBe('SYNTHETIC');
    expect(view.grants).toHaveLength(4);
    expect(view.grants.every((grant) => grant.read && grant.write)).toBe(true);
    expect(view.records.map((record) => record.id)).toEqual(['cand-1', 'cand-2']);
    expect(view.records[0]?.createdAt).toBe(NOW);
    expect(view.records.map((record) => record.origin)).toEqual(['user-stated', 'model-generated']);
    expect(view.spaces.map((space) => space.id)).toEqual(['chat-records', 'long-term-memory', 'current-context', 'backup-retention']);
    expect(view.spaces.find((space) => space.id === 'backup-retention')?.note).toContain('BLOCKED_BY_HOST_CONTRACT');
  });

  it('纠正：旧记录撤销、替换记录登记并随原确认级别确认，读回双通道一致', async () => {
    const { port, manager } = setup();
    await manager.propose({ scope: 'user_preference', origin: 'user-stated', summary: '晚上少打扰' });
    await port.confirm({ receiptId: 'host-r1', candidateId: 'cand-1', to: 'confirmed', issuedBy: 'aaos-core', issuedAt: NOW });

    const result = await manager.correct('cand-1', '晚上九点后少打扰，紧急除外');
    expect(result.ok).toBe(true);
    expect(result.readBack?.verified).toBe(true);
    expect(result.readBack?.entries.map((entry) => `${entry.id}:${entry.observedActive}/${entry.observedInventory}`)).toEqual([
      'cand-1:ABSENT/PRESENT',
      'cand-2:PRESENT/PRESENT'
    ]);
    expect(result.steps.some((step) => step.ok && step.action.includes('确认替换记录'))).toBe(true);

    const inventory = await port.listForReview(SESSION);
    const old = inventory.find((record) => record.id === 'cand-1');
    const next = inventory.find((record) => record.id === 'cand-2');
    expect(old?.lifecycle).toBe('revoked');
    expect(next?.summary).toBe('晚上九点后少打扰，紧急除外');
    expect(next?.origin).toBe('user-stated');
    expect(next?.lifecycle).toBe('confirmed');
    expect(next?.confirmedByReceiptId).not.toBeNull();
    expect(await activeIds(port, 'user_preference')).toEqual(['cand-2']);
  });

  it('忘记（撤销）：活跃读取不再返回，账本保留撤销痕迹（不是只藏一张卡）', async () => {
    const { port, manager } = setup();
    await manager.propose({ scope: 'user_preference', origin: 'user-stated', summary: '待撤销的偏好' });

    const result = await manager.forget('cand-1', 'revoke');
    expect(result.ok).toBe(true);
    expect(result.readBack?.verified).toBe(true);
    expect(result.readBack?.entries[0]?.observedActive).toBe('ABSENT');
    expect(result.readBack?.entries[0]?.observedInventory).toBe('PRESENT');
    expect(await activeIds(port, 'user_preference')).toEqual([]);
    const inventory = await port.listForReview(SESSION);
    expect(inventory.find((record) => record.id === 'cand-1')?.lifecycle).toBe('revoked');
  });

  it('忘记（删除）：活跃读取与账本都不再返回，导出不再包含该记录', async () => {
    const { port, manager } = setup();
    await manager.propose({ scope: 'user_preference', origin: 'user-stated', summary: '待删除的偏好' });

    const result = await manager.forget('cand-1', 'delete');
    expect(result.ok).toBe(true);
    expect(result.readBack?.verified).toBe(true);
    expect(result.readBack?.entries[0]?.observedActive).toBe('ABSENT');
    expect(result.readBack?.entries[0]?.observedInventory).toBe('ABSENT');
    expect(port.size).toBe(0);

    const exported = await manager.exportEvidence();
    expect(exported.json).not.toContain('cand-1');
    expect(exported.exported?.records).toEqual([]);
  });

  it('停用作用域：先真实撤销全部活跃记录再拦截本机登记，宿主授权本身不变', async () => {
    const { port, manager } = setup();
    await manager.propose({ scope: 'user_preference', origin: 'user-stated', summary: '偏好一' });
    await manager.propose({ scope: 'user_preference', origin: 'user-stated', summary: '偏好二' });
    await manager.propose({ scope: 'character_fiction', origin: 'model-generated', summary: '虚构一' });

    const result = await manager.suspendScope('user_preference');
    expect(result.ok).toBe(true);
    expect(result.readBack?.verified).toBe(true);
    expect(result.readBack?.entries).toHaveLength(2);
    expect(await activeIds(port, 'user_preference')).toEqual([]);

    const blocked = await manager.propose({ scope: 'user_preference', origin: 'user-stated', summary: '停用后的新偏好' });
    expect(blocked.ok).toBe(false);
    expect(blocked.steps[0]?.detail).toContain('SCOPE_SUSPENDED_BY_LOCAL_POLICY');

    const fictionStill = await manager.propose({ scope: 'character_fiction', origin: 'model-generated', summary: '虚构二' });
    expect(fictionStill.ok).toBe(true);

    const grants = await port.grantsFor('companion');
    expect(grants.find((grant) => grant.scope === 'user_preference')?.read).toBe(true);
    expect(grants.find((grant) => grant.scope === 'user_preference')?.write).toBe(true);

    manager.resumeScope('user_preference');
    expect(manager.suspendedScopes).toEqual([]);
    const resumed = await manager.propose({ scope: 'user_preference', origin: 'user-stated', summary: '恢复后新偏好' });
    expect(resumed.ok).toBe(true);
  });

  it('分离：遗忘只作用于记忆记录，角色档案与学习事实不受影响', async () => {
    const { port, manager } = setup();
    const profileStore = createEphemeralProfileStore();
    const saved = await profileStore.save(XIAOQI_PROFILE, 0);
    expect(saved.ok).toBe(true);
    const learningStore = createLearningCompanion();
    const added = learningStore.addMaterial({
      sourceId: 'gf06-src',
      title: 'GF06 分离示例材料',
      version: 'v1',
      text: '一段用于证明"遗忘不碰学习事实"的材料正文',
      provenance: 'synthetic-fixture',
      evidenceLevel: 'SYNTHETIC'
    });
    expect(added.ok).toBe(true);
    const turn = learningStore.recordTurn({ kind: 'companion-chat', intent: null, author: 'user', text: '周末聊到一半' });
    expect(turn.ok).toBe(true);

    await manager.propose({ scope: 'user_preference', origin: 'user-stated', summary: '待遗忘的偏好' });
    await manager.forget('cand-1', 'delete');

    expect((await manager.view()).records).toEqual([]);
    expect(port.size).toBe(0);
    const profile = await profileStore.load();
    expect(profile.profile.profileRevision).toBe(1);
    expect(learningStore.snapshot.materials).toHaveLength(1);
    expect(learningStore.snapshot.contextLog).toHaveLength(1);
  });

  it('导出：合成快照携带四类空间与备份保留限制，撤销保痕、删除除名', async () => {
    const { port, manager } = setup();
    await manager.propose({ scope: 'user_preference', origin: 'user-stated', summary: '偏好' });
    await manager.propose({ scope: 'character_fiction', origin: 'model-generated', summary: '虚构' });
    await port.confirm({ receiptId: 'host-r1', candidateId: 'cand-1', to: 'confirmed', issuedBy: 'aaos-core', issuedAt: NOW });
    await manager.forget('cand-2', 'revoke');

    const exported = await manager.exportEvidence();
    expect(exported.ok).toBe(true);
    const parsed = JSON.parse(exported.json ?? '') as {
      kind: string;
      records: { id: string; lifecycle: string }[];
      limitations: string[];
      spaces: unknown[];
    };
    expect(parsed.kind).toBe('astryn-memory-export');
    expect(parsed.records.map((record) => `${record.id}:${record.lifecycle}`)).toEqual(['cand-1:confirmed', 'cand-2:revoked']);
    expect(parsed.limitations.some((line) => line.includes('备份保留') && line.includes('BLOCKED_BY_HOST_CONTRACT'))).toBe(true);
    expect(parsed.limitations.some((line) => line.includes('SYNTHETIC'))).toBe(true);
    expect(parsed.spaces).toHaveLength(4);
  });

  it('读回是独立通道：端口删除后仍谎报记录在场时，治理动作被判定未完成', async () => {
    const inner = new SyntheticMemoryFixture({ now: () => NOW });
    const port = new TamperingPort(inner);
    const manager = new MemoryManager({ port, sessionId: SESSION, now: () => NOW });
    await manager.propose({ scope: 'user_preference', origin: 'user-stated', summary: '将被删除但被端口谎报' });

    const result = await manager.forget('cand-1', 'delete');
    expect(result.steps[0]?.ok).toBe(true);
    expect(result.readBack?.entries[0]?.observedActive).toBe('PRESENT');
    expect(result.readBack?.verified).toBe(false);
    expect(result.ok).toBe(false);
  });
});
