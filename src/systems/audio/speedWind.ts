/**
 * speedWind.ts — Pure speed → wind gain / lowpass mapping.
 *
 * Shared by SpeedWindAudio (runtime) and unit tests. No Three.js / Audio
 * imports so Vitest can exercise the curve without a Web Audio context.
 */

export interface SpeedWindOptions {
  /** Horizontal speed where wind becomes audible. */
  startSpeed?: number;
  /** Horizontal speed where wind gain reaches 1. */
  fullSpeed?: number;
  /** Lowpass cutoff (Hz) at rest / below startSpeed. */
  cutoffAtRest?: number;
  /** Lowpass cutoff (Hz) at fullSpeed. */
  cutoffAtFull?: number;
}

export interface SpeedWindResult {
  /** Normalized wind intensity 0–1 (pre channel/master multipliers). */
  gain: number;
  /** Suggested BiquadFilter lowpass frequency in Hz. */
  cutoffHz: number;
}

export const DEFAULT_SPEED_WIND: Required<SpeedWindOptions> = {
  startSpeed: 0.75,
  fullSpeed: 22,
  cutoffAtRest: 380,
  cutoffAtFull: 5200,
};

/**
 * Map horizontal player speed to wind gain + brightness.
 *
 * Non-finite / negative speeds collapse to silence at the rest cutoff.
 * Gain is clamped to [0, 1]; cutoff is clamped between the rest/full ends.
 */
export function mapSpeedToWind(
  speed: number,
  options: SpeedWindOptions = {},
): SpeedWindResult {
  const startSpeed = options.startSpeed ?? DEFAULT_SPEED_WIND.startSpeed;
  const fullSpeed = options.fullSpeed ?? DEFAULT_SPEED_WIND.fullSpeed;
  const cutoffAtRest = options.cutoffAtRest ?? DEFAULT_SPEED_WIND.cutoffAtRest;
  const cutoffAtFull = options.cutoffAtFull ?? DEFAULT_SPEED_WIND.cutoffAtFull;

  if (!Number.isFinite(speed) || speed <= 0) {
    return { gain: 0, cutoffHz: cutoffAtRest };
  }

  const span = Math.max(1e-6, fullSpeed - startSpeed);
  const t = Math.min(1, Math.max(0, (speed - startSpeed) / span));
  // Ease-in so low speeds stay soft (no zipper at the threshold).
  const gain = t * t;

  if (!Number.isFinite(gain)) {
    return { gain: 0, cutoffHz: cutoffAtRest };
  }

  const cutoffHz = cutoffAtRest + (cutoffAtFull - cutoffAtRest) * t;
  return {
    gain: Math.min(1, Math.max(0, gain)),
    cutoffHz: Number.isFinite(cutoffHz) ? cutoffHz : cutoffAtRest,
  };
}

/** Sanitize a gain before it reaches a Web Audio / Three.js volume node. */
export function sanitizeAudioGain(value: number, fallback = 0): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, value));
}

/** Sanitize a filter frequency (Hz) before writing to a BiquadFilter. */
export function sanitizeCutoffHz(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(20000, Math.max(20, value));
}
