import type {
  AstrynMemoryCandidate,
  AstrynMemoryConsumer,
  AstrynMemoryMutationReceipt,
  AstrynMemoryOrigin,
  AstrynMemoryPort,
  AstrynMemoryScope,
  AstrynMemoryScopeGrant
} from '@astryn/contracts';

const ACTIVE_LIFECYCLES = ['candidate', 'confirmed'] as const;
const SUSPENDED_SCOPE_REASON = 'SCOPE_SUSPENDED_BY_LOCAL_POLICY';

/** 记忆的四个空间：管理界面必须分开说明，避免"删了记忆就万事皆清"的误导。 */
export interface AstrynMemorySpace {
  readonly id: 'chat-records' | 'long-term-memory' | 'current-context' | 'backup-retention';
  readonly label: string;
  readonly owner: string;
  readonly retention: string;
  readonly note: string;
}

export const ASTRYN_MEMORY_SPACES: readonly AstrynMemorySpace[] = [
  {
    id: 'chat-records',
    label: '聊天记录',
    owner: '会话存储（开发宿主为进程内）',
    retention: '随会话保存；本面板的撤销/删除不会删除聊天记录',
    note: '正式会话存储归 AAOS 前端，未接通 BLOCKED_BY_HOST_CONTRACT'
  },
  {
    id: 'long-term-memory',
    label: '长期记忆',
    owner: 'AAOS 权威存储（当前为进程内合成夹具）',
    retention: '候选→确认→撤销/删除，由宿主回执驱动',
    note: '星栖不建立第二长期主库'
  },
  {
    id: 'current-context',
    label: '当前上下文',
    owner: '宿主上下文通道（合成夹具模拟）',
    retention: '随请求装配；撤销/删除后用同一接口读回验证',
    note: '真实上下文装配 BLOCKED_BY_HOST_CONTRACT'
  },
  {
    id: 'backup-retention',
    label: '备份保留',
    owner: 'AAOS（宿主）',
    retention: '宿主侧策略，星栖不可见、不可改',
    note: 'BLOCKED_BY_HOST_CONTRACT：不得声称已清除备份'
  }
];

export interface MemoryManagerOptions {
  readonly port: AstrynMemoryPort;
  readonly sessionId: string;
  readonly consumer?: AstrynMemoryConsumer;
  readonly now?: () => string;
}

export interface MemoryProposeInput {
  readonly scope: AstrynMemoryScope;
  readonly origin: AstrynMemoryOrigin;
  readonly summary: string;
}

export interface MemoryOperationStep {
  readonly action: string;
  readonly ok: boolean;
  readonly detail: string;
}

export interface MemoryReadBackEntry {
  readonly id: string;
  readonly expectedActive: 'PRESENT' | 'ABSENT';
  readonly observedActive: 'PRESENT' | 'ABSENT' | 'UNKNOWN';
  readonly expectedInventory: 'PRESENT' | 'ABSENT';
  readonly observedInventory: 'PRESENT' | 'ABSENT';
  readonly matches: boolean;
}

/** 治理动作的独立第二通道验证：期望来自操作语义，观测来自新鲜的宿主接口读取。 */
export interface MemoryReadBack {
  readonly checkedAt: string;
  readonly via: string;
  readonly verified: boolean;
  readonly entries: readonly MemoryReadBackEntry[];
}

export interface MemoryOperationResult {
  readonly ok: boolean;
  readonly steps: readonly MemoryOperationStep[];
  readonly readBack: MemoryReadBack | null;
}

export interface MemoryView {
  readonly sessionId: string;
  readonly consumer: AstrynMemoryConsumer;
  readonly hostId: string;
  readonly evidenceLevel: 'REAL' | 'SYNTHETIC';
  readonly grants: readonly AstrynMemoryScopeGrant[];
  readonly suspendedScopes: readonly AstrynMemoryScope[];
  readonly records: readonly AstrynMemoryCandidate[];
  readonly spaces: readonly AstrynMemorySpace[];
  readonly generatedAt: string;
}

export interface MemoryExport {
  readonly schemaVersion: 1;
  readonly kind: 'astryn-memory-export';
  readonly generatedAt: string;
  readonly sessionId: string;
  readonly consumer: AstrynMemoryConsumer;
  readonly hostId: string;
  readonly evidenceLevel: 'REAL' | 'SYNTHETIC';
  readonly grants: readonly AstrynMemoryScopeGrant[];
  readonly suspendedScopes: readonly AstrynMemoryScope[];
  readonly records: readonly AstrynMemoryCandidate[];
  readonly spaces: readonly AstrynMemorySpace[];
  readonly limitations: readonly string[];
}

export interface MemoryExportResult {
  readonly ok: boolean;
  readonly exported: MemoryExport | null;
  readonly json: string | null;
}

interface ReadBackExpectation {
  readonly id: string;
  readonly scope: AstrynMemoryScope;
  readonly expectedActive: 'PRESENT' | 'ABSENT';
  readonly expectedInventory: 'PRESENT' | 'ABSENT';
}

/**
 * 记忆管理器：星栖侧的治理台。所有写入/撤销/删除都经宿主端口，且每次治理动作
 * 后都从端口独立读回验证；"停用"只拦截星栖侧登记，宿主授权本身的变更
 * 仍是 BLOCKED_BY_HOST_CONTRACT。
 */
export class MemoryManager {
  private readonly port: AstrynMemoryPort;
  readonly sessionId: string;
  readonly consumer: AstrynMemoryConsumer;
  private readonly now: () => string;
  private readonly suspended = new Set<AstrynMemoryScope>();
  private receiptSeq = 0;

  constructor(options: MemoryManagerOptions) {
    this.port = options.port;
    this.sessionId = options.sessionId;
    this.consumer = options.consumer ?? 'companion';
    this.now = options.now ?? (() => new Date().toISOString());
  }

  get suspendedScopes(): readonly AstrynMemoryScope[] {
    return [...this.suspended];
  }

  async view(): Promise<MemoryView> {
    const [grants, records] = await Promise.all([this.port.grantsFor(this.consumer), this.port.listForReview(this.sessionId)]);
    return {
      sessionId: this.sessionId,
      consumer: this.consumer,
      hostId: this.port.hostId,
      evidenceLevel: this.port.evidenceLevel,
      grants,
      suspendedScopes: this.suspendedScopes,
      records,
      spaces: ASTRYN_MEMORY_SPACES,
      generatedAt: this.now()
    };
  }

  async propose(input: MemoryProposeInput): Promise<MemoryOperationResult> {
    if (this.suspended.has(input.scope)) {
      return {
        ok: false,
        steps: [
          {
            action: `登记候选（${input.scope}）`,
            ok: false,
            detail: `${SUSPENDED_SCOPE_REASON}：本机已停用该作用域；恢复后才能登记。宿主授权变更仍 BLOCKED_BY_HOST_CONTRACT。`
          }
        ],
        readBack: null
      };
    }
    const outcome = await this.port.propose({ scope: input.scope, origin: input.origin, summary: input.summary, sessionId: this.sessionId });
    return {
      ok: outcome.ok,
      steps: [
        outcome.ok
          ? { action: `登记候选 ${outcome.candidate.id}`, ok: true, detail: `${input.scope} · ${input.origin} · ${outcome.candidate.lifecycle}` }
          : { action: '登记候选', ok: false, detail: `被拒：${outcome.reason}` }
      ],
      readBack: null
    };
  }

  /** 纠正 = 撤销旧记录 + 以用户陈述登记替换记录；旧记录（若已确认）的替换会自动请求确认。 */
  async correct(candidateId: string, newSummary: string): Promise<MemoryOperationResult> {
    const record = (await this.port.listForReview(this.sessionId)).find((item) => item.id === candidateId);
    if (!record) {
      return { ok: false, steps: [{ action: `纠正 ${candidateId}`, ok: false, detail: '记录不在本会话账本（HOST_CONTRACT_MISSING）' }], readBack: null };
    }
    const steps: MemoryOperationStep[] = [];

    const revokeOutcome = await this.port.revoke(this.receipt(candidateId, 'revoked'));
    if (!revokeOutcome.ok) {
      steps.push({ action: `撤销旧记录 ${candidateId}`, ok: false, detail: `被拒：${revokeOutcome.reason}` });
      return { ok: false, steps, readBack: null };
    }
    steps.push({ action: `撤销旧记录 ${candidateId}`, ok: true, detail: `已撤销（原 ${record.scope}）` });

    const proposed = await this.port.propose({ scope: record.scope, origin: 'user-stated', summary: newSummary, sessionId: this.sessionId });
    if (!proposed.ok) {
      steps.push({ action: '登记替换记录', ok: false, detail: `被拒：${proposed.reason}` });
      return { ok: false, steps, readBack: null };
    }
    steps.push({ action: `登记替换记录 ${proposed.candidate.id}`, ok: true, detail: `user-stated · ${proposed.candidate.lifecycle}` });

    if (record.lifecycle === 'confirmed') {
      const confirmed = await this.port.confirm(this.receipt(proposed.candidate.id, 'confirmed'));
      steps.push(
        confirmed.ok
          ? { action: `确认替换记录 ${proposed.candidate.id}`, ok: true, detail: `确认回执 ${confirmed.candidate.confirmedByReceiptId ?? '—'}` }
          : { action: `确认替换记录 ${proposed.candidate.id}`, ok: false, detail: `确认被拒：${confirmed.reason}（替换记录保留为候选）` }
      );
    }

    const readBack = await this.readBack([
      { id: candidateId, scope: record.scope, expectedActive: 'ABSENT', expectedInventory: 'PRESENT' },
      { id: proposed.candidate.id, scope: proposed.candidate.scope, expectedActive: 'PRESENT', expectedInventory: 'PRESENT' }
    ]);
    return { ok: readBack.verified, steps, readBack };
  }

  /** 忘记：revoke 保留审计痕迹（账本可见 revoked），delete 从账本移除；两者都读回验证。 */
  async forget(candidateId: string, mode: 'revoke' | 'delete'): Promise<MemoryOperationResult> {
    const record = (await this.port.listForReview(this.sessionId)).find((item) => item.id === candidateId);
    if (!record) {
      return { ok: false, steps: [{ action: `忘记 ${candidateId}`, ok: false, detail: '记录不在本会话账本（HOST_CONTRACT_MISSING）' }], readBack: null };
    }
    const outcome =
      mode === 'delete' ? await this.port.delete(this.receipt(candidateId, 'deleted')) : await this.port.revoke(this.receipt(candidateId, 'revoked'));
    const action = mode === 'delete' ? `删除 ${candidateId}` : `撤销 ${candidateId}`;
    if (!outcome.ok) {
      return { ok: false, steps: [{ action, ok: false, detail: `被拒：${outcome.reason}` }], readBack: null };
    }
    const readBack = await this.readBack([
      {
        id: candidateId,
        scope: record.scope,
        expectedActive: 'ABSENT',
        expectedInventory: mode === 'delete' ? 'ABSENT' : 'PRESENT'
      }
    ]);
    return {
      ok: readBack.verified,
      steps: [
        {
          action,
          ok: true,
          detail: mode === 'delete' ? '已从宿主账本删除' : `已标记撤销（审计痕迹保留，${record.scope}）`
        }
      ],
      readBack
    };
  }

  /** 停用作用域：先真实撤销该作用域全部活跃记录，再登记本机拦截；宿主 grant 本身不变。 */
  async suspendScope(scope: AstrynMemoryScope): Promise<MemoryOperationResult> {
    const records = await this.port.listForReview(this.sessionId);
    const actives = records.filter((item) => item.scope === scope && (ACTIVE_LIFECYCLES as readonly string[]).includes(item.lifecycle));
    const steps: MemoryOperationStep[] = [];
    const expectations: ReadBackExpectation[] = [];
    for (const record of actives) {
      const outcome = await this.port.revoke(this.receipt(record.id, 'revoked'));
      steps.push(
        outcome.ok
          ? { action: `撤销 ${record.id}`, ok: true, detail: `${scope} · ${record.lifecycle} → revoked` }
          : { action: `撤销 ${record.id}`, ok: false, detail: `被拒：${outcome.reason}` }
      );
      if (outcome.ok) {
        expectations.push({ id: record.id, scope, expectedActive: 'ABSENT', expectedInventory: 'PRESENT' });
      }
    }
    this.suspended.add(scope);
    steps.push({
      action: `停用作用域 ${scope}`,
      ok: true,
      detail: `本机已停用（撤销 ${actives.length} 条活跃记录）；宿主授权本身未变，变更授权 BLOCKED_BY_HOST_CONTRACT`
    });
    const denied = steps.some((step) => !step.ok);
    if (expectations.length === 0) {
      return { ok: !denied, steps, readBack: null };
    }
    const readBack = await this.readBack(expectations);
    return { ok: readBack.verified && !denied, steps, readBack };
  }

  resumeScope(scope: AstrynMemoryScope): void {
    this.suspended.delete(scope);
  }

  async exportEvidence(): Promise<MemoryExportResult> {
    const [grants, records] = await Promise.all([this.port.grantsFor(this.consumer), this.port.listForReview(this.sessionId)]);
    const exported: MemoryExport = {
      schemaVersion: 1,
      kind: 'astryn-memory-export',
      generatedAt: this.now(),
      sessionId: this.sessionId,
      consumer: this.consumer,
      hostId: this.port.hostId,
      evidenceLevel: this.port.evidenceLevel,
      grants,
      suspendedScopes: this.suspendedScopes,
      records,
      spaces: ASTRYN_MEMORY_SPACES,
      limitations: [
        this.port.evidenceLevel === 'SYNTHETIC'
          ? '本导出基于合成夹具（SYNTHETIC），不代表真实宿主记忆库内容。'
          : '本导出为星栖侧读取快照；权威存储与写入权归宿主。',
        '备份保留（backup-retention）不在此导出：宿主侧策略，BLOCKED_BY_HOST_CONTRACT。',
        '已删除（deleted）记录不出现于账本与导出：删除即移除，撤销（revoked）记录保留审计痕迹。'
      ]
    };
    return { ok: true, exported, json: JSON.stringify(exported, null, 2) };
  }

  private receipt(candidateId: string, to: 'confirmed' | 'revoked' | 'deleted'): AstrynMemoryMutationReceipt {
    this.receiptSeq += 1;
    return {
      receiptId: `mem-${this.sessionId}-${this.receiptSeq}`,
      candidateId,
      to,
      issuedBy: 'user',
      issuedAt: this.now()
    };
  }

  private async readBack(expectations: readonly ReadBackExpectation[]): Promise<MemoryReadBack> {
    const inventory = await this.port.listForReview(this.sessionId);
    const inventoryIds = new Set(inventory.map((item) => item.id));
    const scopes = [...new Set(expectations.map((item) => item.scope))];
    const activeIds = new Set<string>();
    const deniedScopes = new Set<AstrynMemoryScope>();
    const viaParts: string[] = [];
    for (const scope of scopes) {
      const reading = await this.port.query({ consumer: this.consumer, scopes: [scope], includeLifecycle: [...ACTIVE_LIFECYCLES] });
      if (reading.ok) {
        for (const record of reading.records) activeIds.add(record.id);
        viaParts.push(`query(${this.consumer}×${scope})=${reading.records.length} 条活跃`);
      } else {
        deniedScopes.add(scope);
        viaParts.push(`query(${this.consumer}×${scope}) 被拒：${reading.reason}`);
      }
    }
    viaParts.push(`listForReview(${this.sessionId})=${inventory.length} 条`);
    const entries: MemoryReadBackEntry[] = expectations.map((expectation) => {
      const observedActive: MemoryReadBackEntry['observedActive'] = deniedScopes.has(expectation.scope)
        ? 'UNKNOWN'
        : activeIds.has(expectation.id)
          ? 'PRESENT'
          : 'ABSENT';
      const observedInventory: MemoryReadBackEntry['observedInventory'] = inventoryIds.has(expectation.id) ? 'PRESENT' : 'ABSENT';
      return {
        id: expectation.id,
        expectedActive: expectation.expectedActive,
        observedActive,
        expectedInventory: expectation.expectedInventory,
        observedInventory,
        matches: observedActive === expectation.expectedActive && observedInventory === expectation.expectedInventory
      };
    });
    return {
      checkedAt: this.now(),
      via: viaParts.join('；'),
      verified: entries.every((entry) => entry.matches),
      entries
    };
  }
}
