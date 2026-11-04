/**
 * skySimSystem — the sky clock as a SimCore system (#521 A).
 *
 * Moved, not rewritten, from SkyClockTick's useFrame: each unpaused sim step
 * adds the step's dt to the clock. SkyClockTick (−85) still places the sun in
 * the camera-relative refs every frame, after SimCore (−90) has stepped.
 */
import { useGameStore } from '../GameState';
import type { SimSystem } from '../../sim/core/SimCore';
import { tickSkyClock } from './skyClock';

export const SKY_SIM_ORDER = 20;

export function createSkySimSystem(): SimSystem {
  return {
    id: 'sky-clock',
    order: SKY_SIM_ORDER,
    step(_ctx, dt) {
      if (!useGameStore.getState().isPaused) tickSkyClock(dt);
    },
  };
}
