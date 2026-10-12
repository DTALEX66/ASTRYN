import { ASTRYN_PROTOCOL_VERSION } from '@astryn/contracts';
import type {
  AstrynContextAuthorization,
  AstrynContextFragment,
  AstrynContextPort,
  AstrynContextReadResult,
  AstrynContextScope
} from '@astryn/contracts';

export interface FixtureSelection {
  readonly sourceId: string;
  readonly sourceTitle: string;
  readonly sourceVersion: string;
  readonly fullText: string;
  readonly selection: { readonly start: number; readonly end: number } | null;
}

export interface SyntheticContextOptions {
  readonly document: FixtureSelection;
  /** 模拟宿主策略：某些 scope 不被支持。 */
  readonly supportedScopes?: readonly AstrynContextScope[];
  readonly authorizationTtlMs?: number;
  readonly clock?: () => number;
}

const DEFAULT_SUPPORTED: readonly AstrynContextScope[] = ['active-document-selection', 'task-context'];

/**
 * 授权上下文夹具（SYNTHETIC）。用于验证 M0-E 契约形状：
 * 用户选中一段文字 → 小栖获得授权后的选区 → 解释含义 → 回传真实来源标识。
 * 文档本身是合成夹具，代码里显式标注 provenance，绝不假装访问 AAOS 知识库。
 */
export class SyntheticContextFixture implements AstrynContextPort {
  readonly protocol = ASTRYN_PROTOCOL_VERSION;
  readonly hostId = 'synthetic-context-fixture';
  readonly evidenceLevel = 'SYNTHETIC' as const;

  private readonly supported: readonly AstrynContextScope[];
  private readonly ttl: number;
  private readonly clock: () => number;
  private counter = 0;

  constructor(
    private readonly options: SyntheticContextOptions,
    private readonly grants = new Map<string, AstrynContextAuthorization>()
  ) {
    this.supported = options.supportedScopes ?? DEFAULT_SUPPORTED;
    this.ttl = options.authorizationTtlMs ?? 120_000;
    this.clock = options.clock ?? (() => Date.now());
  }

  async probe(): Promise<{ available: boolean; supportedScopes: readonly AstrynContextScope[]; reason: string | null }> {
    return {
      available: false,
      supportedScopes: this.supported,
      reason: '合成夹具仅用于契约测试；AAOS 侧不存在"当前选区"广播合同（见 AAOS-HOST-CAPABILITY-MAP 第 3 节）。'
    };
  }

  async requestAuthorization(scope: AstrynContextScope, sessionId: string): Promise<AstrynContextAuthorization | null> {
    if (!this.supported.includes(scope)) return null;
    this.counter += 1;
    const authorization: AstrynContextAuthorization = {
      authorizationId: `synauth-${sessionId}-${this.counter}`,
      scope,
      grantedBy: 'user',
      grantedAt: new Date(this.clock()).toISOString(),
      expiresAt: new Date(this.clock() + this.ttl).toISOString()
    };
    this.grants.set(authorization.authorizationId, authorization);
    return authorization;
  }

  async readSelection(authorization: AstrynContextAuthorization, requestId: string): Promise<AstrynContextReadResult> {
    void requestId;
    const stored = this.grants.get(authorization.authorizationId);
    if (!stored) return { ok: false, reason: 'PERMISSION_DENIED' };
    if (!this.supported.includes(stored.scope)) return { ok: false, reason: 'SCOPE_NOT_SUPPORTED' };
    if (stored.expiresAt !== null && Date.parse(stored.expiresAt) <= this.clock()) {
      this.grants.delete(stored.authorizationId);
      return { ok: false, reason: 'AUTHORIZATION_EXPIRED' };
    }

    const { selection, sourceId, sourceTitle, sourceVersion, fullText } = this.options.document;
    if (selection === null) return { ok: false, reason: 'NO_SELECTION' };
    const excerpt = fullText.slice(selection.start, selection.end).trim();
    if (excerpt.length === 0) return { ok: false, reason: 'NO_SELECTION' };

    const fragment: AstrynContextFragment = {
      scope: stored.scope,
      sourceId,
      sourceTitle,
      sourceVersion,
      excerpt,
      provenance: 'synthetic-fixture',
      authorizationId: stored.authorizationId,
      evidenceLevel: 'SYNTHETIC'
    };
    return { ok: true, fragment };
  }
}

/** M0-E 场景夹具文档：内容本身声明它是合成数据。 */
export const SYNTHETIC_DOC: FixtureSelection = {
  sourceId: 'synth-doc-host-adapter',
  sourceTitle: '合成夹具·宿主边界说明',
  sourceVersion: 'v1',
  fullText:
    '本文档是合成测试夹具，不代表 AAOS 真实知识条目。星栖只能读取用户在宿主中显式授权的作用域。角色对话产生的记忆只作为可治理的候选数据，通过宿主正式接口记录、修改、撤销或删除。',
  selection: { start: 0, end: 46 }
};
