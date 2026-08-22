import type { QualityPreset } from '../GameState';

/** Quality levels used by LODManager / adaptive scaling. */
export type AdaptiveQualityLevel = QualityPreset;

/**
 * Presets adaptive FPS scaling may move between.
 *
 * `low` flips WebGL creation attributes (`antialias`, `failIfMajorPerformanceCaveat`),
 * which remounts the Canvas and tears down Rapier / the track treadmill / WASM
 * (see `rendererContextCreationKey` in deriveRendererContextOptions.ts). Auto-
 * stepping into or out of `low` therefore freezes boot ("Graphics paused —
 * recovering…") and can destroy an active run. Only a deliberate Settings change
 * may select `low`.
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
