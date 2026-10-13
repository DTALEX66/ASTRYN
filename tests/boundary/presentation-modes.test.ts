import { describe, expect, it } from 'vitest';
import { ASTRYN_PRESENTATION_MODES, ASTRYN_PRESENTATION_MODE_SPECS, availableModes, modeSpec } from '@astryn/core';

describe('多形态呈现的诚实声明（A02）', () => {
  it('契约声明全部五种目标形态', () => {
    expect(ASTRYN_PRESENTATION_MODES).toEqual(['embedded', 'panel', 'floating', 'pet', 'voice-only']);
    expect(ASTRYN_PRESENTATION_MODE_SPECS).toHaveLength(5);
  });

  it('本轮只承认实际实现的两种，其余带阻塞原因', () => {
    expect(availableModes()).toEqual(['embedded', 'panel']);
    for (const spec of ASTRYN_PRESENTATION_MODE_SPECS) {
      if (spec.implementedInM0) expect(spec.blockedBy).toBeNull();
      else expect(spec.blockedBy, `${spec.mode} 必须说明阻塞原因`).toBeTruthy();
    }
  });

  it('浏览器预览不被宣称为原生窗口能力', () => {
    expect(modeSpec('floating').windowRequirement).toBe('native-window');
    expect(modeSpec('pet').implementedInM0).toBe(false);
    expect(modeSpec('voice-only').implementedInM0).toBe(false);
    expect(() => modeSpec('unknown-mode' as never)).toThrow(/unknown presentation mode/);
  });
});
