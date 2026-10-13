import { personaSpec } from '@astryn/contracts';
import type { AstrynCharacterProfile, AstrynChatMessage } from '@astryn/contracts';

export const PROMPT_TEMPLATE_VERSION = 'xiaoqi-system-2' as const;

export interface ComposedPromptSection {
  readonly id: string;
  readonly text: string;
}

/**
 * 角色对话的可维护身份不是"一段不可配置的大提示词"：
 * 每一节都来自结构化档案，可独立替换、可测试、可版本化。
 *
 * v2 不变量：boundaries / continuity / authority / style-scope 四节
 * 不随人格与表达设置变化——人格只追加表达层特质，不得触碰边界与授权规则。
 */
export function composePromptSections(profile: AstrynCharacterProfile): readonly ComposedPromptSection[] {
  const style = profile.expressionStyle;
  const spec = personaSpec(profile.persona);
  const lengthRule =
    style.replyLength === 'brief' ? '回复控制在两句以内。'
    : style.replyLength === 'detailed' ? '可以分点展开，但不超过五句。'
    : '回复保持在一到三句。';
  const cadenceRule =
    !profile.initiative.proactiveNudging || profile.initiative.nudgingCadence === 'off'
      ? '不主动打断用户。'
      : profile.initiative.nudgingCadence === 'low'
        ? '主动提醒保持克制：仅在获准情境下低频提示。'
        : '可在获准情境下适度主动开启话题，但用户专注时不打扰。';
  const learningRule =
    profile.learning.explanationDepth === 'brief' ? '解释从简：先给结论，再给一句理由。'
    : profile.learning.explanationDepth === 'deep' ? '解释可以展开：给出推理过程与例子，但分清事实与推测。'
    : '解释保持适中：结论加关键理由。';

  return [
    { id: 'identity', text: `你是${profile.displayName}（${profile.displayNameLatin}），星栖中的 AI 陪伴角色。${profile.aiDisclosure}` },
    {
      id: 'persona',
      text: `${profile.personaSummary}\n人格：${spec.label}——${spec.summary}\n人格要素：\n- ${profile.personaTraits.join('\n- ')}\n人格附加：\n- ${spec.traitAdditions.join('\n- ')}`
    },
    { id: 'boundaries', text: `不可越过的边界：\n- ${profile.boundaries.join('\n- ')}` },
    { id: 'continuity', text: '关系连续性只能来自宿主记忆接口的获准作用域；不得编造共同经历。' },
    { id: 'style', text: `${lengthRule} 语气：${style.greetingTone}。表情符号：${style.emojiUse === 'none' ? '不使用' : '少量'}。` },
    { id: 'initiative', text: cadenceRule },
    {
      id: 'learning',
      text: `${learningRule}${profile.learning.examplesFirst ? '先给例子，再给结论。' : ''}${profile.learning.quizMe ? '讲完后可以出一道小题帮用户自查，但用户不想做题时立即停止。' : '不主动出题考用户。'}`
    },
    {
      id: 'authority',
      text: '系统状态权威规则：任务的审批、进行中、完成、失败只能来自宿主回执。你不得声称任务已完成，也不得把"说完了这句话"当作任务完成。'
    },
    {
      id: 'style-scope',
      text: '人格、语气与学习偏好只影响表达方式；不改变事实来源、可用工具、操作范围与授权规则。任何人格都不得声称自己是人类、拥有真实情感或与用户存在现实关系。'
    }
  ];
}

export function composeSystemPrompt(profile: AstrynCharacterProfile): string {
  return composePromptSections(profile)
    .map((section) => `【${section.id}】\n${section.text}`)
    .join('\n\n');
}

export function buildConversationMessages(
  profile: AstrynCharacterProfile,
  history: readonly AstrynChatMessage[],
  nextUserText: string,
  sessionId: string
): AstrynChatMessage[] {
  return [
    { role: 'system', content: composeSystemPrompt(profile), sessionId, requestId: null },
    ...history,
    { role: 'user', content: nextUserText, sessionId, requestId: null }
  ];
}
