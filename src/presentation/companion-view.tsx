import { useEffect, useRef, useState } from 'react';
import type {
  AstrynAvatarFrame,
  AstrynCharacterProfile,
  AstrynCompanionState,
  AstrynContextFragment
} from '@astryn/contracts';
import { toVisibleState } from '@astryn/contracts';
import { selectAvatarRenderer } from '../avatar/xiaoqi-svg-renderer';

export interface CompanionViewProps {
  readonly state: AstrynCompanionState;
  readonly profile: AstrynCharacterProfile;
  readonly transcript: readonly TranscriptEntry[];
  readonly onSubmit: (text: string) => void;
  readonly onCancel: () => void;
  readonly onHide: () => void;
  readonly onToggleMotion: () => void;
  readonly onApprovalDecision: (approved: boolean) => void;
  readonly onExplainSelection: () => void;
  readonly reducedMotion: boolean;
  readonly hidden: boolean;
  readonly lastContextFragment: AstrynContextFragment | null;
}

export interface TranscriptEntry {
  readonly role: 'user' | 'assistant' | 'system';
  readonly text: string;
  readonly synthetic: boolean;
  readonly tone: 'normal' | 'error';
}

function rejectedTotal(rejected: Readonly<Record<string, number>>): number {
  return Object.values(rejected).reduce((sum, count) => sum + count, 0);
}

export function AvatarView({ state, profile, reducedMotion }: Pick<CompanionViewProps, 'state' | 'profile' | 'reducedMotion'>): JSX.Element {
  const visibleState = toVisibleState(state);
  const renderer = selectAvatarRenderer(profile.appearance.rendererId);
  const frame: AstrynAvatarFrame = {
    characterId: profile.characterId,
    sessionId: state.sessionId,
    visibleState,
    expressionFrame: state.expressionFrame,
    streamedText: state.streamedText,
    taskStep: state.task.step,
    failureMessage: state.failure?.message ?? null,
    reducedMotion
  };
  const mountHost = useRef<HTMLDivElement | null>(null);
  const markup = renderer.renderMarkup?.(frame);

  // 命令式驱动（WebGL / Live2D）走 mount 分支；SVG 驱动走标记分支。UI 不认识具体实现。
  useEffect(() => {
    if (markup !== undefined || !renderer.mount || !mountHost.current) return;
    const instance = renderer.mount(mountHost.current, frame);
    return () => {
      instance.dispose();
    };
  });

  // markup 由内部常量与数值拼装，不含任何外部文本，见 xiaoqi-svg-renderer 的注入不变量。
  if (markup !== undefined) {
    return <div className="astryn-avatar" data-renderer={renderer.rendererId} data-testid="astryn-avatar-host" dangerouslySetInnerHTML={{ __html: markup }} />;
  }
  return <div className="astryn-avatar" data-renderer={renderer.rendererId} data-testid="astryn-avatar-host" ref={mountHost} />;
}

export interface AuditChip {
  readonly applied: number;
  readonly rejected: Readonly<Record<string, number>>;
  readonly lastRejectedReason: string | null;
  readonly verification: string | null;
}

export function StatusStrip({ state, audit }: { readonly state: AstrynCompanionState; readonly audit?: AuditChip | undefined }): JSX.Element {
  const visibleState = toVisibleState(state);
  return (
    <div className="astryn-state-strip" data-testid="astryn-state-strip">
      <span className="astryn-chip" data-testid="astryn-visible-state">状态：{visibleState}</span>
      <span className="astryn-chip">口型帧：{state.expressionFrame}</span>
      {audit ? (
        <span className="astryn-chip" data-testid="astryn-audit">
          审计：应用 {audit.applied} · 丢弃 {rejectedTotal(audit.rejected)}
          {audit.lastRejectedReason ? ` · ${audit.lastRejectedReason}` : ''}
          {audit.verification ? ` · 回执 ${audit.verification}` : ''}
        </span>
      ) : null}
      <span className={`astryn-chip ${state.model.available ? '' : 'astryn-chip--error'}`} data-testid="astryn-model-chip">
        模型：{state.model.available ? `${state.model.providerId ?? '?'} / ${state.model.evidenceLevel}` : 'MODEL_UNAVAILABLE'}
      </span>
      {state.task.taskId ? <span className="astryn-chip astryn-chip--task" data-testid="astryn-task-chip">任务：{state.task.status} · {state.task.taskId}</span> : null}
      {state.failure ? <span className="astryn-chip astryn-chip--error" data-testid="astryn-failure-chip">{state.failure.code}：{state.failure.message}</span> : null}
    </div>
  );
}

export function ChatLog({ transcript }: { readonly transcript: readonly TranscriptEntry[] }): JSX.Element {
  return (
    <div className="astryn-log" data-testid="astryn-log" role="log" aria-live="polite">
      {transcript.length === 0 ? <div className="astryn-msg astryn-msg--system">还没有对话。输入一句话，或先选中夹具文档里的文字让我和她一起解释。</div> : null}
      {transcript.map((entry, index) => (
        <div
          key={`${entry.role}-${index}`}
          data-testid={`astryn-msg-${index}`}
          className={`astryn-msg astryn-msg--${entry.role}${entry.tone === 'error' ? ' astryn-msg--error' : ''}`}
        >
          {entry.synthetic ? <span className="astryn-evidence-tag astryn-evidence-tag--synthetic">SYNTHETIC</span> : null}
          {entry.text}
        </div>
      ))}
    </div>
  );
}

export function ApprovalCard({ state, onApprovalDecision }: Pick<CompanionViewProps, 'state' | 'onApprovalDecision'>): JSX.Element | null {
  if (state.task.status !== 'awaiting_approval') return null;
  return (
    <div className="astryn-approval" data-testid="astryn-approval-card" role="group" aria-label="宿主审批请求">
      <strong>需要你的授权</strong>
      <span>{state.task.actionSummary ?? '（无摘要）'}</span>
      <span>风险级：{state.task.riskTier ?? 'unknown'} · 任务：{state.task.taskId ?? '-'}</span>
      <div className="astryn-toolbar">
        <button type="button" className="astryn-btn" data-testid="astryn-approve" onClick={() => onApprovalDecision(true)}>允许</button>
        <button type="button" className="astryn-btn astryn-btn--stop" data-testid="astryn-deny" onClick={() => onApprovalDecision(false)}>拒绝</button>
      </div>
    </div>
  );
}

export function Composer({ onSubmit, onCancel, onFocus, onBlur, streaming, disabled }: {
  readonly onSubmit: (text: string) => void;
  readonly onCancel: () => void;
  readonly onFocus: () => void;
  readonly onBlur: () => void;
  readonly streaming: boolean;
  readonly disabled: boolean;
}): JSX.Element {
  const [draft, setDraft] = useState('');
  return (
    <form
      className="astryn-composer"
      onSubmit={(event) => {
        event.preventDefault();
        if (draft.trim().length === 0) return;
        onSubmit(draft);
        setDraft('');
      }}
    >
      <input
        data-testid="astryn-input"
        value={draft}
        disabled={disabled}
        placeholder={disabled ? '角色已隐藏' : '和小栖说点什么…'}
        aria-label="发送给小栖的消息"
        onChange={(event) => setDraft(event.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
      />
      <button type="submit" className="astryn-btn" data-testid="astryn-send" disabled={streaming || draft.trim().length === 0}>发送</button>
      {streaming ? (
        <button type="button" className="astryn-btn astryn-btn--stop" data-testid="astryn-stop" onClick={onCancel}>停止生成</button>
      ) : null}
    </form>
  );
}
