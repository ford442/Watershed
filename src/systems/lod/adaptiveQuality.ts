import type { QualityPreset } from '../GameState';

/** Quality levels used by LODManager / adaptive scaling. */
export type AdaptiveQualityLevel = QualityPreset;

/**
 * Presets adaptive FPS scaling may move between.
 *
 * `low` used to flip WebGL creation attributes (`antialias`,
 * `failIfMajorPerformanceCaveat`, `powerPreference`), which remounted the Canvas
 * and tore down Rapier / the track treadmill / WASM. Since boot-time graphics
 * negotiation those attributes are session constants, so `low` no longer remounts
 * anything — the technical bar is gone.
 *
 * The band stays as it is anyway: `low` turns shadows off entirely and drops DPR
 * to 1.0, which is a visible change of look rather than a tuning step, and having
 * the game silently choose it during a rough patch is a worse experience than
 * letting the player choose it. Widening the band is now a design decision, not
 * a renderer constraint.
 */
export const ADAPTIVE_LIVE_BAND: readonly AdaptiveQualityLevel[] = [
  'medium',
  'high',
  'ultra',
] as const;

export interface AdaptiveQualityStepInput {
  quality: AdaptiveQualityLevel;
  currentFPS: number;
  targetFPS: number;
  consecutiveLowSeconds: number;
  consecutiveHighSeconds: number;
}

export interface AdaptiveQualityStepResult {
  nextQuality: AdaptiveQualityLevel | null;
  consecutiveLowSeconds: number;
  consecutiveHighSeconds: number;
}

/**
 * Pure adaptive step — exported for unit tests.
 * Returns `nextQuality: null` when no change should be applied.
 */
export function stepAdaptiveQuality(
  input: AdaptiveQualityStepInput
): AdaptiveQualityStepResult {
  const {
    quality,
    currentFPS,
    targetFPS,
    consecutiveLowSeconds,
    consecutiveHighSeconds,
  } = input;

  // User (or software-GL fallback) chose `low` — leave it alone until they change it.
  if (quality === 'low' || !ADAPTIVE_LIVE_BAND.includes(quality)) {
    return {
      nextQuality: null,
      consecutiveLowSeconds: 0,
      consecutiveHighSeconds: 0,
    };
  }

  const currentIndex = ADAPTIVE_LIVE_BAND.indexOf(quality);
  const downgradeThreshold = targetFPS - 10;
  const upgradeThreshold = targetFPS + 5;

  if (currentFPS < downgradeThreshold && currentIndex > 0) {
    const nextLow = consecutiveLowSeconds + 1;
    if (nextLow >= 3) {
      return {
        nextQuality: ADAPTIVE_LIVE_BAND[currentIndex - 1],
        consecutiveLowSeconds: 0,
        consecutiveHighSeconds: 0,
      };
    }
    return {
      nextQuality: null,
      consecutiveLowSeconds: nextLow,
      consecutiveHighSeconds: 0,
    };
  }

  if (
    currentFPS > upgradeThreshold &&
    currentIndex < ADAPTIVE_LIVE_BAND.length - 1
  ) {
    const nextHigh = consecutiveHighSeconds + 1;
    if (nextHigh >= 2) {
      return {
        nextQuality: ADAPTIVE_LIVE_BAND[currentIndex + 1],
        consecutiveLowSeconds: 0,
        consecutiveHighSeconds: 0,
      };
    }
    return {
      nextQuality: null,
      consecutiveLowSeconds: 0,
      consecutiveHighSeconds: nextHigh,
    };
  }

  return {
    nextQuality: null,
    consecutiveLowSeconds: Math.max(0, consecutiveLowSeconds - 1),
    consecutiveHighSeconds: Math.max(0, consecutiveHighSeconds - 1),
  };
}
