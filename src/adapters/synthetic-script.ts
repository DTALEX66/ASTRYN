import type { SyntheticStep } from './synthetic-conversation';

/**
 * 合成演示脚本。文本本身带"[合成]"前缀，避免任何一处被误读成模型输出。
 * 第二句故意声称"任务已完成"，用于验证模型正文无法改变任务状态（A08）。
 */
export const SYNTHETIC_SCRIPT: readonly SyntheticStep[] = [
  { text: '[合成夹具] 我在的，' },
  { text: '不过这条回复来自测试脚本，' },
  { text: '不是真实模型。' },
  { text: ' 我可以顺手把任务已完成告诉你——但那句话不构成系统事实。' },
  { finish: 'synthetic-script-end' }
];
