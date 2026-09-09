/**
 * wetnessMuffle.ts — wetness → SFX attenuation + brightness loss.
 *
 * `getSurvivalModifiers` has exported `sfxWetnessMultiplier` since the survival
 * layer landed, but nothing consumed it (SURVIVAL_LAYER.md: "modifier exported,
 * audio wiring deferred"). This module is the bus between the survival tick and
 * AudioManager so neither side has to import the other: the tick writes the
 * multiplier, the mixer reads the mapped gain / cutoff.
 *
 * No Three.js / Web Audio imports — the curve is unit-testable on its own.
 */

/**
 * Floor of `sfxWetnessMultiplier` (`1 - wetness * 0.35` at wetness = 1).
 * Kept in sync with survivalState.getSurvivalModifiers.
 */
export const WETNESS_MUFFLE_FLOOR = 0.65;

/** Lowpass cutoff (Hz) when dry — effectively open. */
export const WETNESS_CUTOFF_DRY = 20000;

/** Lowpass cutoff (Hz) when fully soaked — water in the ears, not a wall. */
export const WETNESS_CUTOFF_SOAKED = 2200;

export interface WetnessMuffle {
  /** Multiplier applied on top of the SFX channel volume. */
  gain: number;
  /** Suggested BiquadFilter lowpass frequency in Hz. */
  cutoffHz: number;
  /** Normalized wetness 0 (dry) – 1 (soaked), recovered from the multiplier. */
  wet: number;
}

const DRY: WetnessMuffle = { gain: 1, cutoffHz: WETNESS_CUTOFF_DRY, wet: 0 };

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Map `SurvivalModifiers.sfxWetnessMultiplier` to a mixer gain + cutoff.
 *
 * Non-finite input reads as dry rather than silent: a survival tick that has
 * not run yet must never duck the whole mix.
 */
export function wetnessMuffleParams(multiplier: number): WetnessMuffle {
  if (!Number.isFinite(multiplier)) return { ...DRY };

  const gain = clamp(multiplier, WETNESS_MUFFLE_FLOOR, 1);
  const wet = (1 - gain) / (1 - WETNESS_MUFFLE_FLOOR);
  const cutoffHz = WETNESS_CUTOFF_DRY + (WETNESS_CUTOFF_SOAKED - WETNESS_CUTOFF_DRY) * wet;

  return { gain, cutoffHz, wet };
}

let currentMultiplier = 1;

/** Called by the survival tick each frame with the freshly derived modifier. */
export function setSfxWetnessMultiplier(multiplier: number): void {
  currentMultiplier = Number.isFinite(multiplier)
    ? clamp(multiplier, WETNESS_MUFFLE_FLOOR, 1)
    : 1;
}

export function getSfxWetnessMultiplier(): number {
  return currentMultiplier;
}

/** Mixer-side read: the mapped gain / cutoff for the live wetness. */
export function currentWetnessMuffle(): WetnessMuffle {
  return wetnessMuffleParams(currentMultiplier);
}

/** Run reset / dry start — drop back to an open mix. */
export function resetWetnessMuffle(): void {
  currentMultiplier = 1;
}
