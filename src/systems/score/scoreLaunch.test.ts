import {
  accumulateAirTime,
  calculateAirTimeScore,
  predictLaunchTierLabel,
  horizontalDistance,
  LAUNCH_BASE_POINTS_PER_SEC,
  CLEAN_LAUNCH_SCORE_MULTIPLIER,
  TIER_SCORES,
  AIR_TIME_THRESHOLDS,
  MIN_GAP_HORIZONTAL,
} from './scoreLaunch';

describe('calculateAirTimeScore', () => {
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

  it('maps Great tier at the great threshold', () => {
    expect(calculateAirTimeScore(AIR_TIME_THRESHOLDS.GREAT, false, true, false)).toEqual({
      tier: 'Great',
      score: TIER_SCORES.Great,
      comboDelta: 0,
      clean: false,
    });
  });

  it('maps Perfect tier at the perfect threshold', () => {
    expect(calculateAirTimeScore(AIR_TIME_THRESHOLDS.PERFECT, false, true, false)).toEqual({
      tier: 'Perfect',
      score: TIER_SCORES.Perfect,
      comboDelta: 0,
      clean: false,
    });
  });

  it('applies clean multiplier and combo delta for splash-pool water landing', () => {
    const base = Math.round(LAUNCH_BASE_POINTS_PER_SEC * 1.0);
    const result = calculateAirTimeScore(1.0, true, true, false);
    expect(result.tier).toBe('Nice');
    expect(result.score).toBe(Math.round(base * CLEAN_LAUNCH_SCORE_MULTIPLIER));
    expect(result.comboDelta).toBe(1);
    expect(result.clean).toBe(true);
  });

  it('denies clean bonus when a wall contact was recorded during flight', () => {
    const result = calculateAirTimeScore(1.0, true, true, true);
    expect(result.clean).toBe(false);
    expect(result.comboDelta).toBe(0);
    expect(result.score).toBe(Math.round(LAUNCH_BASE_POINTS_PER_SEC * 1.0));
  });

  it('denies clean bonus for terrain landing even without wall contacts', () => {
    const result = calculateAirTimeScore(1.0, false, true, false);
    expect(result.clean).toBe(false);
    expect(result.comboDelta).toBe(0);
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

describe('accumulateAirTime', () => {
  it('ignores non-finite or non-positive dt', () => {
    expect(accumulateAirTime(1.2, 0)).toBe(1.2);
    expect(accumulateAirTime(1.2, -0.1)).toBe(1.2);
    expect(accumulateAirTime(1.2, Number.NaN)).toBe(1.2);
  });

  it('accumulates physics-step deltas', () => {
    expect(accumulateAirTime(0.4, 0.1)).toBeCloseTo(0.5);
    expect(accumulateAirTime(0, 0.016)).toBeCloseTo(0.016);
  });
});

describe('score scaling', () => {
  it('rewards longer air-time linearly before clean multiplier', () => {
    const short = calculateAirTimeScore(0.8, false, true, false);
    const long = calculateAirTimeScore(1.6, false, true, false);
    expect(long.score).toBeGreaterThan(short.score);
    expect(long.score / short.score).toBeCloseTo(1.6 / 0.8, 5);
  });

  it('clean splash landing beats messy terrain landing at equal air-time', () => {
    const clean = calculateAirTimeScore(1.2, true, true, false);
    const messy = calculateAirTimeScore(1.2, false, true, false);
    expect(clean.score).toBeGreaterThan(messy.score);
  });
});
