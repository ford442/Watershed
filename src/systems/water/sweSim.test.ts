import { describe, expect, it } from 'vitest';
import { createWasmSweSim } from './sweSim';
import { stubNativeModule } from '../../testing/stubNativeModule';

describe('createWasmSweSim step guard', () => {
  const event = { kind: 0, cx: 1, cz: 1, radius: 2, strength: 0.5, dt: 0.016 };

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'never hands dt = %s to the solver, but still applies the events',
    (dt) => {
      const { mod } = stubNativeModule();
      const sim = createWasmSweSim(mod, 8, 8, 0.5);
      sim.step({ dt, g: 9.80665, H: 1, originX: 0, originZ: 0, events: [event] });
      sim.step({ dt, g: 9.80665, H: 1, originX: 0, originZ: 0, events: [], edgeEta: 0.1 });
      expect(mod.stepShallowWater).not.toHaveBeenCalled();
      expect(mod.stepShallowWaterInflow).not.toHaveBeenCalled();
      expect(mod.applySWEEvent).toHaveBeenCalledTimes(1);
      sim.dispose();
    },
  );

  it('steps a finite dt', () => {
    const { mod } = stubNativeModule();
    const sim = createWasmSweSim(mod, 8, 8, 0.5);
    sim.step({ dt: 0.016, g: 9.80665, H: 1, originX: 0, originZ: 0, events: [] });
    sim.step({ dt: 0.016, g: 9.80665, H: 1, originX: 0, originZ: 0, events: [], edgeEta: 0.1 });
    expect(mod.stepShallowWater).toHaveBeenCalledTimes(1);
    expect(mod.stepShallowWaterInflow).toHaveBeenCalledTimes(1);
    sim.dispose();
  });
});
