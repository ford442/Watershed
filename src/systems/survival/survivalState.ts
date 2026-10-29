/**
 * survivalState.ts — Pure wetness / temperature transitions for Track A.
 *
 * Run-scoped instance lives in runSession; tick from physics, not Zustand.
 */

import type { LoadoutDefinition } from './loadout';
import { clamp01 } from '../../math/scalar';
import { COLD_AMBIENT_TEMP } from '../gameplay/gameplayProfile';

/** Normalized comfort: 1 = warm/optimal, 0 = hypothermic. */
export interface SurvivalState {
  wetness: number;
  coreTemp: number;
}

/**
 * The climate survival runs in: the active gameplay profile's cold and wind
 * fields (#521 B; a `GameplayProfile` satisfies it). Not the biome palette.
 */
export interface SurvivalClimate {
  /** Ambient target core temp, 0–1; below `COLD_AMBIENT_TEMP` the exposure penalties apply. */
  ambientTemp: number;
  /** Scale on the wind drying (1 = as tuned). */
  windDry: number;
}

export interface SurvivalTickInput {
  dt: number;
  climate: SurvivalClimate;
  /** Player feet/body in or very near water. */
  inWater: boolean;
  /** Horizontal speed (m/s) — drives wind drying. */
  windSpeed: number;
  /** Launch hour 0–23 — midday dries faster. */
  launchHour: number;
}

export interface SurvivalModifiers {
  staminaDrainMultiplier: number;
  staminaRegenMultiplier: number;
  movementMultiplier: number;
  /** 0–1 cold/heat stress for HUD (higher = worse). */
  exposureStress: number;
  /** Wetness-based SFX attenuation (1 = dry, lower = muffled). */
  sfxWetnessMultiplier: number;
  /**
   * Raft paddle stroke cost multiplier (≥1). Cold, stiff hands and a soaked
   * jacket make each stroke cost more stamina.
   */
  paddleCostMultiplier: number;
  /** Raft paddle stamina regen multiplier (≤1). Shivering recovers slower. */
  paddleRegenMultiplier: number;
}

export const SURVIVAL_INITIAL: SurvivalState = {
  wetness: 0,
  coreTemp: 1,
};

const WETNESS_GAIN_IN_WATER = 0.55;
const WETNESS_SPRAY_GAIN = 0.12;
const WETNESS_DRY_BASE = 0.08;
const WETNESS_WIND_DRY_SCALE = 0.025;
const TEMP_LERP_RATE = 0.35;
const WETNESS_COLD_PENALTY = 0.18;

/**
 * Raft paddle coupling. The raft has no sprint, so wetness/exposure land on the
 * paddle economy instead: strokes cost more and the bar refills slower. Bounds
 * are deliberately gentler than the runner's sprint penalties — the raft cannot
 * choose to stop paddling in a rapid, so a harsh curve reads as unfair rather
 * than tense.
 */
const PADDLE_COST_WETNESS = 0.2;
const PADDLE_COST_EXPOSURE = 0.35;
const PADDLE_REGEN_WETNESS = 0.18;
const PADDLE_REGEN_EXPOSURE = 0.4;

function sunDryingFactor(launchHour: number): number {
  const hour = ((launchHour % 24) + 24) % 24;
  const noonDistance = Math.abs(hour - 12) / 12;
  return 0.35 + (1 - noonDistance) * 0.65;
}

export function createSurvivalState(): SurvivalState {
  return { ...SURVIVAL_INITIAL };
}

export function tickSurvivalState(
  state: SurvivalState,
  input: SurvivalTickInput,
  loadout: LoadoutDefinition,
): SurvivalState {
  const next: SurvivalState = { ...state };
  const ambient = input.climate.ambientTemp;
  const insulatedAmbient = clamp01(ambient + loadout.insulation * 0.25);

  if (input.inWater) {
    next.wetness = clamp01(next.wetness + WETNESS_GAIN_IN_WATER * input.dt);
  } else if (next.wetness > 0.05) {
    const dryRate =
      (WETNESS_DRY_BASE + input.windSpeed * WETNESS_WIND_DRY_SCALE * input.climate.windDry) *
      sunDryingFactor(input.launchHour);
    next.wetness = clamp01(next.wetness - dryRate * input.dt);
  }

  if (input.inWater && next.wetness > 0.6) {
    next.wetness = clamp01(next.wetness + WETNESS_SPRAY_GAIN * input.dt * 0.25);
  }

  const wetColdDrag = next.wetness * WETNESS_COLD_PENALTY;
  const targetTemp = clamp01(insulatedAmbient - wetColdDrag);
  const lerp = 1 - Math.exp(-TEMP_LERP_RATE * input.dt);
  next.coreTemp = clamp01(next.coreTemp + (targetTemp - next.coreTemp) * lerp);

  return next;
}

export function computeExposureStress(
  state: SurvivalState,
  climate: SurvivalClimate,
): number {
  const ambient = climate.ambientTemp;
  const coldStress = clamp01((0.55 - state.coreTemp) * 1.4);
  const heatStress = clamp01((state.coreTemp - 0.95) * 2);
  const biomeColdBias = ambient < 0.5 ? (0.5 - ambient) * 0.6 : 0;
  return clamp01(coldStress + heatStress + biomeColdBias + state.wetness * 0.15);
}

/** Fills `out` when given (a per-step reader's reused object), else returns a fresh one. */
export function getSurvivalModifiers(
  state: SurvivalState,
  climate: SurvivalClimate,
  loadout: LoadoutDefinition,
  out?: SurvivalModifiers,
): SurvivalModifiers {
  const exposureStress = computeExposureStress(state, climate);
  const isColdBiome = climate.ambientTemp < COLD_AMBIENT_TEMP;

  let staminaDrainMul = loadout.staminaDrainMultiplier;
  let staminaRegenMul = loadout.staminaRegenMultiplier;

  if (isColdBiome) {
    staminaDrainMul *= 1 + exposureStress * 0.45;
    staminaRegenMul *= 1 - exposureStress * 0.35;
  }

  staminaRegenMul *= 1 - state.wetness * 0.25;

  const movementMul =
    loadout.movementMultiplier *
    (1 - (isColdBiome ? exposureStress * 0.08 : 0));

  const sfxWetnessMultiplier = 1 - state.wetness * 0.35;

  // Raft paddle economy — see the PADDLE_* constants above.
  const paddleCostMultiplier =
    loadout.staminaDrainMultiplier *
    (1 + state.wetness * PADDLE_COST_WETNESS + exposureStress * PADDLE_COST_EXPOSURE);
  const paddleRegenMultiplier =
    loadout.staminaRegenMultiplier *
    clamp01(1 - state.wetness * PADDLE_REGEN_WETNESS - exposureStress * PADDLE_REGEN_EXPOSURE);

  if (!out) {
    return {
      staminaDrainMultiplier: staminaDrainMul,
      staminaRegenMultiplier: staminaRegenMul,
      movementMultiplier: movementMul,
      exposureStress,
      sfxWetnessMultiplier,
      paddleCostMultiplier,
      paddleRegenMultiplier,
    };
  }
  out.staminaDrainMultiplier = staminaDrainMul;
  out.staminaRegenMultiplier = staminaRegenMul;
  out.movementMultiplier = movementMul;
  out.exposureStress = exposureStress;
  out.sfxWetnessMultiplier = sfxWetnessMultiplier;
  out.paddleCostMultiplier = paddleCostMultiplier;
  out.paddleRegenMultiplier = paddleRegenMultiplier;
  return out;
}
