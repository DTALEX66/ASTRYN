import { useState, useSyncExternalStore } from 'react';
import { knowledgeRouting, SYNTHETIC_DOC } from '@astryn/core';
import type {
  AstrynContextFragment,
  AstrynKnowledgeRouting,
  AstrynLearningIntent,
  AstrynLearningMaterial,
  AstrynLearningTurn,
  AstrynMasteryLevel,
  AstrynRecallOutcome,
  AstrynSourceLink,
  AstrynTurnKind,
  LearningCompanionStore,
  LearningSnapshot
} from '@astryn/core';

export interface LearningPanelProps {
  readonly store: LearningCompanionStore;
  /** 模型可用性：缺模型时解释与对话关闭，但资料、复述、自评、复习照常（GF05 验收 2）。 */
  readonly modelAvailable: boolean;
  /** 从宿主选区拿一个经授权的上下文片段；失败返回 null。 */
  readonly onImportFragment: () => Promise<AstrynContextFragment | null>;
  /** 附带授权片段向会话提交"请解释"（仅片段可用时启用）。 */
  readonly onExplain: (fragment: AstrynContextFragment) => void;
  /** 读取共享会话里小栖当前的流式回复文本（开发宿主场景）。 */
  readonly readCharacterReply: () => string;
}

const INTENT_LABELS: Record<AstrynLearningIntent, string> = {
  attempt: '尝试',
  hint: '提示',
  explain: '解释',
  recall: '复述',
  feedback: '出处反馈',
  review: '复习'
};

const KIND_LABELS: Record<AstrynTurnKind, string> = {
  learning: '学习',
  'knowledge-answer': '知识回答',
  'companion-chat': '同伴闲聊'
};

const ROUTING_LABELS: Record<AstrynKnowledgeRouting['reason'], string> = {
  COMPANION_CHAT_EXCLUDED: '闲聊不自动入正式知识',
  SOURCE_UNLINKED: '无来源：不进知识通道',
  USER_INITIATED_ONLY: '仅本人手动可登记（永不自动）'
};

const MASTERY_LABELS: Record<AstrynMasteryLevel, string> = {
  unrated: '未评定',
  emerging: '起步',
  practiced: '在练',
  solid: '稳固'
};

const OUTCOME_LABELS: Record<AstrynRecallOutcome, string> = {
  correct: '想起来了',
  partial: '部分想起',
  missed: '没想起来'
};

function provenanceLabel(provenance: AstrynLearningMaterial['provenance']): string {
  if (provenance === 'aaos-knowledge') return 'AAOS 知识库';
  if (provenance === 'aaos-workspace') return 'AAOS 工作区';
  return '合成夹具';
}

function sourceLinkLabel(link: AstrynSourceLink): string {
  if (!link.linked) return '未关联材料';
  const origin = link.origin === 'authorized-fragment' ? '授权片段' : '登记材料';
  return `出处：${link.sourceTitle} ${link.sourceVersion}（${origin}，${link.evidenceLevel}）`;
}

function useLearningSnapshot(store: LearningCompanionStore): LearningSnapshot {
  return useSyncExternalStore(
    (callback) => store.subscribe(callback),
    () => store.snapshot
  );
}

/**
 * 学习陪伴面板（开发宿主专用，非正式产品）。
 * 所有学习状态归 LearningCompanionStore；本组件只做呈现与显式操作转发。
 */
export function LearningPanel(props: LearningPanelProps): JSX.Element {
  const { store, modelAvailable, onImportFragment, onExplain, readCharacterReply } = props;
  const snapshot = useLearningSnapshot(store);
  const [notice, setNotice] = useState('');
  const [goal, setGoal] = useState('理解这段材料的含义');
  const [recallDraft, setRecallDraft] = useState('');
  const [importedFragment, setImportedFragment] = useState<AstrynContextFragment | null>(null);
  const [fragmentMaterialId, setFragmentMaterialId] = useState<string | null>(null);

  const topic = snapshot.activeTopicMaterialId !== null ? store.materialById(snapshot.activeTopicMaterialId) : null;
  const activeJourney = (topic ? store.activeJourneyFor(topic.materialId) : null) ?? latestActive(snapshot);
  const journeyMaterial = activeJourney ? store.materialById(activeJourney.materialId) : null;
  const lastRatableTurn = activeJourney ? lastUserPracticeTurn(activeJourney.turns) : null;
  const pendingTurn =
    lastRatableTurn && !snapshot.outcomes.some((outcome) => outcome.turnId === lastRatableTurn.turnId) ? lastRatableTurn : null;
  const feedbackTurn = pendingTurn ?? lastRatableTurn;
  const feedbackMaterial =
    feedbackTurn && feedbackTurn.materialId !== null ? store.materialById(feedbackTurn.materialId) : null;
  const plan = store.reminderPlan();

  const importSelection = (): void => {
    void onImportFragment().then((fragment) => {
      if (!fragment) {
        setNotice('没有可用的授权片段：先在下方夹具文档里选中一段文字再试。');
        return;
      }
      const added = store.addMaterial({
        sourceId: fragment.sourceId,
        title: `${fragment.sourceTitle}（选区）`,
        version: fragment.sourceVersion,
        text: fragment.excerpt,
        provenance: fragment.provenance,
        evidenceLevel: fragment.evidenceLevel
      });
      if (!added.ok) {
        setNotice(`材料登记被拒：${added.reason}`);
        return;
      }
      setImportedFragment(fragment);
      setFragmentMaterialId(added.material.materialId);
      store.selectTopic(added.material.materialId);
      setNotice(`已登记材料「${added.material.title}」（${added.material.evidenceLevel}）。`);
    });
  };

  const importSample = (): void => {
    const added = store.addMaterial({
      sourceId: SYNTHETIC_DOC.sourceId,
      title: '合成夹具·宿主边界说明（全文）',
      version: SYNTHETIC_DOC.sourceVersion,
      text: SYNTHETIC_DOC.fullText,
      provenance: 'synthetic-fixture',
      evidenceLevel: 'SYNTHETIC'
    });
    if (!added.ok) {
      setNotice(`材料登记被拒：${added.reason}`);
      return;
    }
    setImportedFragment(null);
    setFragmentMaterialId(null);
    store.selectTopic(added.material.materialId);
    setNotice(`已登记材料「${added.material.title}」（无授权片段：解释将不可用，手工练习照常）。`);
  };

  const fragmentForJourney = (materialId: string): AstrynContextFragment | null =>
    importedFragment !== null && fragmentMaterialId === materialId ? importedFragment : null;

  return (
    <section className="astryn-root" data-testid="devhost-learning">
      <div className="astryn-title">
        学习陪伴 · 资料学习闭环（GF05） <span className="astryn-evidence-tag astryn-evidence-tag--synthetic">SYNTHETIC</span>
      </div>
      <p className="devhost-copy">
        六类学习意图（尝试/提示/解释/复述/出处反馈/复习）组织一轮轮练习；掌握度只来自你的显式自评，
        角色文本永不参与；闲聊与知识回答带明确类型与上下文标签，只有本人显式发起才可能登记为知识。
      </p>

      <fieldset className="devhost-group" data-testid="devhost-learning-materials">
        <legend>材料库（进程内，刷新即失；正式持久化归宿主，BLOCKED_BY_HOST_CONTRACT）</legend>
        <div className="astryn-toolbar">
          <button type="button" className="astryn-btn" data-testid="devhost-learning-import-selection" onClick={importSelection}>
            登记当前选区为学习材料
          </button>
          <button type="button" className="astryn-btn" data-testid="devhost-learning-import-sample" onClick={importSample}>
            登记内置合成材料（无授权片段）
          </button>
        </div>
        <ul className="devhost-candidates">
          {snapshot.materials.map((material) => (
            <li key={material.materialId} data-testid={`devhost-learning-material-${material.materialId}`}>
              {material.title} · {material.version} · {provenanceLabel(material.provenance)} · {material.evidenceLevel}
              <button
                type="button"
                className="astryn-btn devhost-inline-btn"
                data-testid={`devhost-learning-select-${material.materialId}`}
                aria-pressed={material.materialId === snapshot.activeTopicMaterialId}
                onClick={() => store.selectTopic(material.materialId)}
              >
                {material.materialId === snapshot.activeTopicMaterialId ? '当前话题' : '选为当前话题'}
              </button>
              <button
                type="button"
                className="astryn-btn devhost-inline-btn"
                data-testid={`devhost-learning-remove-${material.materialId}`}
                onClick={() => {
                  const removed = store.removeMaterial(material.materialId);
                  if (removed.ok) {
                    if (fragmentMaterialId === material.materialId) {
                      setImportedFragment(null);
                      setFragmentMaterialId(null);
                    }
                    setNotice('材料已移除：正文立即不可再读；练习历史与自评证据保留。');
                  }
                }}
              >
                移除
              </button>
            </li>
          ))}
          {snapshot.materials.length === 0 ? <li className="astryn-disclosure">（尚无材料）</li> : null}
        </ul>
        <div className="astryn-disclosure" data-testid="devhost-learning-topic">
          当前话题：{topic ? topic.title : '（未选择）'}
        </div>
      </fieldset>

      <fieldset className="devhost-group" data-testid="devhost-learning-journey">
        <legend>学习旅程</legend>
        <div className="astryn-toolbar">
          <input
            className="devhost-input"
            data-testid="devhost-learning-goal"
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            aria-label="本次学习目标"
          />
          <button
            type="button"
            className="astryn-btn"
            data-testid="devhost-learning-start"
            disabled={topic === null}
            onClick={() => {
              if (!topic) return;
              const started = store.startJourney({ materialId: topic.materialId, goal });
              setNotice(started.ok ? `旅程已开始：${started.journey.goal}` : `无法开始：${started.reason}`);
            }}
          >
            开始学习旅程
          </button>
          {activeJourney ? (
            <>
              <button
                type="button"
                className="astryn-btn"
                data-testid="devhost-learning-complete"
                onClick={() => {
                  store.closeJourney(activeJourney.journeyId, 'completed');
                  setNotice('旅程已完成：复习安排与自评证据继续保留。');
                }}
              >
                完成旅程
              </button>
              <button
                type="button"
                className="astryn-btn"
                data-testid="devhost-learning-abandon"
                onClick={() => {
                  store.closeJourney(activeJourney.journeyId, 'abandoned');
                  setNotice('旅程已放弃：已记录轮次保留为历史。');
                }}
              >
                放弃旅程
              </button>
            </>
          ) : null}
        </div>

        {activeJourney ? (
          <div data-testid="devhost-learning-active-journey">
            <p className="devhost-copy">
              进行中：「{activeJourney.goal}」 · 材料：{journeyMaterial ? journeyMaterial.title : '（已移除）'}
            </p>
            <div className="astryn-toolbar">
              <button
                type="button"
                className="astryn-btn"
                data-testid="devhost-learning-explain"
                disabled={!modelAvailable || fragmentForJourney(activeJourney.materialId) === null}
                title={
                  modelAvailable
                    ? fragmentForJourney(activeJourney.materialId) === null
                      ? '该材料没有授权片段：解释需要材料片段在场（可先用选区登记材料）'
                      : '附带授权片段提交给会话'
                    : '未接通模型：解释与对话不可用；复述、自评与复习不受影响'
                }
                onClick={() => {
                  const fragment = fragmentForJourney(activeJourney.materialId);
                  if (fragment) {
                    onExplain(fragment);
                    setNotice('已向会话提交解释请求（附带授权片段）。');
                  }
                }}
              >
                请小栖解释（附授权片段）
              </button>
              <button
                type="button"
                className="astryn-btn"
                data-testid="devhost-learning-capture-explain"
                onClick={() => {
                  const text = readCharacterReply().trim();
                  if (text.length === 0) {
                    setNotice('小栖还没有回复：先在左侧会话里请她解释。');
                    return;
                  }
                  const recorded = store.recordTurn({
                    journeyId: activeJourney.journeyId,
                    kind: 'learning',
                    intent: 'explain',
                    author: 'character',
                    text,
                    materialId: activeJourney.materialId,
                    fragment: fragmentForJourney(activeJourney.materialId)
                  });
                  setNotice(recorded.ok ? '已把当前回复记为「解释」轮。' : `记录被拒：${recorded.reason}`);
                }}
              >
                记下小栖的解释
              </button>
              <button
                type="button"
                className="astryn-btn"
                data-testid="devhost-learning-capture-hint"
                onClick={() => {
                  const text = readCharacterReply().trim();
                  if (text.length === 0) {
                    setNotice('小栖还没有回复：先请她给一条提示。');
                    return;
                  }
                  const recorded = store.recordTurn({
                    journeyId: activeJourney.journeyId,
                    kind: 'learning',
                    intent: 'hint',
                    author: 'character',
                    text,
                    materialId: activeJourney.materialId,
                    fragment: fragmentForJourney(activeJourney.materialId)
                  });
                  setNotice(recorded.ok ? '已把当前回复记为「提示」轮。' : `记录被拒：${recorded.reason}`);
                }}
              >
                记下小栖的提示
              </button>
            </div>
            <ul className="devhost-candidates">
              {activeJourney.turns.map((turn) => (
                <li key={turn.turnId} data-testid={`devhost-learning-turn-${turn.turnId}`}>
                  <span className="astryn-chip">{KIND_LABELS[turn.kind]}</span>{' '}
                  {turn.intent ? <span className="astryn-chip">{INTENT_LABELS[turn.intent]}</span> : null}{' '}
                  <span className="astryn-chip">{turn.author === 'user' ? '我' : '小栖'}</span> {turn.text}
                  <div className="astryn-disclosure">
                    {sourceLinkLabel(turn.sourceLink)} · {ROUTING_LABELS[knowledgeRouting(turn).reason]}
                  </div>
                </li>
              ))}
              {activeJourney.turns.length === 0 ? <li className="astryn-disclosure">（本旅程尚无轮次）</li> : null}
            </ul>
          </div>
        ) : (
          <div className="astryn-disclosure" data-testid="devhost-learning-active-journey">（没有进行中的旅程）</div>
        )}
        <ul className="devhost-candidates" data-testid="devhost-learning-journey-history">
          {[...snapshot.journeys].reverse().map((journey) => {
            const material = store.materialById(journey.materialId);
            const stateLabel = journey.state === 'active' ? '进行中' : journey.state === 'completed' ? '已完成' : '已放弃';
            return (
              <li key={journey.journeyId} data-testid={`devhost-learning-journey-${journey.journeyId}`}>
                {journey.goal} · <span className="astryn-chip">{stateLabel}</span> · {material ? material.title : '（材料已移除）'} · {journey.turns.length} 轮
              </li>
            );
          })}
          {snapshot.journeys.length === 0 ? <li className="astryn-disclosure">（尚无旅程）</li> : null}
        </ul>
      </fieldset>

      <fieldset className="devhost-group" data-testid="devhost-learning-practice">
        <legend>手工练习（不需要模型）</legend>
        <textarea
          className="devhost-textarea"
          data-testid="devhost-learning-recall-input"
          value={recallDraft}
          onChange={(event) => setRecallDraft(event.target.value)}
          placeholder="凭记忆写下这段材料在说什么（复述）"
          aria-label="我的复述"
        />
        <div className="astryn-toolbar">
          <button
            type="button"
            className="astryn-btn"
            data-testid="devhost-learning-attempt-submit"
            onClick={() => {
              if (!activeJourney) {
                setNotice('先开始一段学习旅程再记录尝试。');
                return;
              }
              const recorded = store.recordTurn({
                journeyId: activeJourney.journeyId,
                kind: 'learning',
                intent: 'attempt',
                author: 'user',
                text: recallDraft,
                materialId: activeJourney.materialId
              });
              if (!recorded.ok) {
                setNotice(`尝试未记录：${recorded.reason}`);
                return;
              }
              setRecallDraft('');
              setNotice('已记录尝试。可以给自己一个显式结果，或先记录复述再自评。');
            }}
          >
            记录尝试回答
          </button>
          <button
            type="button"
            className="astryn-btn"
            data-testid="devhost-learning-recall-submit"
            onClick={() => {
              if (!activeJourney) {
                setNotice('先开始一段学习旅程再记录复述。');
                return;
              }
              const recorded = store.recordTurn({
                journeyId: activeJourney.journeyId,
                kind: 'learning',
                intent: 'recall',
                author: 'user',
                text: recallDraft,
                materialId: activeJourney.materialId
              });
              if (!recorded.ok) {
                setNotice(`复述未记录：${recorded.reason}`);
                return;
              }
              setRecallDraft('');
              setNotice('已记录复述。对照下面的原文，然后给自己一个显式结果。');
            }}
          >
            记录复述
          </button>
          {(['correct', 'partial', 'missed'] as const).map((result) => (
            <button
              key={result}
              type="button"
              className="astryn-btn"
              data-testid={`devhost-learning-outcome-${result}`}
              disabled={activeJourney === null || pendingTurn === null}
              onClick={() => {
                if (!activeJourney || !pendingTurn) return;
                const recorded = store.recordOutcome({
                  journeyId: activeJourney.journeyId,
                  turnId: pendingTurn.turnId,
                  result
                });
                setNotice(recorded.ok ? `已自评：${OUTCOME_LABELS[result]}（掌握度与复习队列已更新）` : `自评未记录：${recorded.reason}`);
              }}
            >
              {OUTCOME_LABELS[result]}
            </button>
          ))}
        </div>
        <div className="astryn-disclosure" data-testid="devhost-learning-feedback">
          {feedbackTurn === null
            ? '出处反馈：记录一段复述后，这里会把该材料原文摆出来供你对照——反馈只引用登记材料，不生成权威结论。'
            : feedbackTurn.materialId === null
              ? '出处反馈：该轮未关联材料，不提供出处引用（不虚构来源）。'
              : feedbackMaterial === null
                ? '出处反馈：材料已被移除，无法对照原文；练习历史仍保留。'
                : `出处反馈（对照原文，${feedbackMaterial.title}）：${feedbackMaterial.text}`}
        </div>
      </fieldset>

      <fieldset className="devhost-group" data-testid="devhost-learning-review">
        <legend>复习队列（仅由显式自评排程）</legend>
        <div className="astryn-toolbar">
          <button
            type="button"
            className="astryn-btn"
            data-testid="devhost-learning-reminders-toggle"
            aria-pressed={snapshot.mindset.proactiveReminders}
            onClick={() => {
              store.setProactiveReminders(!snapshot.mindset.proactiveReminders);
              setNotice(snapshot.mindset.proactiveReminders ? '主动提醒已关闭：队列保留，不再主动提示。' : '主动提醒已开启。');
            }}
          >
            主动提醒：{snapshot.mindset.proactiveReminders ? '开' : '关'}
          </button>
          <button
            type="button"
            className="astryn-btn"
            data-testid="devhost-learning-focus-toggle"
            aria-pressed={snapshot.mindset.focusMode}
            onClick={() => {
              store.setFocusMode(!snapshot.mindset.focusMode);
              setNotice(snapshot.mindset.focusMode ? '已退出专注模式。' : '已进入专注模式：主动提醒暂停。');
            }}
          >
            专注模式：{snapshot.mindset.focusMode ? '开' : '关'}
          </button>
        </div>
        <div className="astryn-disclosure" data-testid="devhost-learning-nudge-note">
          {plan.suppressedBy === 'REMINDERS_OFF'
            ? `主动提醒已关闭：${plan.due.length} 项到期仅列在队列里。`
            : plan.suppressedBy === 'FOCUS_MODE'
              ? `专注模式中：${plan.due.length} 项到期提示已暂停。`
              : plan.due.length === 0
                ? '没有到期的复习项。'
                : `${plan.due.length} 项到期。`}
        </div>
        <ul className="devhost-candidates">
          {plan.due.map((item) => {
            const material = store.materialById(item.materialId);
            return (
              <li key={item.materialId} data-testid={`devhost-learning-due-${item.materialId}`}>
                {material ? material.title : '(已移除)'} · 步进 {item.step + 1} · 到期 {item.dueAt.slice(11, 16)}Z
                <button
                  type="button"
                  className="astryn-btn devhost-inline-btn"
                  data-testid={`devhost-learning-review-now-${item.materialId}`}
                  onClick={() => {
                    const active = store.activeJourneyFor(item.materialId);
                    let target = active;
                    if (!target) {
                      const started = store.startJourney({ materialId: item.materialId, goal: '复习' });
                      if (!started.ok) {
                        setNotice(`无法开始复习：${started.reason}`);
                        return;
                      }
                      target = started.journey;
                    }
                    const recorded = store.recordTurn({
                      journeyId: target.journeyId,
                      kind: 'learning',
                      intent: 'review',
                      author: 'user',
                      text: `复习：${material ? material.title : item.materialId}`,
                      materialId: item.materialId
                    });
                    setNotice(recorded.ok ? '已开始复习：写下一次复述并自评，队列会按结果重排。' : `复习轮未记录：${recorded.reason}`);
                  }}
                >
                  现在复习
                </button>
              </li>
            );
          })}
          {plan.due.length === 0 ? <li className="astryn-disclosure">（无到期项）</li> : null}
        </ul>
      </fieldset>

      <fieldset className="devhost-group" data-testid="devhost-learning-mastery">
        <legend>掌握度（仅由你的显式自评驱动）</legend>
        <ul className="devhost-candidates">
          {snapshot.materials.map((material) => {
            const reading = store.masteryFor(material.materialId);
            const scheduled = store.reviewStateFor(material.materialId);
            return (
              <li key={material.materialId} data-testid={`devhost-learning-mastery-${material.materialId}`}>
                {material.title}：<span className="astryn-chip">{MASTERY_LABELS[reading.level]}</span> · 自评 {reading.outcomeCount} 次（想起 {reading.correctCount} 次）· 依据：{reading.basis} ·
                {scheduled ? ` 下次复习 ${scheduled.dueAt.slice(0, 16).replace('T', ' ')}Z · 步进 ${scheduled.step + 1}` : ' 尚未排程'}
              </li>
            );
          })}
          {snapshot.materials.length === 0 ? <li className="astryn-disclosure">（尚无材料）</li> : null}
        </ul>
      </fieldset>

      <fieldset className="devhost-group" data-testid="devhost-learning-context-log">
        <legend>上下文标签记录（未绑定旅程的轮次）</legend>
        <div className="astryn-toolbar">
          <button
            type="button"
            className="astryn-btn"
            data-testid="devhost-learning-log-chat"
            onClick={() => {
              const recorded = store.recordTurn({
                kind: 'companion-chat',
                author: 'user',
                text: '（闲聊示例）今天天气真好呀，我们晚点再学吧。'
              });
              setNotice(recorded.ok ? '已记录一句闲聊：注意它不自动进入正式知识。' : `记录被拒：${recorded.reason}`);
            }}
          >
            记录一句闲聊（守卫演示）
          </button>
          <button
            type="button"
            className="astryn-btn"
            data-testid="devhost-learning-log-knowledge"
            onClick={() => {
              const recorded = store.recordTurn({
                kind: 'knowledge-answer',
                author: 'character',
                text: '（知识回答示例）光合作用把光能转化为化学能。'
              });
              setNotice(recorded.ok ? '已记录一条无来源知识回答：不进知识通道。' : `记录被拒：${recorded.reason}`);
            }}
          >
            记录一条知识回答（守卫演示）
          </button>
        </div>
        <ul className="devhost-candidates">
          {[...snapshot.contextLog].reverse().map((turn) => (
            <li key={turn.turnId} data-testid={`devhost-learning-context-${turn.turnId}`}>
              <span className="astryn-chip">{KIND_LABELS[turn.kind]}</span> {turn.text}
              <div className="astryn-disclosure">
                {sourceLinkLabel(turn.sourceLink)} · {ROUTING_LABELS[knowledgeRouting(turn).reason]}
              </div>
            </li>
          ))}
          {snapshot.contextLog.length === 0 ? <li className="astryn-disclosure">（尚无记录）</li> : null}
        </ul>
      </fieldset>

      <div className="astryn-disclosure" data-testid="devhost-learning-notice">{notice}</div>
    </section>
  );
}

function latestActive(snapshot: LearningSnapshot) {
  return [...snapshot.journeys].reverse().find((journey) => journey.state === 'active') ?? null;
}

function lastUserPracticeTurn(turns: readonly AstrynLearningTurn[]): AstrynLearningTurn | null {
  return [...turns].reverse().find((turn) => turn.author === 'user' && (turn.intent === 'attempt' || turn.intent === 'recall')) ?? null;
}
