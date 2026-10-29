/**
 * gameplaySimSystem — the gameplay profile under the player, as a SimCore
 * system (#521 B).
 *
 * The target is the profile of the segment ChunkManager's debounce last
 * committed (`getCommittedGameplay`: the biome commit, plus a segment whose
 * authored `gameplay` override differs), so it moves on exactly the step the
 * biome used to — the cold and the current change when they always did. When
 * no treadmill is live, or the committed biome is not the store's (a reach
 * transition, a respawn snap, a level-file host), the target is the row of
 * `GameState.currentBiome`, which is what every reader used before the split.
 *
 * The active profile then blends toward the target over `blendSec` of sim time.
 * The default window is 0 — a step, as before: a non-zero blend changes how a
 * run plays across a boundary, and the input / replay smokes pin that it does
 * not (#521 acceptance). A map or a later tuning pass opts in by passing one.
 *
 * Order 35: after chunk/biome (30), before survival (40), which reads the cold
 * and the wind drying from it. The water forces read the flow cap on the frame
 * that follows, and the vehicles hear the surface.
 *
 * A run reset snaps: the first step of a run takes its target outright.
 */
import type { SimSystem } from '../../sim/core/SimCore';
import { useGameStore } from '../GameState';
import { getLiveChunkManager } from '../map/ChunkManager';
import { publishActiveGameplayProfile } from './activeGameplayProfile';
import {
  blendGameplayProfiles,
  copyGameplayProfile,
  createGameplayProfile,
  gameplayProfileForBiome,
  gameplayProfilesEqual,
  type GameplayProfile,
} from './gameplayProfile';

export const GAMEPLAY_PROFILE_SIM_ORDER = 35;

/** Default sim seconds a profile change takes to blend in (0 = at once; see the header). */
export const GAMEPLAY_PROFILE_BLEND_SEC = 0;

/** The profile the player is heading for this step. */
function resolveTarget(): Readonly<GameplayProfile> {
  const storeBiome = useGameStore.getState().currentBiome;
  const manager = getLiveChunkManager();
  if (manager && manager.getCurrentBiome() === storeBiome) return manager.getCommittedGameplay();
  return gameplayProfileForBiome(storeBiome);
}

export interface GameplayProfileSimOptions {
  /** Sim seconds to blend a new target in over; 0 takes it at once. */
  blendSec?: number;
}

export function createGameplayProfileSimSystem({
  blendSec = GAMEPLAY_PROFILE_BLEND_SEC,
}: GameplayProfileSimOptions = {}): SimSystem {
  const from = createGameplayProfile();
  const to = createGameplayProfile();
  const current = createGameplayProfile();
  let elapsedSec = 0;
  let blending = false;
  let snap = true;

  return {
    id: 'gameplay-profile',
    order: GAMEPLAY_PROFILE_SIM_ORDER,
    step(_ctx, dt) {
      const target = resolveTarget();
      if (snap || (blendSec <= 0 && !gameplayProfilesEqual(target, to))) {
        snap = false;
        blending = false;
        copyGameplayProfile(from, target);
        copyGameplayProfile(to, target);
        copyGameplayProfile(current, target);
      } else if (!gameplayProfilesEqual(target, to)) {
        // Blend from wherever the last blend had got to.
        copyGameplayProfile(from, current);
        copyGameplayProfile(to, target);
        elapsedSec = 0;
        blending = true;
      }
      if (blending) {
        elapsedSec += dt;
        if (elapsedSec >= blendSec) {
          blending = false;
          copyGameplayProfile(current, to);
        } else {
          blendGameplayProfiles(current, from, to, elapsedSec / blendSec);
        }
      }
      publishActiveGameplayProfile(current);
    },
    reset() {
      snap = true;
    },
  };
}
