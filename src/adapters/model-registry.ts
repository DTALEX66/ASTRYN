import type { AstrynConversationPort, AstrynModelSourceInfo } from '@astryn/contracts';
import { OpenAiCompatibleConversationPort } from './openai-compatible';
import { SyntheticConversationPort } from './synthetic-conversation';
import { AaosHostBridge } from './aaos-bridge';
import { SYNTHETIC_SCRIPT } from './synthetic-script';

export interface ModelRegistryInput {
  readonly aaosBaseUrl: string | null;
  readonly devProxyConfigured: boolean;
  readonly devProxyModel: string | null;
  /** 必须显式开启，合成传输永不作为默认回复来源。 */
  readonly allowSynthetic: boolean;
}

export interface ResolvedConversation {
  readonly port: AstrynConversationPort | null;
  readonly info: AstrynModelSourceInfo;
  readonly bridge: AaosHostBridge | null;
  readonly trace: readonly string[];
}

const UNAVAILABLE = (reason: string, trace: readonly string[], bridge: AaosHostBridge | null): ResolvedConversation => ({
  port: null,
  info: { kind: 'none', providerId: null, modelId: null, available: false, reason, evidenceLevel: 'NO_EVIDENCE' },
  bridge,
  trace
});

/**
 * 模型来源收敛顺序：AAOS 统一接口 → 仅开发环境的标准兼容代理 → 显式开启的合成夹具。
 * 任何一级不可用都要留下可复核的原因，绝不静默回退到脚本冒充 AI。
 */
export function resolveConversation(input: ModelRegistryInput): ResolvedConversation {
  const trace: string[] = [];
  const bridge = input.aaosBaseUrl ? new AaosHostBridge({ baseUrl: input.aaosBaseUrl }) : null;

  if (bridge) {
    trace.push('已构造 AAOS Host Adapter，等待能力探测');
    const port = bridge.conversation();
    if (port) {
      trace.push('AAOS conversation() 返回端口；其可用性由 availability() 决定');
      return {
        port,
        info: {
          kind: 'aaos-host',
          providerId: port.providerId,
          modelId: port.modelId,
          available: false,
          reason: 'AAOS 现面无通用流式会话接口（一次性问答需宿主 launch token）',
          evidenceLevel: 'NO_EVIDENCE'
        },
        bridge,
        trace
      };
    }
    trace.push('AAOS conversation() 返回 null');
  } else {
    trace.push('未配置 AAOS Core baseUrl，跳过宿主接口');
  }

  if (input.devProxyConfigured && input.devProxyModel) {
    const port = new OpenAiCompatibleConversationPort({ model: input.devProxyModel });
    return {
      port,
      info: {
        kind: 'openai-compatible-dev',
        providerId: port.providerId,
        modelId: port.modelId,
        available: true,
        reason: '已配置开发代理上游；尚未发起真实调用，证据级别待首次回复后升级',
        // 配置存在 ≠ 调用成功：在真正收到回复之前不得自称 REAL。
        evidenceLevel: 'NO_EVIDENCE'
      },
      bridge,
      trace: [...trace, '使用开发环境标准兼容代理']
    };
  }
  trace.push(input.devProxyConfigured ? '代理在运行但未声明模型' : '开发代理未配置上游模型');

  if (input.allowSynthetic) {
    const port = new SyntheticConversationPort({ providerId: 'synthetic-fixture', steps: SYNTHETIC_SCRIPT, modelId: 'scripted-only' });
    return {
      port,
      info: {
        kind: 'synthetic',
        providerId: port.providerId,
        modelId: port.modelId,
        available: true,
        reason: '合成夹具：非真实模型，界面必须显示 SYNTHETIC',
        evidenceLevel: 'SYNTHETIC'
      },
      bridge,
      trace: [...trace, '显式开启的合成演示模式']
    };
  }

  return UNAVAILABLE('未配置获准模型接口：MODEL_UNAVAILABLE。星栖不使用脚本回复冒充 AI。', [...trace, '拒绝隐式脚本回退'], bridge);
}
