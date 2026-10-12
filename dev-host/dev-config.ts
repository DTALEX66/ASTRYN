import type { ModelRegistryInput } from '@astryn/core';

export interface DevHostConfig extends ModelRegistryInput {
  /** 合成宿主模拟器开关：只影响开发宿主，界面必须显示 SYNTHETIC。 */
  readonly syntheticHostEnabled: boolean;
}

type Env = Record<string, string | boolean | undefined>;

function str(env: Env, key: string): string | null {
  const value = env[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function flag(env: Env, key: string): boolean {
  const value = env[key];
  return value === '1' || value === 'true';
}

/**
 * 开发宿主配置。全部来自非机密的前端可见变量：
 * 模型密钥不在此列，也不允许出现在这里 —— 它只存在于 dev 代理进程的环境里。
 */
export function readDevConfig(env: Env): DevHostConfig {
  const devProxyModel = str(env, 'VITE_ASTRYN_DEV_MODEL');
  return {
    aaosBaseUrl: str(env, 'VITE_ASTRYN_AAOS_BASE_URL'),
    devProxyConfigured: flag(env, 'VITE_ASTRYN_DEV_PROXY_ENABLED'),
    devProxyModel,
    allowSynthetic: flag(env, 'VITE_ASTRYN_ALLOW_SYNTHETIC'),
    syntheticHostEnabled: flag(env, 'VITE_ASTRYN_SYNTHETIC_HOST')
  };
}
