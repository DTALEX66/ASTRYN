import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { XIAOQI_PROFILE, withOverrides } from '@astryn/contracts';
import type {
  AstrynActionPort,
  AstrynCharacterProfile,
  AstrynContextFragment,
  AstrynConversationPort,
  AstrynPresentationMode,
  AstrynReceiptVerifier
} from '@astryn/contracts';
import { createCompanionSessionManager } from '../interaction/session-manager';
import type { CompanionSessionManager, CompanionSessionPorts, CompanionSessionSnapshot } from '../interaction/session-manager';
import type { AstrynProfileLoad, AstrynProfileStore } from '../companion/profile-store';
import { ApprovalCard, AvatarView, ChatLog, Composer, StatusStrip } from './companion-view';
import type { TranscriptEntry } from './companion-view';
import { CompanionSettings } from './companion-settings';
import './astryn.css';

export interface CompanionShellProps {
  readonly mode: Extract<AstrynPresentationMode, 'embedded' | 'panel'>;
  readonly sessionId: string;
  readonly conversation: AstrynConversationPort | null;
  readonly actions?: AstrynActionPort | null;
  readonly verifier?: AstrynReceiptVerifier | null;
  readonly profile?: AstrynCharacterProfile | undefined;
  /** 档案存储端口：宿主存储（未接通即显式失败）或进程内开发回退。 */
  readonly profileStore?: AstrynProfileStore | null;
  readonly initialContext?: AstrynContextFragment | null | undefined;
  /** 选中一段文本让角色解释（M0-E 场景）时由宿主提供。 */
  readonly selectionProvider?: (() => Promise<AstrynContextFragment | null>) | undefined;
  /** 仅开发宿主的合成模拟器使用：把用户决定回写成一条权威回执。 */
  readonly onTaskAdvance?: ((taskId: string, outcome: 'approval-granted' | 'approval-denied' | 'started' | 'completed' | 'failed', detail?: string) => void) | undefined;
  /**
   * 共享会话管理器：多个呈现或宿主级控制共用同一实例时由宿主传入并持有生命周期。
   * 不传时组件自建进程内管理器，卸载即释放（StrictMode 安全的延迟销毁）。
   * 组件从不销毁传入的管理器。
   */
  readonly manager?: CompanionSessionManager | null;
}

function loadNoteText(note: AstrynProfileLoad['note']): string | null {
  switch (note) {
    case 'LOADED':
      return null;
    case 'EMPTY_DEFAULT':
      return '尚无已保存档案，使用默认配置。';
    case 'MIGRATED_V1_TO_V2':
      return '已从 v1 档案迁移到 v2。';
    case 'INVALID_FALLBACK':
      return '档案无法识别，已回退默认配置（原档案未被改写）。';
    case 'HOST_UNAVAILABLE_DEFAULT':
      return '宿主档案存储未接通（BLOCKED_BY_HOST_CONTRACT），当前用默认配置；保存不会真正写入。';
  }
}

export function CompanionShell(props: CompanionShellProps): JSX.Element {
  const [hidden, setHidden] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [contextFragment, setContextFragment] = useState<AstrynContextFragment | null>(props.initialContext ?? null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const store = props.profileStore ?? null;

  // 组件自建的管理器：构造保持纯净（首个视图 retain 时才 attach），被丢弃的实例不订阅宿主端口。
  const [ownedManager] = useState(() =>
    createCompanionSessionManager(
      {
        sessionId: props.sessionId,
        profile: props.profile ?? XIAOQI_PROFILE,
        conversation: props.conversation ?? null,
        actions: props.actions ?? null,
        verifier: props.verifier ?? null
      },
      { disposeWhenUnobserved: true }
    )
  );
  const manager = props.manager ?? ownedManager;
  const [snapshot, setSnapshot] = useState<CompanionSessionSnapshot>(() => manager.snapshot);

  // 视图生命周期与快照订阅：retain 触发 start，release 后在无视图时按规则暂停渲染；
  // 呈现方式变化（panel/embedded）不触碰会话运行时，记录连续。
  useEffect(() => {
    const release = manager.retainView(props.mode === 'embedded' ? 'embedded' : 'panel');
    const unsubscribe = manager.subscribe(() => setSnapshot(manager.snapshot));
    setSnapshot(manager.snapshot);
    return () => {
      unsubscribe();
      release();
    };
  }, [manager, props.mode]);

  // 端口变化时配置管理器；挂载时不覆盖管理者自带的端口配置。
  const lastPorts = useRef<CompanionSessionPorts | null>(null);
  useEffect(() => {
    const next: CompanionSessionPorts = {
      sessionId: props.sessionId,
      conversation: props.conversation ?? null,
      actions: props.actions ?? null,
      verifier: props.verifier ?? null
    };
    const last = lastPorts.current;
    lastPorts.current = next;
    if (!last) return;
    manager.configurePorts(next);
  }, [manager, props.sessionId, props.conversation, props.actions, props.verifier]);

  useEffect(() => {
    if (!store) return;
    let cancelled = false;
    void manager.ensureProfileLoaded(store).then((result) => {
      if (cancelled) return;
      setNotice(loadNoteText(result.note));
    });
    return () => {
      cancelled = true;
    };
  }, [manager, store]);

  const profile = snapshot.profile;
  const state = snapshot.state;

  useEffect(() => {
    setReducedMotion(profile.appearance.reducedMotion);
  }, [profile]);

  const synthetic = props.conversation?.evidenceLevel === 'SYNTHETIC';

  const transcript = useMemo<readonly TranscriptEntry[]>(() => {
    const entries: TranscriptEntry[] = [];
    if (contextFragment) {
      entries.push({
        role: 'system',
        text: `获准读取上下文：《${contextFragment.sourceTitle}》${contextFragment.sourceVersion} · 选区「${contextFragment.excerpt}」· 来源标记 ${contextFragment.provenance}`,
        synthetic: contextFragment.evidenceLevel === 'SYNTHETIC',
        tone: 'normal'
      });
    }
    for (const message of snapshot.transcript) {
      entries.push({
        role: message.role === 'system' ? 'system' : message.role,
        text: message.content,
        synthetic: message.role === 'assistant' && synthetic,
        tone: 'normal'
      });
    }
    // 已完成的回复会补记进 transcript；此处只渲染"尚未落账"的在途文本，避免同一句话出现两遍。
    const committedTail = snapshot.transcript.at(-1);
    const streamedCommitted = committedTail?.role === 'assistant' && committedTail.content === state.streamedText;
    if (state.streamedText.length > 0 && !streamedCommitted) {
      entries.push({ role: 'assistant', text: state.streamedText, synthetic, tone: 'normal' });
    }
    if (state.failure) {
      entries.push({ role: 'system', text: `${state.failure.code}：${state.failure.message}`, synthetic: false, tone: 'error' });
    }
    return entries;
  }, [snapshot, state.streamedText, state.failure, synthetic, contextFragment]);

  const handleSubmit = useCallback((text: string) => {
    void manager.submit(text);
  }, [manager]);

  const handleProfileChange = useCallback((next: AstrynCharacterProfile) => {
    manager.setProfile(next);
  }, [manager]);

  const handleExplain = useCallback(() => {
    const provider = props.selectionProvider;
    if (!provider) return;
    void provider().then((fragment) => {
      if (!fragment) return;
      setContextFragment(fragment);
      manager.attachContext([fragment]);
      void manager.submit(`请解释我选中的这段内容，并给出它的来源标识。`);
    });
  }, [manager, props.selectionProvider]);

  const handleSave = useCallback(() => {
    if (!store) {
      setNotice('未配置档案存储端口：修改仅在本会话内生效，不会被保存。');
      return;
    }
    const current = manager.snapshot.profile;
    setSaving(true);
    void store.save(current, current.profileRevision).then((result) => {
      setSaving(false);
      if (result.ok) {
        manager.setProfile(result.profile);
        setNotice(`已保存（修订 ${result.profile.profileRevision}）→ ${store.label}`);
        return;
      }
      if (result.reason === 'REVISION_CONFLICT') {
        setNotice(`保存被拒：档案已被其他入口更新到修订 ${result.currentRevision}，本次修改未写入。请关闭设置重新打开后重试。`);
        return;
      }
      setNotice(`保存不可用：${result.message}`);
    });
  }, [store, manager]);

  const handleReset = useCallback(() => {
    manager.setProfile({ ...XIAOQI_PROFILE, profileRevision: manager.snapshot.profile.profileRevision });
    setNotice('已恢复默认（尚未保存）。');
  }, [manager]);

  const streaming = state.conversation === 'thinking' || state.conversation === 'speaking';

  if (hidden) {
    return (
      <div className={`astryn-root astryn-root--${props.mode}`} data-testid="astryn-hidden-placeholder">
        <span className="astryn-disclosure">小栖已隐藏。</span>
        <button type="button" className="astryn-btn" data-testid="astryn-show" onClick={() => setHidden(false)}>恢复角色</button>
      </div>
    );
  }

  return (
    <div className={`astryn-root astryn-root--${props.mode}`} data-testid="astryn-shell">
      <div className="astryn-header">
        <div>
          <div className="astryn-title">{profile.displayName} · 星栖</div>
          <div className="astryn-disclosure" data-testid="astryn-ai-disclosure">{profile.aiDisclosure}</div>
        </div>
        <span
          className={`astryn-evidence-tag astryn-evidence-tag--${synthetic ? 'synthetic' : 'real'}`}
          data-testid="astryn-evidence-tag"
        >
          {props.conversation ? `${props.conversation.transport} / ${props.conversation.evidenceLevel}` : 'NO MODEL'}
        </span>
      </div>

      <div className="astryn-stage">
        <AvatarView state={state} profile={profile} reducedMotion={reducedMotion} />
        <div className="astryn-stage-meta">
          <StatusStrip
            state={state}
            audit={{
              applied: snapshot.audit.applied,
              rejected: snapshot.audit.rejected,
              lastRejectedReason: snapshot.audit.lastRejectedReason,
              verification: (() => {
                const verification = snapshot.audit.lastVerification;
                if (!verification) return null;
                if (verification.ok) return '通过';
                return verification.reason + (verification.hasVerifier ? '' : '（未提供校验器）');
              })()
            }}
          />
          <div className="astryn-toolbar astryn-toolbar--spaced">
            <button type="button" className="astryn-btn" data-testid="astryn-toggle-motion" onClick={() => setReducedMotion((v) => !v)}>
              {reducedMotion ? '启用动效' : '减少动效'}
            </button>
            <button type="button" className="astryn-btn" data-testid="astryn-hide" onClick={() => setHidden(true)}>隐藏角色</button>
            <button
              type="button"
              className="astryn-btn"
              data-testid="astryn-settings-toggle"
              aria-pressed={settingsOpen}
              onClick={() => setSettingsOpen((v) => !v)}
            >
              {settingsOpen ? '返回对话' : '设置'}
            </button>
            <button type="button" className="astryn-btn" data-testid="astryn-reply-length" onClick={() => manager.setProfile(withOverrides(profile, { expressionStyle: { replyLength: profile.expressionStyle.replyLength === 'brief' ? 'detailed' : 'brief' } }))}>
              回复长度：{profile.expressionStyle.replyLength}
            </button>
            {props.selectionProvider ? (
              <button type="button" className="astryn-btn" data-testid="astryn-explain-selection" onClick={handleExplain}>解释选中内容</button>
            ) : null}
          </div>
        </div>
      </div>

      <ApprovalCard state={state} onApprovalDecision={(approved) => {
        const taskId = state.task.taskId;
        const advance = props.onTaskAdvance;
        if (!taskId || !advance) return;
        advance(taskId, approved ? 'approval-granted' : 'approval-denied', approved ? undefined : '用户拒绝');
      }} />

      {props.onTaskAdvance && state.task.taskId && state.task.status !== 'awaiting_approval' ? (
        <div className="astryn-approval" data-testid="astryn-task-advance">
          <span>
            合成宿主回执推进（SYNTHETIC）· 任务 {state.task.taskId} · 当前 {state.task.status}
          </span>
          <div className="astryn-toolbar">
            {(['started', 'completed', 'failed'] as const).map((outcome) => (
              <button
                key={outcome}
                type="button"
                className="astryn-btn"
                data-testid={`astryn-advance-${outcome}`}
                onClick={() => props.onTaskAdvance?.(state.task.taskId as string, outcome, outcome === 'failed' ? '合成宿主报告失败' : undefined)}
              >
                {outcome === 'started' ? '执行中' : outcome === 'completed' ? '完成回执' : '失败回执'}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {settingsOpen ? (
        <CompanionSettings
          profile={profile}
          storageLabel={store ? store.label : '未配置档案存储端口（仅本会话内存）'}
          storagePersistent={store ? store.persistent : false}
          saving={saving}
          notice={notice}
          onChange={handleProfileChange}
          onSave={handleSave}
          onReset={handleReset}
          onClose={() => setSettingsOpen(false)}
        />
      ) : (
        <>
          <ChatLog transcript={transcript} />
          <Composer
            streaming={streaming}
            disabled={false}
            onSubmit={handleSubmit}
            onCancel={() => manager.cancel('user')}
            onFocus={() => manager.notifyFocus('composer')}
            onBlur={() => manager.notifyBlur('composer')}
          />
        </>
      )}
      <div className="astryn-visually-hidden" aria-live="polite" data-testid="astryn-live-region">
        当前状态 {state.conversation}，任务 {state.task.status}
      </div>
    </div>
  );
}
