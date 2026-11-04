import { describe, expect, it } from 'vitest';
import { WATER_SHADER } from '../../constants/game';
import { FALLBACK_FLOW_DIR, SWE_DRY_DEPTH } from './sampleSWEFlow';
import { sweFoamWeight, sweStreakAxis } from './sweSurfaceField';

const MEAN = 1;

describe('sweStreakAxis', () => {
  const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

  it('quiet cell falls back to the authored downstream vector', () => {
    const a = sweStreakAxis(0.01, 0.01, 1);
    expect(a.blend).toBe(0);
    near(a.dirX, FALLBACK_FLOW_DIR.x);
    near(a.dirZ, FALLBACK_FLOW_DIR.z);
  });

  it('follows a planted velocity once above the full-speed threshold', () => {
    const speed = WATER_SHADER.SWE_STREAK_FULL_SPEED * 3;
    const a = sweStreakAxis(speed, 0, 1); // flowing +X
    expect(a.blend).toBeCloseTo(1, 6);
    near(a.dirX, 1);
    near(a.dirZ, 0);
    const b = sweStreakAxis(-speed * 0.6, speed * 0.8, 1);
    near(b.dirX, -0.6);
    near(b.dirZ, 0.8);
  });

  it('is fully authored in dry cells regardless of speed', () => {
    const a = sweStreakAxis(5, 0, 0);
    expect(a.blend).toBe(0);
    near(a.dirZ, FALLBACK_FLOW_DIR.z);
  });

  it('blends smoothly between the thresholds and returns a unit vector', () => {
    const mid = (WATER_SHADER.SWE_STREAK_MIN_SPEED + WATER_SHADER.SWE_STREAK_FULL_SPEED) / 2;
    const a = sweStreakAxis(mid, 0, 1);
    expect(a.blend).toBeGreaterThan(0);
    expect(a.blend).toBeLessThan(1);
    expect(Math.hypot(a.dirX, a.dirZ)).toBeCloseTo(1, 6);
    expect(a.dirX).toBeGreaterThan(0);
  });
});

describe('sweFoamWeight', () => {
  it('a dry bank cell contributes bank foam', () => {
    const w = sweFoamWeight(0, 0);
    expect(w.bank).toBe(1);
    expect(w.total).toBe(1);
  });

  it('a deep, uniform cell contributes none', () => {
    const w = sweFoamWeight(MEAN, 0);
    expect(w.bank).toBe(0);
    expect(w.jump).toBe(0);
    expect(w.total).toBe(0);
  });

  it('bank foam ramps off across the wetting band', () => {
    const half = sweFoamWeight(WATER_SHADER.SWE_WET_BAND / 2, 0).bank;
    expect(half).toBeGreaterThan(0);
    expect(half).toBeLessThan(1);
    expect(sweFoamWeight(WATER_SHADER.SWE_WET_BAND, 0).bank).toBe(0);
  });

  it('raises jump foam where divergence is positive, not where it is negative', () => {
    const hi = sweFoamWeight(MEAN, WATER_SHADER.SWE_JUMP_DIV_HI);
    expect(hi.jump).toBe(1);
    expect(hi.total).toBeCloseTo(WATER_SHADER.SWE_JUMP_FOAM_INTENSITY, 6);
    expect(sweFoamWeight(MEAN, -WATER_SHADER.SWE_JUMP_DIV_HI).jump).toBe(0);
  });

  it('never adds jump foam on a dry cell', () => {
    expect(sweFoamWeight(SWE_DRY_DEPTH / 2, 10).jump).toBe(0);
  });
});
