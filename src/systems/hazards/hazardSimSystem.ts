/**
 * hazardSimSystem — SimCore's `hazards` system (#522 A): the entry-side facade.
 *
 * Order 45: after survival (40) has integrated this step, so a hazard that
 * reaches the player shocks the state the next survival step integrates from;
 * before scoring / the ghost clock (90), so a transition logged this step reads
 * the ghost clock as of the previous step, like a split.
 *
 * Hazards are lazy per map (#522 acceptance: the payload budget): this facade
 * is a lookup of the run map's `hazards[]`, and only a map that authors some
 * fetches the runtime (hazardRuntime.ts — lifecycle, parser, anchors). Until it
 * has resolved, a step does nothing. A real run starts the fetch on its first
 * step, long before any hazard 150 m downstream could arm; a scripted / replay
 * run must not depend on that race, so `isHazardRuntimeSettled()` joins the
 * harness readiness gate next to the SWE field's and starts the fetch itself.
 *
 * Paused steps do not advance a hazard's clock.
 */
import type { SimSystem } from '../../sim/core/SimCore';
import { lazyModule } from '../../utils/lazyModule';
import { getRunMap } from '../journey/runSession';
import type { HazardStepper } from './hazardRuntime';

export const HAZARD_SIM_ORDER = 45;

const runtimeModule = lazyModule(() => import('./hazardRuntime'));

function runMapAuthorsHazards(): boolean {
  const hazards = getRunMap().levelData.hazards;
  return Array.isArray(hazards) && hazards.length > 0;
}

/** Fetch the hazard runtime now (tests, or a caller that knows a hazard map is next). */
export function loadHazardRuntime(): Promise<unknown> {
  return runtimeModule.load();
}

/**
 * True once the run map's hazards can step: it authors none, or the runtime
 * has loaded. Starts the fetch when it is needed. The scripted harness waits
 * on it before frame 0.
 */
export function isHazardRuntimeSettled(): boolean {
  if (!runMapAuthorsHazards()) return true;
  if (runtimeModule.get()) return true;
  void runtimeModule.load().catch(() => {});
  return false;
}

export function createHazardSimSystem(): SimSystem {
  let stepper: HazardStepper | null = null;
  return {
    id: 'hazards',
    order: HAZARD_SIM_ORDER,
    step(ctx, dt) {
      if (ctx.paused) return;
      if (!stepper) {
        if (!runMapAuthorsHazards()) return;
        const mod = runtimeModule.get();
        if (!mod) {
          void runtimeModule.load().catch(() => {});
          return;
        }
        stepper = mod.createHazardStepper();
      }
      stepper.step(ctx, dt);
    },
    reset() {
      stepper?.reset();
    },
  };
}
