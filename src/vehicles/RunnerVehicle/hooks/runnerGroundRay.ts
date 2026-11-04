import {
  GROUND_RAY_MIN_TOI,
  JUMP_CONFIG,
  RAYCAST_DISTANCE,
  RUNNER_GROUND_RAY_ORIGIN_Y_OFFSET,
} from '../constants';
import {
  castPlayerGroundRay,
  getRayTimeOfImpact,
  isTerrainGroundHit,
  scratchDownRay,
} from './RunnerPhysicsHelpers';
import type { RapierRayHit } from '../../../physics/rapierTypes';

export { castPlayerGroundRay, isTerrainGroundHit };

type Vec3 = { x: number; y: number; z: number };

/**
 * How far below the runner the boot / respawn warm-up looks for canyon before
 * releasing the body to fall onto it (the grounded test itself stays at
 * RAYCAST_DISTANCE). Spawns stand up to ~6 m over their floor.
 */
export const TERRAIN_READY_RAY_DISTANCE = 40;

/** Downward ground-ray origin: body translation + capsule-top clearance. */
export function buildGroundRayOrigin(pos: Vec3): Vec3 {
  return {
    x: pos.x,
    y: pos.y + RUNNER_GROUND_RAY_ORIGIN_Y_OFFSET,
    z: pos.z,
  };
}

/** World hit point from ray origin and time-of-impact (ray dir is −Y). */
export function computeGroundHitPoint(
  origin: Vec3,
  toi: number | null,
): Vec3 | null {
  if (toi === null) return null;
  return {
    x: origin.x,
    y: origin.y - toi,
    z: origin.z,
  };
}

/**
 * Update ungrounded-frame hysteresis and derive effective grounded state.
 * Requires GROUNDED_HYSTERESIS_FRAMES consecutive misses before going airborne.
 */
export function updateUngroundedHysteresis(
  ungroundedFrames: number,
  rawGrounded: boolean,
  hysteresisFrames: number = JUMP_CONFIG.GROUNDED_HYSTERESIS_FRAMES,
): { ungroundedFrames: number; isGrounded: boolean } {
  const nextFrames = rawGrounded
    ? 0
    : Math.min(ungroundedFrames + 1, hysteresisFrames);
  const isGrounded = rawGrounded || nextFrames < hysteresisFrames;
  return { ungroundedFrames: nextFrames, isGrounded };
}

/** Cast the player ground ray (the shared scratch ray) and derive hit point + raw grounded. */
export function resolvePlayerGroundRay(
  world: Parameters<typeof castPlayerGroundRay>[0],
  rapier: Parameters<typeof castPlayerGroundRay>[1],
  body: Parameters<typeof castPlayerGroundRay>[2],
  pos: Vec3,
): {
  hit: ReturnType<typeof castPlayerGroundRay>['hit'];
  toi: number | null;
  origin: Vec3;
  hitPoint: Vec3 | null;
  rawGrounded: boolean;
} {
  const origin = buildGroundRayOrigin(pos);
  const { hit, toi } = castPlayerGroundRay(world, rapier, body, origin);
  const hitPoint = computeGroundHitPoint(origin, toi);
  return {
    hit,
    toi,
    origin,
    hitPoint,
    rawGrounded: isTerrainGroundHit(toi),
  };
}

/** The ground ray's result, reused across steps (`resolvePlayerGroundRayInto`). */
export interface GroundRayResult {
  hit: RapierRayHit | null;
  toi: number | null;
  origin: Vec3;
  /** Points at `hitPointStore` on a hit, else null. */
  hitPoint: Vec3 | null;
  hitPointStore: Vec3;
  rawGrounded: boolean;
}

export function createGroundRayResult(): GroundRayResult {
  return {
    hit: null,
    toi: null,
    origin: { x: 0, y: 0, z: 0 },
    hitPoint: null,
    hitPointStore: { x: 0, y: 0, z: 0 },
    rawGrounded: false,
  };
}

/** `resolvePlayerGroundRay` into `out`: the same cast and numbers, no allocation of ours. */
export function resolvePlayerGroundRayInto(
  out: GroundRayResult,
  world: Parameters<typeof castPlayerGroundRay>[0],
  rapier: Parameters<typeof castPlayerGroundRay>[1],
  body: Parameters<typeof castPlayerGroundRay>[2],
  pos: Vec3,
): GroundRayResult {
  const origin = out.origin;
  origin.x = pos.x;
  origin.y = pos.y + RUNNER_GROUND_RAY_ORIGIN_Y_OFFSET;
  origin.z = pos.z;
  const ray = scratchDownRay(rapier, pos);
  const hit = body
    ? world.castRay(ray, RAYCAST_DISTANCE, true, undefined, undefined, undefined, body)
    : world.castRay(ray, RAYCAST_DISTANCE, true);
  const toi = getRayTimeOfImpact(hit);
  out.hit = hit;
  out.toi = toi;
  if (toi === null) {
    out.hitPoint = null;
  } else {
    out.hitPointStore.x = origin.x;
    out.hitPointStore.y = origin.y - toi;
    out.hitPointStore.z = origin.z;
    out.hitPoint = out.hitPointStore;
  }
  out.rawGrounded = isTerrainGroundHit(toi);
  return out;
}

/** True when the runner has canyon somewhere below it, within TERRAIN_READY_RAY_DISTANCE. */
export function hasTerrainBelow(
  world: Parameters<typeof castPlayerGroundRay>[0],
  rapier: Parameters<typeof castPlayerGroundRay>[1],
  body: Parameters<typeof castPlayerGroundRay>[2],
  pos: Vec3,
): boolean {
  const { toi } = castPlayerGroundRay(world, rapier, body, buildGroundRayOrigin(pos), TERRAIN_READY_RAY_DISTANCE);
  return toi !== null && toi >= GROUND_RAY_MIN_TOI;
}
