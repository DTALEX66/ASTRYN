import type { AstrynAnyEvent, AstrynHostPort } from '@astryn/contracts';

/**
 * 注入式宿主端口替身：捕获 attach() 建立的权威事件订阅，供测试从
 * "已 attach 的宿主通道"投递原始事件——与生产接线同一条路径。
 * 这是 Q1 收窄（dispatch 转原生 #private）后唯一可注入原始信封的通道，
 * 也是测试驱动"迟到/乱序/伪造事件"时的标准入口。
 */
export interface HostTap {
  readonly host: AstrynHostPort;
  emit(event: AstrynAnyEvent): void;
  readonly subscriptions: () => number;
  readonly unsubscribes: () => number;
}

export function createHostTap(): HostTap {
  const handlers = new Set<(event: AstrynAnyEvent) => void>();
  let unsubscribeCount = 0;
  const host = {
    hostId: 'test-host-tap',
    onAuthoritativeEvent(handler: (event: AstrynAnyEvent) => void): () => void {
      handlers.add(handler);
      return () => {
        if (handlers.delete(handler)) unsubscribeCount += 1;
      };
    }
  } as unknown as AstrynHostPort;
  return {
    host,
    emit: (event) => {
      for (const handler of [...handlers]) handler(event);
    },
    subscriptions: () => handlers.size,
    unsubscribes: () => unsubscribeCount
  };
}
