import { useCallback, useEffect, useMemo, useState } from 'react';
import { XIAOQI_PROFILE, withOverrides } from '@astryn/contracts';
import type {
  AstrynActionPort,
  AstrynCharacterProfile,
  AstrynContextFragment,
  AstrynConversationPort,
  AstrynPresentationMode,
  AstrynReceiptVerifier
} from '@astryn/contracts';
import { AstrynCompanionController } from '../interaction/companion-controller';
import type { CompanionControllerDeps } from '../interaction/companion-controller';
import { ApprovalCard, AvatarView, ChatLog, Composer, StatusStrip } from './companion-view';
import type { TranscriptEntry } from './companion-view';
import './astryn.css';

export interface CompanionShellProps {
  readonly mode: Extract<AstrynPresentationMode, 'embedded' | 'panel'>;
  readonly sessionId: string;
  readonly conversation: AstrynConversationPort | null;
  readonly actions?: AstrynActionPort | null;
  readonly verifier?: AstrynReceiptVerifier | null;
  readonly profile?: AstrynCharacterProfile | undefined;
  readonly initialContext?: AstrynContextFragment | null | undefined;
  /** 选中一段文本让角色解释（M0-E 场景）时由宿主提供。 */
  readonly selectionProvider?: (() => Promise<AstrynContextFragment | null>) | undefined;
  /** 仅开发宿主的合成模拟器使用：把用户决定回写成一条权威回执。 */
  readonly onTaskAdvance?: ((taskId: string, outcome: 'approval-granted' | 'approval-denied' | 'started' | 'completed' | 'failed', detail?: string) => void) | undefined;
}

export function CompanionShell(props: CompanionShellProps): JSX.Element {
  const [hidden, setHidden] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [profile, setProfile] = useState<AstrynCharacterProfile>(props.profile ?? XIAOQI_PROFILE);
  const [contextFragment, setContextFragment] = useState<AstrynContextFragment | null>(props.initialContext ?? null);

  const deps = useMemo<CompanionControllerDeps>(() => ({
    sessionId: props.sessionId,
    profile,
    conversation: props.conversation,
    actions: props.actions ?? null,
    verifier: props.verifier ?? null
  }), [props.sessionId, props.profile, profile, props.conversation, props.actions, props.verifier]);

  const [controller, setController] = useState(() => new AstrynCompanionController(deps));
  const [revision, setRevision] = useState(0);

  // 来源或宿主端口变化时必须重建控制器：否则订阅的是旧端口，
  // 新端口的回执与流式事件都进不到当前状态里。
  useEffect(() => {
    setController(() => new AstrynCompanionController(deps));
  }, [deps]);

  useEffect(() => {
    const detach = controller.attach();
    const unsubscribe = controller.subscribe(() => setRevision((n) => n + 1));
    return () => {
      unsubscribe();
      detach();
      controller.dispose();
    };
  }, [controller]);

  const state = controller.currentState;
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
    for (const message of controller.transcript) {
      entries.push({
        role: message.role === 'system' ? 'system' : message.role,
        text: message.content,
        synthetic: message.role === 'assistant' && synthetic,
        tone: 'normal'
      });
    }
    if (state.streamedText.length > 0) {
      entries.push({ role: 'assistant', text: state.streamedText, synthetic, tone: 'normal' });
    }
    if (state.failure) {
      entries.push({ role: 'system', text: `${state.failure.code}：${state.failure.message}`, synthetic: false, tone: 'error' });
    }
    return entries;
  }, [controller, state.streamedText, state.failure, synthetic, contextFragment, revision]);

  const handleSubmit = useCallback((text: string) => {
    void controller.submit(text);
  }, [controller]);

  const handleExplain = useCallback(() => {
    const provider = props.selectionProvider;
    if (!provider) return;
    void provider().then((fragment) => {
      if (!fragment) return;
      setContextFragment(fragment);
      controller.attachContext([fragment]);
      void controller.submit(`请解释我选中的这段内容，并给出它的来源标识。`);
    });
  }, [controller, props.selectionProvider]);

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
              applied: controller.audit.applied,
              rejected: controller.audit.rejected,
              lastRejectedReason: controller.audit.lastRejectedReason,
              verification: (() => {
                const verification = controller.audit.lastVerification;
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
            <button type="button" className="astryn-btn" data-testid="astryn-reply-length" onClick={() => setProfile(withOverrides(profile, { expressionStyle: { replyLength: profile.expressionStyle.replyLength === 'brief' ? 'detailed' : 'brief' } }))}>
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

      <ChatLog transcript={transcript} />
      <Composer
        streaming={streaming}
        disabled={false}
        onSubmit={handleSubmit}
        onCancel={() => controller.cancel('user')}
        onFocus={() => controller.notifyFocus('composer')}
        onBlur={() => controller.notifyBlur('composer')}
      />
      <div className="astryn-visually-hidden" aria-live="polite" data-testid="astryn-live-region">
        当前状态 {state.conversation}，任务 {state.task.status}
      </div>
    </div>
  );
}
