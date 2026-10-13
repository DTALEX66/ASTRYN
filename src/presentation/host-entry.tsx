import { hostSlotSpec } from '@astryn/contracts';
import type { AstrynHostSlot } from '@astryn/contracts';
import { CompanionShell } from './companion-shell';
import type { CompanionShellProps } from './companion-shell';

export interface AstrynCompanionEntryProps extends Omit<CompanionShellProps, 'mode' | 'slot'> {
  /** 宿主槽位：主页 / 阅读嵌入 / 侧边面板。模式与取景档由槽位决定。 */
  readonly slot: AstrynHostSlot;
}

/**
 * 正式可复用宿主入口（GF08）：AAOS 前端在槽位容器里挂载本组件。
 *
 * - 会话不归槽位所有：三个槽位传入同一 manager 即共享同一会话；
 *   槽位卸载只会释放一个视图，不会停止或销毁会话（除非宿主自己 dispose）。
 * - 模型不归本组件所有：conversation / actions / verifier 端口一律由宿主注入，
 *   这里不构造任何模型端口——不存在第二个模型中心。
 * - 尺寸（角色大小 / 对话高度 / 隐藏足迹 / 专注收敛）全部经前端 tokens，
 *   宿主在容器上覆盖令牌即可，无需改组件代码。
 */
export function AstrynCompanionEntry({ slot, ...rest }: AstrynCompanionEntryProps): JSX.Element {
  const spec = hostSlotSpec(slot);
  return <CompanionShell {...rest} mode={spec.mode} slot={slot} />;
}
