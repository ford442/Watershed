import {
  calculateAirTimeScore,
  predictLaunchTierLabel,
  horizontalDistance,
  CLEAN_LAUNCH_SCORE_MULTIPLIER,
  TIER_SCORES,
  AIR_TIME_THRESHOLDS,
  MIN_GAP_HORIZONTAL,
  LAUNCH_BASE_POINTS_PER_SEC,
} from './launchScoring';

describe('calculateAirTimeScore (launchScoring shim)', () => {
  it('returns no reward below minimum air-time', () => {
    expect(calculateAirTimeScore(0.59, true, true, false)).toEqual({
      tier: 'None',
      score: 0,
      comboDelta: 0,
      clean: false,
    });
  });

  it('returns no reward when horizontal gap was not cleared', () => {
    expect(calculateAirTimeScore(2.0, true, false, false)).toEqual({
      tier: 'None',
      score: 0,
      comboDelta: 0,
      clean: false,
    });
  });

  it('maps Nice tier at the minimum reward threshold', () => {
    expect(calculateAirTimeScore(AIR_TIME_THRESHOLDS.MIN_REWARD, false, true, false)).toEqual({
      tier: 'Nice',
      score: TIER_SCORES.Nice,
      comboDelta: 0,
      clean: false,
    });
  });

  it('applies clean multiplier for splash water landing without wall hits', () => {
    const result = calculateAirTimeScore(1.0, true, true, false);
    expect(result.tier).toBe('Nice');
    expect(result.score).toBe(Math.round(LAUNCH_BASE_POINTS_PER_SEC * CLEAN_LAUNCH_SCORE_MULTIPLIER));
    expect(result.comboDelta).toBe(1);
    expect(result.clean).toBe(true);
  });
});

describe('predictLaunchTierLabel', () => {
  const threshold = 12;

  it('shows AIR! below the speed gate', () => {
    expect(predictLaunchTierLabel(8, threshold)).toBe('AIR!');
  });
});

describe('horizontalDistance', () => {
  it('measures XZ displacement only', () => {
    expect(horizontalDistance({ x: 0, y: 0, z: 0 }, { x: MIN_GAP_HORIZONTAL, y: 0, z: 0 }))
      .toBeCloseTo(MIN_GAP_HORIZONTAL);
  });
});
