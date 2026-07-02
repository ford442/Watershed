import {
  calculateAirTimeScore,
  predictLaunchTierLabel,
  horizontalDistance,
  CLEAN_LAUNCH_BONUS,
  TIER_SCORES,
  AIR_TIME_THRESHOLDS,
  MIN_GAP_HORIZONTAL,
} from './launchScoring';

describe('calculateAirTimeScore', () => {
  it('returns no reward below minimum air-time', () => {
    expect(calculateAirTimeScore(0.59, true, true)).toEqual({
      tier: 'None',
      score: 0,
      comboDelta: 0,
    });
  });

  it('returns no reward when horizontal gap was not cleared', () => {
    expect(calculateAirTimeScore(2.0, true, false)).toEqual({
      tier: 'None',
      score: 0,
      comboDelta: 0,
    });
  });

  it('maps Nice tier at the minimum reward threshold', () => {
    expect(calculateAirTimeScore(AIR_TIME_THRESHOLDS.MIN_REWARD, false, true)).toEqual({
      tier: 'Nice',
      score: TIER_SCORES.Nice,
      comboDelta: 0,
    });
  });

  it('maps Great tier at the great threshold', () => {
    expect(calculateAirTimeScore(AIR_TIME_THRESHOLDS.GREAT, false, true)).toEqual({
      tier: 'Great',
      score: TIER_SCORES.Great,
      comboDelta: 0,
    });
  });

  it('maps Perfect tier at the perfect threshold', () => {
    expect(calculateAirTimeScore(AIR_TIME_THRESHOLDS.PERFECT, false, true)).toEqual({
      tier: 'Perfect',
      score: TIER_SCORES.Perfect,
      comboDelta: 0,
    });
  });

  it('adds flat clean-launch bonus and combo delta without multiplier stacking', () => {
    const result = calculateAirTimeScore(1.0, true, true);
    expect(result.tier).toBe('Nice');
    expect(result.score).toBe(TIER_SCORES.Nice + CLEAN_LAUNCH_BONUS);
    expect(result.comboDelta).toBe(1);
  });
});

describe('predictLaunchTierLabel', () => {
  const threshold = 12;

  it('shows AIR! below the speed gate', () => {
    expect(predictLaunchTierLabel(8, threshold)).toBe('AIR!');
  });

  it('escalates predicted labels with launch speed', () => {
    expect(predictLaunchTierLabel(12, threshold)).toBe('AIR!');
    expect(predictLaunchTierLabel(16, threshold)).toBe('GREAT!');
    expect(predictLaunchTierLabel(20, threshold)).toBe('PERFECT?!');
  });
});

describe('horizontalDistance', () => {
  it('measures XZ displacement only', () => {
    expect(horizontalDistance({ x: 0, y: 0, z: 0 }, { x: 3, y: 99, z: 4 })).toBeCloseTo(5);
    expect(horizontalDistance({ x: 0, y: 0, z: 0 }, { x: MIN_GAP_HORIZONTAL, y: 0, z: 0 }))
      .toBeCloseTo(MIN_GAP_HORIZONTAL);
  });
});
