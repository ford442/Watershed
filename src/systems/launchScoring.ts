/**
 * @deprecated Import from `./scoreLaunch` instead. Re-export shim for existing imports.
 */
export {
  calculateAirTimeScore,
  predictLaunchTierLabel,
  tierDisplayLabel,
  horizontalDistance,
  accumulateAirTime,
  LAUNCH_BASE_POINTS_PER_SEC,
  CLEAN_LAUNCH_SCORE_MULTIPLIER,
  CLEAN_LAUNCH_BONUS,
  TIER_SCORES,
  AIR_TIME_THRESHOLDS,
  MIN_GAP_HORIZONTAL,
  type AirTier,
  type AirTimeScoreResult,
  type Vec3,
} from './scoreLaunch';
