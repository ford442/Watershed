/**
 * gameplayProfile — per-segment gameplay parameters, resolved off the palette (#521 B).
 *
 * A biome palette (configs/palettes) is visual: colours, fog, the surface's
 * `flowSpeed` for the shader. Until now the water force took its flow cap from
 * the *target palette's* `flowSpeed`, so recolouring a biome changed the current
 * under the player. The cap, the grip, the cold and the wind now come from a
 * `GameplayProfile` this module resolves per segment:
 *
 *   resolveGameplayProfile(biome, slipperiness?)  — the profile a segment carries (gameplayProfileTable.ts)
 *   getGameplayProfile()                          — the live, blended profile
 *   createGameplayProfileSimSystem()              — SimCore system (order 60)
 *
 * The live profile changes when ChunkManager *commits* a biome (its sim-time
 * debounce, `biome-change`) — the same moment the pinned cap changed — and, with
 * a non-zero `blendSec`, eases from the old profile to the new one on the sim
 * step, never on a render. Every authored map's table entry has `blendSec: 0`.
 *
 * Only `flowCap` is read by a consumer today (WaterForceSystem). `friction`,
 * `cold` and `wind` are resolved and blended so the next consumer (surface
 * friction, survival's ambient, a wind field) reads a profile instead of a
 * palette or a biome table.
 */
import { DEFAULT_BIOME_ID } from '../../configs/biomes';
import type { SimSystem } from '../../sim/core/SimCore';
import { gameEvents } from '../events/GameEvents';
import { useGameStore } from '../GameState';
import type { GameplayProfile } from './MapSystem.types';
import { getLiveChunkManager } from './ChunkManager';
import { resolveGameplayProfile } from './gameplayProfileTable';


export const GAMEPLAY_PROFILE_SIM_ORDER = 60;

// ---------------------------------------------------------------------------
// The live profile
// ---------------------------------------------------------------------------

const live: GameplayProfile = resolveGameplayProfile(DEFAULT_BIOME_ID);
const blendFrom: GameplayProfile = { ...live };
const blendTo: GameplayProfile = { ...live };
let blendElapsed = 0;
let blending = false;

function copyProfile(out: GameplayProfile, p: GameplayProfile): void {
  out.flowCap = p.flowCap;
  out.friction = p.friction;
  out.cold = p.cold;
  out.wind = p.wind;
  out.blendSec = p.blendSec;
}

/** The profile the player is in right now (a stable object, mutated in place). */
export function getGameplayProfile(): Readonly<GameplayProfile> {
  return live;
}

/**
 * Head for `target`: at once when its `blendSec` is 0, else over that many sim
 * seconds from wherever the live profile is.
 */
export function setGameplayProfileTarget(target: GameplayProfile): void {
  if (!(target.blendSec > 0)) {
    blending = false;
    copyProfile(live, target);
    return;
  }
  copyProfile(blendFrom, live);
  copyProfile(blendTo, target);
  blendElapsed = 0;
  blending = true;
}

/** Advance a blend by `dtSec` of sim time (no-op when none is running). */
export function stepGameplayProfile(dtSec: number): void {
  if (!blending) return;
  blendElapsed += Math.max(0, dtSec);
  const t = blendTo.blendSec > 0 ? Math.min(1, blendElapsed / blendTo.blendSec) : 1;
  // ε: 120 × (1/60) sums to a hair under 2 in float64 (as the biome debounce's does).
  if (t >= 1 - 1e-9) {
    blending = false;
    copyProfile(live, blendTo);
    return;
  }
  live.flowCap = blendFrom.flowCap + (blendTo.flowCap - blendFrom.flowCap) * t;
  live.friction = blendFrom.friction + (blendTo.friction - blendFrom.friction) * t;
  live.cold = blendFrom.cold + (blendTo.cold - blendFrom.cold) * t;
  live.wind = blendFrom.wind + (blendTo.wind - blendFrom.wind) * t;
  live.blendSec = blendTo.blendSec;
}

/** The authored slipperiness of a segment, from the live treadmill's map (0 off the map). */
function segmentSlipperiness(segmentIndex: number | undefined): number {
  if (segmentIndex === undefined) return 0;
  try {
    return getLiveChunkManager()?.getMapManager().getChunkConfig(segmentIndex).slipperiness ?? 0;
  } catch {
    return 0;
  }
}

export function resetGameplayProfileForTests(): void {
  blending = false;
  blendElapsed = 0;
  copyProfile(live, resolveGameplayProfile(DEFAULT_BIOME_ID));
}

/**
 * The SimCore system. It holds no per-step work of its own beyond the blend;
 * what moves the profile is the biome commit, heard through `attach` for as
 * long as the system is registered (and seeded from the committed biome the
 * store already holds, so a late registration starts where the run is).
 */
export function createGameplayProfileSimSystem(): SimSystem {
  return {
    id: 'gameplay-profile',
    order: GAMEPLAY_PROFILE_SIM_ORDER,
    attach() {
      setGameplayProfileTarget(resolveGameplayProfile(useGameStore.getState().currentBiome));
      return gameEvents.on('biome-change', ({ biome, segmentIndex }) => {
        setGameplayProfileTarget(resolveGameplayProfile(biome, segmentSlipperiness(segmentIndex)));
      });
    },
    step(_ctx, dt) {
      stepGameplayProfile(dt);
    },
  };
}
