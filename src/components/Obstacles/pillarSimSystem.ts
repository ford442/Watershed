/**
 * pillarSimSystem — pillar crack timers and debris age as a SimCore system (#521 A).
 *
 * Moved, not rewritten, from Rock's and PillarFragmentPool's useFrame bodies:
 * the same two additions, now on the registry's fixed dt. Cracks step first so
 * a pillar that shatters this step enqueues debris born at this step's clock.
 */
import type { SimSystem } from '../../sim/core/SimCore';
import {
  PILLAR_SIM_ORDER,
  advancePillarFragmentClock,
  resetPillarCracks,
  stepPillarCracks,
} from './pillarSimClock';

export function createPillarSimSystem(): SimSystem {
  return {
    id: 'pillars',
    order: PILLAR_SIM_ORDER,
    step(_ctx, dt) {
      stepPillarCracks(dt);
      advancePillarFragmentClock(dt);
    },
    reset() {
      resetPillarCracks();
    },
  };
}
