import { ASTRYN_PRESENTATION_MODE_SPECS } from '@astryn/contracts';

/** 本轮实际实现（可挂载）的呈现模式；未实现的必须带阻塞原因，不得出现在这里。 */
export function availableModes(): readonly string[] {
  return ASTRYN_PRESENTATION_MODE_SPECS.filter((spec) => spec.implementedInM0).map((spec) => spec.mode);
}
