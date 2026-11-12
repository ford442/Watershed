/**
 * rapierWorldSimSystem.ts — the main-thread Rapier world's step as a SimCore system (#556 A).
 *
 * `<Physics>` used to step the world from its own useFrame accumulator, and
 * the vehicle step ran in another useFrame after it, so whether a frame
 * stepped the world and the vehicle the same number of times was up to two
 * clocks. SimCore owns both now: `physics-world` (92) steps the world once per
 * sim step at `SIM_DT`, then `vehicle-runner` (95) reads the stepped body and
 * applies the impulses the next world step integrates — the order a frame ran
 * them in before (world, then vehicle). `<Physics paused>` stops the
 * library's own loop; its `step()` still fires the before / after step hooks,
 * drains the collision events and syncs meshes, exactly as its loop did.
 *
 * A headless run registers the same system over its own world.
 */
import type { SimSystem } from '../sim/core/SimCore';

export const RAPIER_WORLD_SIM_ORDER = 92;
export const RAPIER_WORLD_SIM_ID = 'physics-world';

/** `stepWorld(dt)`: one fixed world step (`useRapier().step` in the browser). */
export function createRapierWorldSimSystem(stepWorld: (dt: number) => void): SimSystem {
  return {
    id: RAPIER_WORLD_SIM_ID,
    order: RAPIER_WORLD_SIM_ORDER,
    step(_ctx, dt) {
      stepWorld(dt);
    },
  };
}
