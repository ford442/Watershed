import { describe, expect, it } from 'vitest';
import {
  GROUND_RAY_MIN_TOI,
  RAYCAST_DISTANCE,
  RUNNER_GROUND_RAY_ORIGIN_Y_OFFSET,
} from '../constants';
import {
  getRayTimeOfImpact,
  isTerrainGroundHit,
} from './RunnerPhysicsHelpers';

describe('runner ground ray helpers', () => {
  it('reads numeric and callable Rapier TOI values', () => {
    expect(getRayTimeOfImpact({ timeOfImpact: 0.42 })).toBe(0.42);
    expect(getRayTimeOfImpact({ timeOfImpact: () => 0.75 })).toBe(0.75);
    expect(getRayTimeOfImpact(null)).toBeNull();
  });

  it('rejects self-intersection hits at TOI 0', () => {
    expect(isTerrainGroundHit(0)).toBe(false);
    expect(isTerrainGroundHit(0.001)).toBe(false);
    expect(isTerrainGroundHit(GROUND_RAY_MIN_TOI)).toBe(true);
    expect(isTerrainGroundHit(RAYCAST_DISTANCE)).toBe(true);
    expect(isTerrainGroundHit(RAYCAST_DISTANCE + 0.1)).toBe(false);
  });

  it('places ray origin above the runner capsule', () => {
    const bodyY = -6;
    expect(RUNNER_GROUND_RAY_ORIGIN_Y_OFFSET).toBeGreaterThan(0.9);
    expect(bodyY + RUNNER_GROUND_RAY_ORIGIN_Y_OFFSET).toBeGreaterThan(bodyY + 0.5);
  });
});
