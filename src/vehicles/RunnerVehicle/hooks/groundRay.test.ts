import { describe, expect, it } from 'vitest';
import {
  GROUND_RAY_MIN_TOI,
  JUMP_CONFIG,
  RAYCAST_DISTANCE,
  RUNNER_GROUND_RAY_ORIGIN_Y_OFFSET,
} from '../constants';
import {
  getRayTimeOfImpact,
  isTerrainGroundHit,
} from './RunnerPhysicsHelpers';
import {
  buildGroundRayOrigin,
  computeGroundHitPoint,
  updateUngroundedHysteresis,
  resolvePlayerGroundRay,
  isTerrainGroundHit as isTerrainGroundHitFromModule,
} from './runnerGroundRay';

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
    expect(isTerrainGroundHitFromModule(GROUND_RAY_MIN_TOI)).toBe(true);
  });

  it('places ray origin above the runner capsule', () => {
    const bodyY = -6;
    expect(RUNNER_GROUND_RAY_ORIGIN_Y_OFFSET).toBeGreaterThan(0.9);
    expect(bodyY + RUNNER_GROUND_RAY_ORIGIN_Y_OFFSET).toBeGreaterThan(bodyY + 0.5);
    expect(buildGroundRayOrigin({ x: 1, y: bodyY, z: -2 })).toEqual({
      x: 1,
      y: bodyY + RUNNER_GROUND_RAY_ORIGIN_Y_OFFSET,
      z: -2,
    });
  });

  it('computes hit point from origin and TOI', () => {
    const origin = { x: 2, y: 5, z: -4 };
    expect(computeGroundHitPoint(origin, null)).toBeNull();
    expect(computeGroundHitPoint(origin, 1.5)).toEqual({ x: 2, y: 3.5, z: -4 });
  });

  it('applies grounded hysteresis before going airborne', () => {
    const frames = JUMP_CONFIG.GROUNDED_HYSTERESIS_FRAMES;
    expect(updateUngroundedHysteresis(0, true)).toEqual({
      ungroundedFrames: 0,
      isGrounded: true,
    });
    expect(updateUngroundedHysteresis(0, false, frames)).toEqual({
      ungroundedFrames: 1,
      isGrounded: true,
    });
    expect(updateUngroundedHysteresis(frames - 1, false, frames)).toEqual({
      ungroundedFrames: frames,
      isGrounded: false,
    });
    expect(updateUngroundedHysteresis(frames, false, frames)).toEqual({
      ungroundedFrames: frames,
      isGrounded: false,
    });
  });

  it('resolvePlayerGroundRay frees the ray and reports hit data', () => {
    const free = () => {};
    const world = {
      castRay: () => ({ timeOfImpact: 1.25 }),
    };
    const rapier = {
      Ray: class {
        free = free;
        constructor(
          public origin: { x: number; y: number; z: number },
          public dir: { x: number; y: number; z: number },
        ) {}
      },
    };
    const resolved = resolvePlayerGroundRay(
      world as any,
      rapier as any,
      { handle: 1 },
      { x: 0, y: -6, z: 0 },
    );
    expect(resolved.toi).toBe(1.25);
    expect(resolved.rawGrounded).toBe(true);
    expect(resolved.hitPoint?.y).toBeCloseTo(
      -6 + RUNNER_GROUND_RAY_ORIGIN_Y_OFFSET - 1.25,
      5,
    );
  });
});
