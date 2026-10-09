import { describe, expect, it } from 'vitest';
import { WIND_LEAVES_MAX, windLeavesCount } from './WindLeaves';

describe('windLeavesCount', () => {
  it('is zero outside autumn, storm or not', () => {
    expect(windLeavesCount('canyonSummer', 0)).toBe(0);
    expect(windLeavesCount('glacialMelt', 1)).toBe(0);
  });

  it('autumn has calm leaves, and a storm fills the layer', () => {
    const calm = windLeavesCount('canyonAutumn', 0);
    expect(calm).toBeGreaterThan(0);
    expect(windLeavesCount('canyonAutumn', 1)).toBe(WIND_LEAVES_MAX);
    expect(windLeavesCount('canyonAutumn', 0.5)).toBeGreaterThan(calm);
  });
});
