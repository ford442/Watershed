/**
 * survivalSystem — the run's survival (wetness, core temperature, exposure) as a
 * SimCore system (#521 A). Its climate (cold, wind drying) is the active
 * gameplay profile, which the `gameplay-profile` system (order 35) has already
 * stepped this step (#521 B).
 *
 * The runner and raft used to integrate it from inside their physics step
 * (`tickRunSurvival`), so the cold and the wet advanced on whatever delta that
 * frame had. Now it steps once per fixed sim step from the vehicle's sampled
 * state (`ctx.vehicle`, read at the top of the tick, before the vehicle's own
 * step — the body has not moved since its last one, so the numbers are the ones
 * the vehicle would have read), and the vehicles read the resulting modifiers
 * back (`getActiveSurvivalModifiers`, the raft through `publishRaftSurvival`).
 *
 * `inWater` stays the vehicle's own definition: the runner's height test
 * against the water sheet, the raft's "actually floating" (published by its
 * hull through `publishRaftSurvival`, so one step behind).
 */
import { WATER_LEVEL } from '../../constants/game';
import type { SimSystem } from '../../sim/core/SimCore';
import { getActiveGameplayProfile } from '../gameplay/activeGameplayProfile';
import { getPublishedRaftInWater, stepRunSurvival } from './runSession';

export const SURVIVAL_SIM_ORDER = 40;

/** The runner is "in the water" within this much above the sheet (splash height). */
export const RUNNER_IN_WATER_MARGIN = 0.55;

export function createSurvivalSimSystem(): SimSystem {
  return {
    id: 'survival',
    order: SURVIVAL_SIM_ORDER,
    step(ctx, dt) {
      const v = ctx.vehicle;
      if (!v.valid) return;
      stepRunSurvival({
        dt,
        climate: getActiveGameplayProfile(),
        inWater: v.isRaft ? getPublishedRaftInWater() : v.y < WATER_LEVEL + RUNNER_IN_WATER_MARGIN,
        windSpeed: Math.sqrt(v.vx * v.vx + v.vz * v.vz),
      });
    },
  };
}
