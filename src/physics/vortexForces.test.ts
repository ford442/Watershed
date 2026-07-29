/**
 * vortexForces.test.ts — Pure funnel math + forecast gate multipliers
 */

import { describe, expect, it } from 'vitest';
import { FLOW_FORECAST_STATES } from '../constants/game';
import {
  computeVortexForces,
  effectiveVortexStrength,
  resolveVortexConfig,
  shouldWashOutCatwalk,
  vortexStrengthFromFlowRate,
  vortexStrengthMultiplier,
} from './vortexForces';

describe('computeVortexForces', () => {
  const center = { x: 0, y: 0, z: 0 };
  const config = resolveVortexConfig({
    radius: 10,
    eyeRadius: 2,
    pullStrength: 50,
    spinStrength: 2,
    downwardForce: 10,
  });

  it('returns outside when beyond radius', () => {
    const result = computeVortexForces({ x: 20, y: 0, z: 0 }, center, config);
    expect(result.inside).toBe(false);
    expect(result.force.x).toBe(0);
    expect(result.force.y).toBe(0);
    expect(result.force.z).toBe(0);
  });

  it('pulls inward on the horizontal plane', () => {
    const result = computeVortexForces({ x: 6, y: 1, z: 0 }, center, config);
    expect(result.inside).toBe(true);
    expect(result.force.x).toBeLessThan(0);
    expect(result.dist).toBeCloseTo(6, 5);
  });

  it('applies downward suction', () => {
    const result = computeVortexForces({ x: 4, y: 0, z: 0 }, center, config);
    expect(result.force.y).toBeLessThan(0);
  });

  it('scales with strength multiplier', () => {
    const mild = computeVortexForces({ x: 5, y: 0, z: 0 }, center, config, 0.85);
    const hard = computeVortexForces({ x: 5, y: 0, z: 0 }, center, config, 1.55);
    expect(Math.abs(hard.force.x)).toBeGreaterThan(Math.abs(mild.force.x));
    expect(Math.abs(hard.force.y)).toBeGreaterThan(Math.abs(mild.force.y));
  });

  it('softens radial pull inside the eye', () => {
    const rim = computeVortexForces({ x: 8, y: 0, z: 0 }, center, config);
    const eye = computeVortexForces({ x: 0.5, y: 0, z: 0 }, center, config);
    expect(Math.hypot(rim.force.x, rim.force.z)).toBeGreaterThan(
      Math.hypot(eye.force.x, eye.force.z),
    );
  });
});

describe('forecast gate helpers', () => {
  it('raises vortex strength for high dam-release states', () => {
    expect(vortexStrengthMultiplier(FLOW_FORECAST_STATES.NORMAL)).toBeLessThan(
      vortexStrengthMultiplier(FLOW_FORECAST_STATES.FLOODED),
    );
    expect(vortexStrengthMultiplier(FLOW_FORECAST_STATES.FLOODED)).toBeLessThan(
      vortexStrengthMultiplier(FLOW_FORECAST_STATES.WASHED_OUT),
    );
  });

  it('scales continuously with flowRate for low vs high release hours', () => {
    const low = vortexStrengthFromFlowRate(1.44);
    const high = vortexStrengthFromFlowRate(1.71);
    expect(high).toBeGreaterThan(low);
    expect(effectiveVortexStrength(FLOW_FORECAST_STATES.FLOODED, 1.44)).toBeLessThan(
      effectiveVortexStrength(FLOW_FORECAST_STATES.WASHED_OUT, 1.71),
    );
  });

  it('washes out catwalks only on WashedOut + hasBridge', () => {
    expect(shouldWashOutCatwalk(FLOW_FORECAST_STATES.FLOODED, true)).toBe(false);
    expect(shouldWashOutCatwalk(FLOW_FORECAST_STATES.WASHED_OUT, true)).toBe(true);
    expect(shouldWashOutCatwalk(FLOW_FORECAST_STATES.WASHED_OUT, false)).toBe(false);
  });
});
