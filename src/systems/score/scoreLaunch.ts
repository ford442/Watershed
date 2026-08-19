/**
 * scoreLaunch.ts — Pure air-time scoring for the segment-14 waterfall launch shelf.
 *
 * Score commits on landing: basePointsPerSec × measured air-time, with a clean-launch
 * multiplier when the player lands in splash-pool water without canyon wall contacts.
 */

export type AirTier = 'None' | 'Nice' | 'Great' | 'Perfect';

export interface AirTimeScoreResult {
  tier: AirTier;
  score: number;
  comboDelta: number;
  clean: boolean;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Points awarded per second of measured air-time (before clean multiplier). */
export const LAUNCH_BASE_POINTS_PER_SEC = 250;

/** Multiplier applied when landing cleanly in splash-pool water. */
export const CLEAN_LAUNCH_SCORE_MULTIPLIER = 1.5;

export const AIR_TIME_THRESHOLDS = {
  /** Below this measured air-time (seconds) → no reward. */
  MIN_REWARD: 0.6,
  /** ≥ this → Great tier label. */
  GREAT: 1.5,
  /** ≥ this → Perfect tier label. */
  PERFECT: 2.5,
} as const;

/** Minimum horizontal (XZ) displacement from launch point to count as a real leap. */
export const MIN_GAP_HORIZONTAL = 6.0;

/** @deprecated Use CLEAN_LAUNCH_SCORE_MULTIPLIER — kept for legacy test imports. */
export const CLEAN_LAUNCH_BONUS = Math.round(
  LAUNCH_BASE_POINTS_PER_SEC * AIR_TIME_THRESHOLDS.MIN_REWARD * (CLEAN_LAUNCH_SCORE_MULTIPLIER - 1),
);

/** Reference tier scores at threshold air-times (for tests / HUD copy). */
export const TIER_SCORES: Record<Exclude<AirTier, 'None'>, number> = {
  Nice: Math.round(LAUNCH_BASE_POINTS_PER_SEC * AIR_TIME_THRESHOLDS.MIN_REWARD),
  Great: Math.round(LAUNCH_BASE_POINTS_PER_SEC * AIR_TIME_THRESHOLDS.GREAT),
  Perfect: Math.round(LAUNCH_BASE_POINTS_PER_SEC * AIR_TIME_THRESHOLDS.PERFECT),
};

export function horizontalDistance(a: Vec3, b: Vec3): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  return Math.sqrt(dx * dx + dz * dz);
}

function tierFromAirTime(airTimeSec: number): Exclude<AirTier, 'None'> {
  if (airTimeSec >= AIR_TIME_THRESHOLDS.PERFECT) return 'Perfect';
  if (airTimeSec >= AIR_TIME_THRESHOLDS.GREAT) return 'Great';
  return 'Nice';
}

/**
 * Map measured air-time to score. Clean launch requires splash-pool water landing
 * with no wall contacts recorded during the flight window.
 */
export function calculateAirTimeScore(
  airTimeSec: number,
  landedInSplashWater: boolean,
  clearedGap: boolean,
  wallContactDuringFlight: boolean,
): AirTimeScoreResult {
  if (!clearedGap || airTimeSec < AIR_TIME_THRESHOLDS.MIN_REWARD) {
    return { tier: 'None', score: 0, comboDelta: 0, clean: false };
  }

  const tier = tierFromAirTime(airTimeSec);
  const clean = landedInSplashWater && !wallContactDuringFlight;
  let score = Math.round(LAUNCH_BASE_POINTS_PER_SEC * airTimeSec);
  let comboDelta = 0;

  if (clean) {
    score = Math.round(score * CLEAN_LAUNCH_SCORE_MULTIPLIER);
    comboDelta = 1;
  }

  return { tier, score, comboDelta, clean };
}

/** Instant tier label shown at launch (predictive, not the committed score). */
export function predictLaunchTierLabel(downstreamSpeed: number, speedThreshold: number): string {
  if (downstreamSpeed < speedThreshold) return 'AIR!';
  if (downstreamSpeed >= 20) return 'PERFECT?!';
  if (downstreamSpeed >= 16) return 'GREAT!';
  return 'AIR!';
}

export function tierDisplayLabel(tier: AirTier): string {
  switch (tier) {
    case 'Perfect':
      return 'PERFECT!';
    case 'Great':
      return 'GREAT!';
    case 'Nice':
      return 'NICE!';
    default:
      return '';
  }
}

/** Accumulate air-time samples (pure reducer for unit tests). */
export function accumulateAirTime(current: number, physicsDt: number): number {
  if (!Number.isFinite(physicsDt) || physicsDt <= 0) return current;
  return current + physicsDt;
}
