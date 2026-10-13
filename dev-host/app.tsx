import { useMemo, useState } from 'react';
import {
  ASTRYN_PROTOCOL_VERSION,
  ASTRYN_PRESENTATION_MODE_SPECS,
  SYNTHETIC_DOC,
  SyntheticContextFixture,
  SyntheticHostSimulator,
  SyntheticMemoryFixture,
  XIAOQI_PROFILE,
  createCompanionSessionManager,
  createEphemeralProfileStore,
  resolveConversation,
  type AstrynContextFragment,
  type AstrynMemoryCandidate,
  type AstrynPresentationMode
} from '@astryn/core';
import { CompanionShell } from '@astryn/core';
import { readDevConfig } from './dev-config';
import '../src/presentation/astryn.css';
import './dev-host.css';

const env = import.meta.env as Record<string, string | boolean | undefined>;

export function DevHostApp(): JSX.Element {
  const config = useMemo(() => readDevConfig(env), []);
  const resolved = useMemo(() => resolveConversation(config), [config]);
  const [mode, setMode] = useState<AstrynPresentationMode>('panel');
  const [sessionSeed, setSessionSeed] = useState(1);
  const [sourceOverride, setSourceOverride] = useState<'auto' | 'none'>('auto');
  const sessionId = `dev-session-${sessionSeed}`;

  const simulator = useMemo(() => (config.syntheticHostEnabled ? new SyntheticHostSimulator() : null), [config.syntheticHostEnabled]);
  const conversationPort = sourceOverride === 'none' ? null : resolved.port;
  // 会话运行时归管理器所有：切换会话或模型来源即换实例；最后一个视图离开后延迟销毁，
  // 清理与重建发生在同一批次时不会拆掉正在复用的运行时。
  const manager = useMemo(
    () =>
      createCompanionSessionManager(
        {
          sessionId,
          profile: XIAOQI_PROFILE,
          conversation: conversationPort,
          actions: simulator,
          verifier: simulator
        },
        { disposeWhenUnobserved: true }
      ),
    [sessionId, conversationPort, simulator]
  );
  const memory = useMemo(() => new SyntheticMemoryFixture(), []);
  // 开发回退：进程内，刷新即失。正式档案保存归宿主（character.profile.write，BE06 未接通）。
  const profileStore = useMemo(() => createEphemeralProfileStore(), []);
  const contextFixture = useMemo(
    () => new SyntheticContextFixture({ document: { ...SYNTHETIC_DOC, selection: null } }),
    []
  );
  const [review, setReview] = useState<readonly AstrynMemoryCandidate[]>([]);
  const [notice, setNotice] = useState<string>('');

  const implementedModes = ASTRYN_PRESENTATION_MODE_SPECS.filter((spec) => spec.implementedInM0);

  const selectionProvider = useMemo(() => (async (): Promise<AstrynContextFragment | null> => {
    const selected = (window.getSelection()?.toString() ?? '').trim();
    if (selected.length === 0) {
      setNotice('没有选中内容：请先在下方夹具文档里选中一段文字。');
      return null;
    }
    const index = SYNTHETIC_DOC.fullText.indexOf(selected);
    if (index === -1) {
      setNotice('选区不在夹具文档内，拒绝把它当作已授权上下文。');
      return null;
    }
    const authorization = await contextFixture.requestAuthorization('active-document-selection', sessionId);
    if (!authorization) {
      setNotice('宿主拒绝授权该作用域（SCOPE_NOT_SUPPORTED）。');
      return null;
    }
    const result = await contextFixture.readSelection(authorization, `ctx-${sessionId}`);
    if (!result.ok) {
      setNotice(`读取选区失败：${result.reason}`);
      return null;
    }
    setNotice('');
    return result.fragment;
  }), [contextFixture, sessionId]);

  const proposeCandidate = useMemo(() => (async (scope: AstrynMemoryCandidate['scope'], origin: AstrynMemoryCandidate['origin'], summary: string) => {
    const outcome = await memory.propose({ scope, origin, summary, sessionId });
    setReview(await memory.listForReview(sessionId));
    setNotice(outcome.ok ? `已登记候选（${outcome.candidate.lifecycle}）：${outcome.candidate.id}` : `登记被拒：${outcome.reason}`);
  }), [memory, sessionId]);

  return (
    <div className="devhost-page">
      <div className="devhost-aside">
        <CompanionShell
          key={sessionId}
          mode={mode === 'embedded' ? 'embedded' : 'panel'}
          sessionId={sessionId}
          conversation={conversationPort}
          actions={simulator}
          verifier={simulator}
          manager={manager}
          profileStore={profileStore}
          selectionProvider={selectionProvider}
          onTaskAdvance={simulator ? (taskId, outcome, detail) => simulator.advance(taskId, outcome, detail) : undefined}
        />
      </div>

      <div className="devhost-main">
        <section className="astryn-root" data-testid="devhost-controls">
          <div className="astryn-title">开发宿主控制（非正式产品）</div>
          <div className="astryn-toolbar">
            {implementedModes.map((spec) => (
              <button
                key={spec.mode}
                type="button"
                className="astryn-btn"
                data-testid={`devhost-mode-${spec.mode}`}
                aria-pressed={mode === spec.mode}
                onClick={() => setMode(spec.mode)}
              >
                {spec.label}
              </button>
            ))}
            <button type="button" className="astryn-btn" data-testid="devhost-new-session" onClick={() => setSessionSeed((n) => n + 1)}>
              新会话（丢弃在途回复）
            </button>
            <button
              type="button"
              className="astryn-btn"
              data-testid="devhost-source-toggle"
              aria-pressed={sourceOverride === 'none'}
              onClick={() => setSourceOverride((value) => (value === 'none' ? 'auto' : 'none'))}
            >
              模型来源：{sourceOverride === 'none' ? '已切到「无模型」（验证 MODEL_UNAVAILABLE）' : '按配置解析'}
            </button>
            {simulator ? (
              <button
                type="button"
                className="astryn-btn"
                data-testid="devhost-request-action"
                onClick={() => {
                  void simulator.submit({
                    protocol: ASTRYN_PROTOCOL_VERSION,
                    requestId: `act-${Date.now()}`,
                    sessionId,
                    actionKind: 'workspace.cleanup',
                    summary: '先备份工作区，再删除 .project-local/runs 下的临时日志',
                    riskTier: 'high',
                    argumentsDigest: 'sha256:synthetic-demo'
                  });
                }}
              >
                请求一个需要授权的动作（SYNTHETIC）
              </button>
            ) : null}
          </div>
          <div className="astryn-state-strip" data-testid="devhost-source">
            <span className="astryn-chip">模型来源：{resolved.info.kind}</span>
            <span className="astryn-chip">证据级别：{resolved.info.evidenceLevel}</span>
            <span className="astryn-chip">{resolved.info.available ? '可用' : 'MODEL_UNAVAILABLE'}</span>
            {simulator ? <span className="astryn-chip astryn-chip--task">合成宿主模拟器：开（SYNTHETIC）</span> : null}
          </div>
          <div className="astryn-disclosure" data-testid="devhost-reason">{resolved.info.reason ?? ''}</div>
          <ul className="devhost-list">
            {resolved.trace.map((line) => <li key={line}>{line}</li>)}
          </ul>
        </section>

        <section className="astryn-root" data-testid="devhost-fixture-doc">
          <div className="astryn-title">合成夹具文档 <span className="astryn-evidence-tag astryn-evidence-tag--synthetic">SYNTHETIC</span></div>
          <p className="devhost-copy">{SYNTHETIC_DOC.fullText}</p>
          <div className="astryn-disclosure">选中上面的文字后点左侧「解释选中内容」。这是契约测试夹具，不代表访问了 AAOS 知识库。</div>
        </section>

        <section className="astryn-root" data-testid="devhost-memory">
          <div className="astryn-title">记忆候选（进程内夹具，刷新即销毁）</div>
          <div className="astryn-toolbar">
            <button type="button" className="astryn-btn" data-testid="devhost-mem-pref" onClick={() => void proposeCandidate('user_preference', 'user-stated', '用户偏好：晚上少打扰')}>登记偏好候选</button>
            <button type="button" className="astryn-btn" data-testid="devhost-mem-fiction" onClick={() => void proposeCandidate('character_fiction', 'model-generated', '模型自称「我们上次一起看过海」')}>登记虚构经历候选</button>
          </div>
          <ul className="devhost-candidates">
            {review.map((record) => (
              <li key={record.id} data-testid={`devhost-mem-row-${record.id}`}>
                {record.scope} · {record.origin} · {record.lifecycle} · {record.summary}
                <button
                  type="button"
                  className="astryn-btn devhost-inline-btn"
                  data-testid={`devhost-mem-delete-${record.id}`}
                  onClick={() => {
                    void memory.delete({ receiptId: `ui-${record.id}`, candidateId: record.id, to: 'deleted', issuedBy: 'user-console', issuedAt: new Date().toISOString() });
                    void memory.listForReview(sessionId).then(setReview);
                  }}
                >
                  删除
                </button>
              </li>
            ))}
            {review.length === 0 ? <li className="astryn-disclosure">（尚无候选）</li> : null}
          </ul>
        </section>

        <section className="astryn-root" data-testid="devhost-boundary">
          <div className="astryn-title">边界声明</div>
          <ul className="devhost-list">
            <li>本宿主是开发工具，不是第二个正式前端；正式形态由 AAOS 前端挂载。</li>
            <li>未启用麦克风、摄像头、屏幕采集与系统命令；本页面不请求任何此类权限。</li>
            <li>小栖档案在开发宿主里只存进程内（刷新即失）；正式保存归宿主（character.profile.write，BE06 未接通，保存会显式失败）。</li>
            <li>合成数据一律标注 SYNTHETIC；真实模型调用需自行配置 dev 代理，密钥不进浏览器。</li>
            <li>任务状态只来自宿主回执；开发宿主里由合成模拟器的回执提供，故仍不构成真实集成证据。</li>
          </ul>
          <div className="astryn-disclosure" data-testid="devhost-notice">{notice}</div>
        </section>
      </div>
    </div>
  );
}
