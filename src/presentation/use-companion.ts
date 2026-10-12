import { useEffect, useMemo, useRef, useState } from 'react';
import type { AstrynCompanionState } from '@astryn/contracts';
import { AstrynCompanionController } from '../interaction/companion-controller';
import type { CompanionControllerDeps } from '../interaction/companion-controller';

export interface UseCompanionResult {
  readonly state: AstrynCompanionState;
  readonly controller: AstrynCompanionController;
}

/**
 * React 绑定层：只负责订阅与卸载清理，不含业务判断。
 * 卸载时 dispose() —— 中止在途请求并退订宿主事件。
 */
export function useCompanionController(deps: CompanionControllerDeps): UseCompanionResult {
  const controller = useMemo(() => new AstrynCompanionController(deps), [deps]);
  const [state, setState] = useState<AstrynCompanionState>(controller.currentState);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const unsubscribe = controller.subscribe((next) => {
      if (mounted.current) setState(next);
    });
    return () => {
      mounted.current = false;
      unsubscribe();
      controller.dispose();
    };
  }, [controller]);

  return { state, controller };
}
