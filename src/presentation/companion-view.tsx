import { useEffect, useRef, useState } from 'react';
import type {
  AstrynAvatarFrame,
  AstrynAvatarRenderer,
  AstrynAvatarViewProfile,
  AstrynCharacterProfile,
  AstrynCompanionState,
  AstrynContextFragment
} from '@astryn/contracts';
import { toVisibleState } from '@astryn/contracts';
import { fallbackAvatarRenderer, resolveAvatarRenderer } from '../avatar/renderer-registry';

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

export interface AvatarViewProps {
  readonly state: AstrynCompanionState;
  readonly profile: AstrynCharacterProfile;
  readonly reducedMotion: boolean;
  /** 呈现档（首页/头像/侧边）。缺省用渲染器的整幅半身。 */
  readonly view?: AstrynAvatarViewProfile | undefined;
  /** 驱动注入：故障注入测试与宿主自定义驱动；缺省按 profile.appearance.rendererId 选择。 */
  readonly renderer?: AstrynAvatarRenderer | undefined;
}

export function AvatarView({ state, profile, reducedMotion, view, renderer }: AvatarViewProps): JSX.Element {
  const visibleState = toVisibleState(state);
  const resolution = renderer
    ? { renderer, exact: true, reason: null as string | null }
    : resolveAvatarRenderer(profile.appearance.rendererId);
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
  const markupHost = useRef<HTMLDivElement | null>(null);
  const [mountFailed, setMountFailed] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);

  // 位图加载失败（文件缺失/损坏）回退到 SVG 下限：与"未注册 id"走同一条回退路径，
  // 且以 data-renderer-fallback=image-error 显式作证，不静默冒充交付成功。
  const selected = imageFailed ? fallbackAvatarRenderer() : resolution.renderer;

  // 渲染失败可回退：标记渲染抛错或命令式挂载失败时，退到可读的文本状态行，
  // 绝不把错误细节或外部文本写进 DOM（注入不变量的另一半）。
  let markup: string | undefined;
  let renderFailed = mountFailed;
  if (!renderFailed) {
    try {
      markup = selected.renderMarkup?.(frame, undefined, view);
    } catch {
      renderFailed = true;
    }
  }

  // <img> 的 error 事件是异步的：挂载后监听，响应后再切换 selected。
  // 已 complete 且 naturalWidth=0 的图（失败发生在 effect 之前）当场判定。
  useEffect(() => {
    if (imageFailed || renderFailed || markup === undefined || !markupHost.current) return;
    const img = markupHost.current.querySelector('img');
    if (!img) return;
    const onError = (): void => setImageFailed(true);
    if (img.complete && img.naturalWidth === 0) {
      onError();
      return;
    }
    img.addEventListener('error', onError);
    return () => img.removeEventListener('error', onError);
  }, [markup, imageFailed, renderFailed]);

  // 命令式驱动（WebGL / Live2D）走 mount 分支；SVG 驱动走标记分支。UI 不认识具体实现。
  // 依赖列到 frame 的每个字段：只在画面输入真实变化时重建实例，避免逐帧 dispose/remount。
  useEffect(() => {
    if (renderFailed || markup !== undefined || !selected.mount || !mountHost.current) return;
    try {
      const instance = selected.mount(mountHost.current, frame);
      return () => {
        instance.dispose();
      };
    } catch {
      setMountFailed(true);
    }
  }, [renderFailed, markup, selected, frame.visibleState, frame.expressionFrame, frame.reducedMotion, frame.streamedText, frame.taskStep, frame.failureMessage]);

  // 未注册 rendererId 的静默回退是"未知当作可用"，这里显式作证：data-renderer-exact=false。
  const exactAttr = resolution.exact ? undefined : 'false';
  const fallbackAttr = imageFailed ? 'image-error' : undefined;
  if (renderFailed) {
    return (
      <div
        className="astryn-avatar astryn-avatar--fallback"
        data-renderer={selected.rendererId}
        data-renderer-exact={exactAttr}
        data-testid="astryn-avatar-fallback"
        role="img"
        aria-label={`小栖当前状态：${visibleState}（画面渲染失败，已回退文本）`}
      >
        <span className="astryn-chip">状态：{visibleState}（渲染失败，文本回退）</span>
      </div>
    );
  }
  if (markup !== undefined) {
    // markup 由内部常量与数值拼装，不含任何外部文本，见 xiaoqi-svg-renderer 的注入不变量。
    return (
      <div
        className="astryn-avatar"
        data-renderer={selected.rendererId}
        data-renderer-exact={exactAttr}
        data-renderer-fallback={fallbackAttr}
        data-testid="astryn-avatar-host"
        ref={markupHost}
        dangerouslySetInnerHTML={{ __html: markup }}
      />
    );
  }
  return <div className="astryn-avatar" data-renderer={selected.rendererId} data-renderer-exact={exactAttr} data-testid="astryn-avatar-host" ref={mountHost} />;
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

export interface ComposerProps {
  /** 受控草稿：由外壳持有，打开设置/隐藏角色/重试时都不丢输入。 */
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  /** 已附到下一轮、尚未提交的获准材料标签。 */
  readonly attachments: readonly AstrynContextFragment[];
  readonly onRemoveAttachment: (index: number) => void;
  readonly onSubmit: (text: string) => void;
  readonly onCancel: () => void;
  readonly onFocus: () => void;
  readonly onBlur: () => void;
  readonly streaming: boolean;
}

export function Composer({
  value,
  onValueChange,
  attachments,
  onRemoveAttachment,
  onSubmit,
  onCancel,
  onFocus,
  onBlur,
  streaming
}: ComposerProps): JSX.Element {
  return (
    <form
      className="astryn-composer"
      onSubmit={(event) => {
        event.preventDefault();
        if (value.trim().length === 0) return;
        onSubmit(value);
      }}
    >
      {attachments.length > 0 ? (
        <div className="astryn-composer-tags" data-testid="astryn-composer-tags" aria-label="已附加材料标签">
          {attachments.map((fragment, index) => (
            <span key={`${fragment.sourceId}-${index}`} className="astryn-chip astryn-chip--tag" data-testid={`astryn-attachment-${index}`}>
              {fragment.sourceTitle} {fragment.sourceVersion}
              <button
                type="button"
                className="astryn-chip-remove"
                aria-label={`移除材料标签：${fragment.sourceTitle}`}
                data-testid={`astryn-attachment-remove-${index}`}
                onClick={() => onRemoveAttachment(index)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <input
        data-testid="astryn-input"
        value={value}
        placeholder="和小栖说点什么…"
        aria-label="发送给小栖的消息"
        onChange={(event) => onValueChange(event.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
      />
      <button type="submit" className="astryn-btn" data-testid="astryn-send" disabled={streaming || value.trim().length === 0}>发送</button>
      {streaming ? (
        <button type="button" className="astryn-btn astryn-btn--stop" data-testid="astryn-stop" onClick={onCancel}>停止生成</button>
      ) : null}
    </form>
  );
}

export interface RetryBarProps {
  readonly candidate: {
    readonly text: string;
    readonly failureCode: string | null;
    readonly cause: 'failed' | 'cancelled';
    readonly outcomeUnknown: boolean;
  };
  readonly onRetry: () => void;
}

/**
 * 重试条：展示"输入已保留"，并预告将先查询原请求还是直接重发。
 * 它只转发一次重试意图，不做任何自行重发。
 */
export function RetryBar({ candidate, onRetry }: RetryBarProps): JSX.Element {
  return (
    <div className="astryn-retry" data-testid="astryn-retry" role="group" aria-label="重试上一轮">
      <span data-testid="astryn-retry-text">
        上一轮{candidate.cause === 'cancelled' ? '已停止' : '未完成'}（{candidate.failureCode ?? '未知原因'}）：输入已保留——「{candidate.text}」
      </span>
      <span className="astryn-disclosure" data-testid="astryn-retry-hint">
        {candidate.outcomeUnknown ? '执行结果未知：重试会先查询原请求，再决定是否重发。' : '执行结果已知（未执行）：重试将直接重发。'}
      </span>
      <button type="button" className="astryn-btn" data-testid="astryn-retry-btn" onClick={onRetry}>重试</button>
    </div>
  );
}
