import type { QualityPreset } from '../GameState';
import {
  isRenderScaleAtCeiling,
  isRenderScaleAtFloor,
} from '../../rendering/renderScale';

/** Quality levels used by LODManager / adaptive scaling. */
export type AdaptiveQualityLevel = QualityPreset;

/**
 * Presets adaptive FPS scaling may move between.
 *
 * `low` is excluded by design, not by constraint. Since boot-time graphics
 * negotiation (#405) every preset shares one `rendererContextCreationKey()`, so
 * auto-stepping into `low` no longer remounts the Canvas or tears down Rapier.
 * What remains is that `low` turns shadows off and drops DPR to 1.0 — a change
 * of *look*, which the game should not choose for the player during a rough
 * patch. The render scale (#419 phase C) is the valve that does get to move
 * automatically, because it trades sharpness rather than lighting.
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
  /**
   * Current render-scale valve position (#419 phase C).
   *
   * Two stages, one condition: resolution gives first, the preset only once the
   * valve has nothing left to give. A downward preset step therefore waits for
   * the valve to reach its floor, and an upward step waits for it to be back at
   * its ceiling — otherwise a recovering machine would be handed a heavier
   * preset while still rendering at 0.6x, which is how a controller oscillates.
   *
   * Omitting it means "this system has no valve" and selects the pre-#419
   * preset-only ladder. Passing `RENDER_SCALE_MAX` is the opposite statement —
   * a valve that is currently wide open — and does defer the preset, because a
   * wide-open valve is precisely the one with room to close.
   */
  renderScale?: number;
}

export interface AdaptiveQualityStepResult {
  /** `null` when the preset should not move this tick. */
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
  // `undefined` is not the same statement as 1.0 — see `renderScale` above.
  const valve = input.renderScale;

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
    // The valve still has room — let it close first, and hold the preset's own
    // history at zero so the preset gets its full three seconds of evidence
    // *after* the cheaper trade has been exhausted.
    if (valve !== undefined && !isRenderScaleAtFloor(valve)) {
      return {
        nextQuality: null,
        consecutiveLowSeconds: 0,
        consecutiveHighSeconds: 0,
      };
    }
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
    // Give the pixels back before the look: the valve reopens to full
    // resolution at this preset, and only a machine still running fast with the
    // valve wide open earns a heavier preset.
    if (valve !== undefined && !isRenderScaleAtCeiling(valve)) {
      return {
        nextQuality: null,
        consecutiveLowSeconds: 0,
        consecutiveHighSeconds: 0,
      };
    }
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
