/**
 * launchScoring.ts — Pure air-time tier mapping for the segment-14 launch shelf.
 *
 * Numeric score commits on landing; tier labels at launch are predictive only.
 */

export type AirTier = 'None' | 'Nice' | 'Great' | 'Perfect';

export interface AirTimeScoreResult {
  tier: AirTier;
  score: number;
  comboDelta: number;
}

export const AIR_TIME_THRESHOLDS = {
  /** Below this measured air-time (seconds) → no reward. */
  MIN_REWARD: 0.6,
  /** ≥ this → Great tier. */
  GREAT: 1.5,
  /** ≥ this → Perfect tier. */
  PERFECT: 2.5,
} as const;

export const TIER_SCORES: Record<Exclude<AirTier, 'None'>, number> = {
  Nice: 150,
  Great: 400,
  Perfect: 800,
};

/** Flat bonus when launch speed cleared the shelf speed gate. */
export const CLEAN_LAUNCH_BONUS = 100;

/** Minimum horizontal (XZ) displacement from launch point to count as a real leap. */
export const MIN_GAP_HORIZONTAL = 6.0;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export function horizontalDistance(a: Vec3, b: Vec3): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  return Math.sqrt(dx * dx + dz * dz);
}

/**
 * Map measured air-time to tiered score. Returns zero for failed launches.
 */
export function calculateAirTimeScore(
  airTimeSec: number,
  clean: boolean,
  clearedGap: boolean,
): AirTimeScoreResult {
  if (!clearedGap || airTimeSec < AIR_TIME_THRESHOLDS.MIN_REWARD) {
    return { tier: 'None', score: 0, comboDelta: 0 };
  }

  let tier: Exclude<AirTier, 'None'> = 'Nice';
  if (airTimeSec >= AIR_TIME_THRESHOLDS.PERFECT) {
    tier = 'Perfect';
  } else if (airTimeSec >= AIR_TIME_THRESHOLDS.GREAT) {
    tier = 'Great';
  }

  let score = TIER_SCORES[tier];
  let comboDelta = 0;
  if (clean) {
    score += CLEAN_LAUNCH_BONUS;
    comboDelta = 1;
  }

  return { tier, score, comboDelta };
}

/**
 * Instant tier label shown at launch (predictive, not the committed score).
 */
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
