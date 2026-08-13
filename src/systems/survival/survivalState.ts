/**
 * survivalState.ts — Pure wetness / temperature transitions for Track A.
 *
 * Run-scoped instance lives in runSession; tick from physics, not Zustand.
 */

import type { BiomeId } from '../../configs/biomes';
import type { LoadoutDefinition } from './loadout';

/** Normalized comfort: 1 = warm/optimal, 0 = hypothermic. */
export interface SurvivalState {
  wetness: number;
  coreTemp: number;
}

export interface SurvivalTickInput {
  dt: number;
  biomeId: BiomeId;
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

/** Ambient target core temp per biome (0–1). */
const BIOME_AMBIENT_TEMP: Partial<Record<BiomeId, number>> = {
  glacier: 0.35,
  glacialMelt: 0.42,
  canyonSummer: 0.88,
  canyonAutumn: 0.78,
  slotCanyon: 0.82,
  delta: 0.9,
  alpineSpring: 0.72,
  cavern: 0.55,
  midnightMist: 0.5,
  lumberFlume: 0.7,
  hydroDam: 0.65,
};

const DEFAULT_AMBIENT_TEMP = 0.75;

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

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function sunDryingFactor(launchHour: number): number {
  const hour = ((launchHour % 24) + 24) % 24;
  const noonDistance = Math.abs(hour - 12) / 12;
  return 0.35 + (1 - noonDistance) * 0.65;
}

export function getBiomeAmbientTemp(biomeId: BiomeId): number {
  return BIOME_AMBIENT_TEMP[biomeId] ?? DEFAULT_AMBIENT_TEMP;
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
  const ambient = getBiomeAmbientTemp(input.biomeId);
  const insulatedAmbient = clamp01(ambient + loadout.insulation * 0.25);

  if (input.inWater) {
    next.wetness = clamp01(next.wetness + WETNESS_GAIN_IN_WATER * input.dt);
  } else if (next.wetness > 0.05) {
    const dryRate =
      (WETNESS_DRY_BASE + input.windSpeed * WETNESS_WIND_DRY_SCALE) *
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
  biomeId: BiomeId,
): number {
  const ambient = getBiomeAmbientTemp(biomeId);
  const coldStress = clamp01((0.55 - state.coreTemp) * 1.4);
  const heatStress = clamp01((state.coreTemp - 0.95) * 2);
  const biomeColdBias = ambient < 0.5 ? (0.5 - ambient) * 0.6 : 0;
  return clamp01(coldStress + heatStress + biomeColdBias + state.wetness * 0.15);
}

export function getSurvivalModifiers(
  state: SurvivalState,
  biomeId: BiomeId,
  loadout: LoadoutDefinition,
): SurvivalModifiers {
  const exposureStress = computeExposureStress(state, biomeId);
  const isColdBiome = getBiomeAmbientTemp(biomeId) < 0.5;

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
