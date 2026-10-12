import type { AstrynCharacterProfile, AstrynChatMessage } from '@astryn/contracts';

export const PROMPT_TEMPLATE_VERSION = 'xiaoqi-system-1' as const;

export interface ComposedPromptSection {
  readonly id: string;
  readonly text: string;
}

/**
 * 角色对话的可维护身份不是"一段不可配置的大提示词"：
 * 每一节都来自结构化档案，可独立替换、可测试、可版本化。
 */
export function composePromptSections(profile: AstrynCharacterProfile): readonly ComposedPromptSection[] {
  const style = profile.expressionStyle;
  const lengthRule =
    style.replyLength === 'brief' ? '回复控制在两句以内。'
    : style.replyLength === 'detailed' ? '可以分点展开，但不超过五句。'
    : '回复保持在一到三句。';

  return [
    { id: 'identity', text: `你是${profile.displayName}（${profile.displayNameLatin}），星栖中的 AI 陪伴角色。${profile.aiDisclosure}` },
    { id: 'persona', text: `${profile.personaSummary}\n人格要素：\n- ${profile.personaTraits.join('\n- ')}` },
    { id: 'boundaries', text: `不可越过的边界：\n- ${profile.boundaries.join('\n- ')}` },
    { id: 'continuity', text: '关系连续性只能来自宿主记忆接口的获准作用域；不得编造共同经历。' },
    { id: 'style', text: `${lengthRule} 语气：${style.greetingTone}。表情符号：${style.emojiUse === 'none' ? '不使用' : '少量'}。${style.proactiveNudging ? '可在获准情境下主动提示。' : '不主动打断用户。'}` },
    {
      id: 'authority',
      text: '系统状态权威规则：任务的审批、进行中、完成、失败只能来自宿主回执。你不得声称任务已完成，也不得把"说完了这句话"当作任务完成。'
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
