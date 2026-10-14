import { useCallback, useEffect, useState } from 'react';
import { ASTRYN_MEMORY_SCOPES } from '@astryn/core';
import type {
  AstrynMemoryLifecycle,
  AstrynMemoryOrigin,
  AstrynMemoryScope,
  AstrynProfileStore,
  LearningCompanionStore,
  MemoryManager,
  MemoryOperationResult,
  MemoryReadBack,
  MemoryView
} from '@astryn/core';

const SCOPE_LABELS: Record<AstrynMemoryScope, string> = {
  user_preference: '偏好',
  companion_private: '陪伴私密',
  character_fiction: '虚构剧情',
  verified_fact: '已核实事实'
};

const ORIGIN_LABELS: Record<AstrynMemoryOrigin, string> = {
  'user-stated': '用户陈述',
  'model-generated': '模型生成',
  'system-observed': '系统观察'
};

const LIFECYCLE_LABELS: Record<AstrynMemoryLifecycle, string> = {
  candidate: '候选',
  confirmed: '已确认',
  revoked: '已撤销',
  deleted: '已删除'
};

const OBSERVED_LABELS: Record<'PRESENT' | 'ABSENT' | 'UNKNOWN', string> = {
  PRESENT: '在场',
  ABSENT: '不在',
  UNKNOWN: '读不到'
};

function describeReadBack(readBack: MemoryReadBack): string {
  const entries = readBack.entries
    .map((entry) => `${entry.id}：活跃读取 ${OBSERVED_LABELS[entry.observedActive]} / 账本 ${OBSERVED_LABELS[entry.observedInventory]}`)
    .join('；');
  return `读回${readBack.verified ? '一致' : '不一致'}（${readBack.via}）${entries.length > 0 ? `｜${entries}` : ''}`;
}

function describeOperation(result: MemoryOperationResult): string {
  const steps = result.steps.map((step) => `${step.ok ? '✓' : '✗'} ${step.action}：${step.detail}`).join(' ｜ ');
  const readBack = result.readBack ? ` ｜ ${describeReadBack(result.readBack)}` : '';
  return `${result.ok ? '完成' : '未完成'}：${steps}${readBack}`;
}

export interface MemoryPanelProps {
  readonly manager: MemoryManager;
  readonly learningStore: LearningCompanionStore;
  readonly profileStore: AstrynProfileStore;
  readonly onNotice: (text: string) => void;
}

interface SeparationReading {
  readonly materials: number;
  readonly turns: number;
  readonly profileRevision: number;
  readonly profileNote: string;
}

/** GF06 记忆治理台：查/纠正/忘记/导出/停用，全部经宿主端口并读回验证。 */
export function MemoryPanel({ manager, learningStore, profileStore, onNotice }: MemoryPanelProps): JSX.Element {
  const [view, setView] = useState<MemoryView | null>(null);
  const [separation, setSeparation] = useState<SeparationReading | null>(null);
  const [draftScope, setDraftScope] = useState<AstrynMemoryScope>('user_preference');
  const [draftOrigin, setDraftOrigin] = useState<AstrynMemoryOrigin>('user-stated');
  const [draftSummary, setDraftSummary] = useState('');
  const [correctingId, setCorrectingId] = useState<string | null>(null);
  const [correctionDraft, setCorrectionDraft] = useState('');
  const [opText, setOpText] = useState('准备就绪：所有治理动作都会先经宿主端口、再独立读回验证。');
  const [exportJson, setExportJson] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const nextView = await manager.view();
    const snapshot = learningStore.snapshot;
    const profile = await profileStore.load();
    setView(nextView);
    setSeparation({
      materials: snapshot.materials.length,
      turns: snapshot.journeys.reduce((sum, journey) => sum + journey.turns.length, 0),
      profileRevision: profile.profile.profileRevision,
      profileNote: profile.note
    });
  }, [manager, learningStore, profileStore]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = useCallback(
    async (label: string, operation: () => Promise<MemoryOperationResult>) => {
      const result = await operation();
      const text = `${label} ｜ ${describeOperation(result)}`;
      setOpText(text);
      onNotice(text);
      await refresh();
      return result;
    },
    [onNotice, refresh]
  );

  const propose = useCallback(
    async (scope: AstrynMemoryScope, origin: AstrynMemoryOrigin, summary: string) => {
      const trimmed = summary.trim();
      if (trimmed.length === 0) {
        const text = '登记候选 ｜ 未完成：摘要为空，先写一句要记住的内容。';
        setOpText(text);
        onNotice(text);
        return;
      }
      await run('登记候选', () => manager.propose({ scope, origin, summary: trimmed }));
    },
    [manager, onNotice, run]
  );

  if (view === null) {
    return (
      <section className="astryn-root" data-testid="devhost-memory">
        <div className="astryn-title">记忆管理（宿主接口 · 进程内夹具）</div>
        <div className="astryn-disclosure">正在读取宿主账本…</div>
      </section>
    );
  }

  return (
    <section className="astryn-root" data-testid="devhost-memory">
      <div className="astryn-title">
        记忆管理（宿主接口 · 进程内夹具） <span className="astryn-evidence-tag astryn-evidence-tag--synthetic">SYNTHETIC</span>
      </div>

      <div className="astryn-state-strip" data-testid="devhost-mem-grants">
        {view.grants.map((grant) => {
          const suspended = view.suspendedScopes.includes(grant.scope);
          return (
            <span key={grant.scope} className="astryn-chip" data-testid={`devhost-mem-grant-${grant.scope}`}>
              {SCOPE_LABELS[grant.scope]}：{grant.read ? '读' : '—'}
              {grant.write ? '写' : '—'} · {grant.grantedBy === 'user' ? '用户授权' : '宿主策略'} · {grant.expiresAt ?? '长期'}
              {suspended ? ' · 本机已停用' : ''}
              {suspended ? (
                <button
                  type="button"
                  className="astryn-btn devhost-inline-btn"
                  data-testid={`devhost-mem-resume-${grant.scope}`}
                  onClick={() => {
                    manager.resumeScope(grant.scope);
                    const text = `恢复作用域 ${grant.scope} ｜ 完成：本机拦截已解除（已撤销的记录不会自动恢复，如需再记请重新登记）`;
                    setOpText(text);
                    onNotice(text);
                    void refresh();
                  }}
                >
                  恢复
                </button>
              ) : (
                <button
                  type="button"
                  className="astryn-btn devhost-inline-btn"
                  data-testid={`devhost-mem-suspend-${grant.scope}`}
                  title="先真实撤销该作用域全部活跃记录，再拦截本机后续登记；宿主授权本身变更 BLOCKED_BY_HOST_CONTRACT"
                  onClick={() => void run(`停用 ${SCOPE_LABELS[grant.scope]}`, () => manager.suspendScope(grant.scope))}
                >
                  停用
                </button>
              )}
            </span>
          );
        })}
      </div>

      <div className="devhost-row">
        <select className="devhost-input" data-testid="devhost-mem-scope" aria-label="记忆作用域" value={draftScope} onChange={(event) => setDraftScope(event.target.value as AstrynMemoryScope)}>
          {ASTRYN_MEMORY_SCOPES.map((scope) => (
            <option key={scope} value={scope}>
              {SCOPE_LABELS[scope]}（{scope}）
            </option>
          ))}
        </select>
        <select className="devhost-input" data-testid="devhost-mem-origin" aria-label="记忆来源" value={draftOrigin} onChange={(event) => setDraftOrigin(event.target.value as AstrynMemoryOrigin)}>
          {(Object.keys(ORIGIN_LABELS) as AstrynMemoryOrigin[]).map((origin) => (
            <option key={origin} value={origin}>
              {ORIGIN_LABELS[origin]}
            </option>
          ))}
        </select>
        <input
          className="devhost-input"
          data-testid="devhost-mem-summary"
          aria-label="记忆摘要"
          placeholder="要记住的一句话（如：约定周五一起复盘）"
          value={draftSummary}
          onChange={(event) => setDraftSummary(event.target.value)}
        />
        <button type="button" className="astryn-btn" data-testid="devhost-mem-propose" onClick={() => void propose(draftScope, draftOrigin, draftSummary).then(() => setDraftSummary(''))}>
          登记候选
        </button>
        <button type="button" className="astryn-btn" data-testid="devhost-mem-pref" onClick={() => void propose('user_preference', 'user-stated', '用户偏好：晚上少打扰')}>
          登记偏好候选
        </button>
        <button type="button" className="astryn-btn" data-testid="devhost-mem-fiction" onClick={() => void propose('character_fiction', 'model-generated', '模型自称「我们上次一起看过海」')}>
          登记虚构经历候选
        </button>
      </div>

      <ul className="devhost-candidates" data-testid="devhost-mem-rows">
        {view.records.map((record) => (
          <li key={record.id} data-testid={`devhost-mem-row-${record.id}`}>
            <span className="astryn-chip">
              {LIFECYCLE_LABELS[record.lifecycle]} · {SCOPE_LABELS[record.scope]} · {ORIGIN_LABELS[record.origin]}
            </span>{' '}
            {record.summary}
            <div className="devhost-copy">
              来源：{ORIGIN_LABELS[record.origin]}（{record.origin}）· 记录于 {record.createdAt} · 确认回执 {record.confirmedByReceiptId ?? '无'}
            </div>
            {correctingId === record.id ? (
              <div className="devhost-row">
                <input
                  className="devhost-input"
                  data-testid={`devhost-mem-correct-input-${record.id}`}
                  aria-label={`纠正内容 ${record.id}`}
                  value={correctionDraft}
                  onChange={(event) => setCorrectionDraft(event.target.value)}
                />
                <button
                  type="button"
                  className="astryn-btn devhost-inline-btn"
                  data-testid={`devhost-mem-correct-save-${record.id}`}
                  onClick={() => {
                    const summary = correctionDraft.trim();
                    setCorrectingId(null);
                    if (summary.length === 0) {
                      const text = '纠正 ｜ 未完成：纠正后的内容为空。';
                      setOpText(text);
                      onNotice(text);
                      return;
                    }
                    void run(`纠正 ${record.id}`, () => manager.correct(record.id, summary));
                  }}
                >
                  保存纠正
                </button>
                <button
                  type="button"
                  className="astryn-btn devhost-inline-btn"
                  data-testid={`devhost-mem-correct-cancel-${record.id}`}
                  onClick={() => setCorrectingId(null)}
                >
                  取消
                </button>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  className="astryn-btn devhost-inline-btn"
                  data-testid={`devhost-mem-correct-${record.id}`}
                  title="撤销这条记录，并以「用户陈述」登记纠正后的版本"
                  onClick={() => {
                    setCorrectingId(record.id);
                    setCorrectionDraft(record.summary);
                  }}
                >
                  纠正
                </button>
                <button
                  type="button"
                  className="astryn-btn devhost-inline-btn"
                  data-testid={`devhost-mem-revoke-${record.id}`}
                  disabled={record.lifecycle === 'revoked'}
                  title="撤销保留审计痕迹：活跃读取不再返回它，账本仍可见"
                  onClick={() => void run(`撤销 ${record.id}`, () => manager.forget(record.id, 'revoke'))}
                >
                  撤销（忘记）
                </button>
                <button
                  type="button"
                  className="astryn-btn devhost-inline-btn"
                  data-testid={`devhost-mem-delete-${record.id}`}
                  title="删除即从宿主账本移除：活跃读取与账本都不再返回它"
                  onClick={() => void run(`删除 ${record.id}`, () => manager.forget(record.id, 'delete'))}
                >
                  删除（忘记）
                </button>
              </>
            )}
          </li>
        ))}
        {view.records.length === 0 ? <li className="devhost-disclosure">（本会话尚无记忆记录）</li> : null}
      </ul>

      {view.readExclusions.length > 0 ? (
        <div className="astryn-disclosure" data-testid="devhost-mem-exclusions">
          已按治理策略排除：{view.readExclusions.map((item) => `${SCOPE_LABELS[item.scope]}（${item.reason}）×${item.count}`).join('；')}
        </div>
      ) : null}

      <div className="devhost-row">
        <button
          type="button"
          className="astryn-btn"
          data-testid="devhost-mem-export"
          onClick={() => {
            void manager.exportEvidence().then((result) => {
              setExportJson(result.json);
              const text = `导出记忆账本 ｜ 完成：${result.exported?.records.length ?? 0} 条记录、${result.exported?.limitations.length ?? 0} 条限制声明（合成快照，不含备份保留）。`;
              setOpText(text);
              onNotice(text);
            });
          }}
        >
          导出记忆账本（JSON）
        </button>
      </div>
      {exportJson ? (
        <pre className="devhost-export" data-testid="devhost-mem-export-json">
          {exportJson}
        </pre>
      ) : null}

      <div className="astryn-disclosure" data-testid="devhost-mem-readback">
        最近动作 ｜ {opText}
      </div>

      <ul className="devhost-list" data-testid="devhost-mem-spaces">
        {view.spaces.map((space) => (
          <li key={space.id} data-testid={`devhost-mem-space-${space.id}`}>
            {space.label}（归属：{space.owner}）｜保留：{space.retention}｜{space.note}
          </li>
        ))}
      </ul>

      <div className="astryn-state-strip" data-testid="devhost-mem-separation">
        <span className="astryn-chip">记忆记录：{view.records.length} 条（经宿主接口）</span>
        <span className="astryn-chip">
          学习材料：{separation?.materials ?? 0} 份 · 练习轮：{separation?.turns ?? 0}（独立存储）
        </span>
        <span className="astryn-chip">
          角色档案 revision：{separation?.profileRevision ?? '—'}（{separation?.profileNote ?? '未读取'}）
        </span>
      </div>
      <div className="astryn-disclosure">
        遗忘只作用于「长期记忆」里的记录：角色风格（档案）与学习事实存于各自存储，不随记忆撤销/删除变动；聊天记录与备份保留两栏见上（备份归宿主，星栖不可改）。
      </div>
    </section>
  );
}
