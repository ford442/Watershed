/**
 * shelfLaunch.ts — Pure helper for the segment-14 waterfall launch-shelf.
 *
 * Derives a world-space trigger box and launch impulse from:
 *  - the authored slab rock in `src/maps/meander_to_waterfall.ts`
 *  - the segment-14 spawn point broadcast by ChunkManager
 *  - vehicle tuning constants
 *
 * All math is plain object-based so this file is cheap to unit-test.
 */

import { getActiveMap } from '../../maps/registry';
import { JSONMapManager } from '../../systems/MapSystem';
import { VEHICLE_TUNING } from '../../constants/vehicleTuning';

/** Minimum downstream speed (m/s) required to trigger the launch shelf. */
export const SHELF_LAUNCH_SPEED_THRESHOLD = VEHICLE_TUNING.shelfLaunch.speedThreshold;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface ShelfTrigger {
  center: Vec3;
  xAxis: Vec3; // binormal / lateral
  yAxis: Vec3; // world up
  zAxis: Vec3; // downstream along segment tangent
  halfWidth: number;
  halfHeight: number;
  halfLength: number;
}

export interface ShelfLaunchResult {
  impulse: Vec3;
  downstreamDir: Vec3;
}

const UP: Vec3 = { x: 0, y: 1, z: 0 };

// Waterfall segments force a steep downstream tangent in ChunkManager:
//   direction.z = -0.12
//   direction.y = Math.min(direction.y, -0.92)
// We use the normalized result as the segment's downstream axis.
const WATERFALL_TANGENT: Vec3 = (() => {
  const v = { x: 0, y: -0.92, z: -0.12 };
  const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  return {
    x: v.x / len,
    y: v.y / len,
    z: v.z / len,
  };
})();

// ChunkManager places authored decorations at:
//   rockT = 0.5 + localZ / geoLength
//   pos   = segmentPath.getPoint(rockT) + binormal * localX
// For the seg-14 slab (localZ = -35) this sits ~15 m from the segment start
// assuming a ~100 m segment length. We use that approximation here.
const SEGMENT_LENGTH_ESTIMATE = 100;

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function scale(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function normalize(v: Vec3): Vec3 {
  const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  if (len < 1e-8) return { x: 0, y: 0, z: 1 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function isFiniteVec3(v: Vec3 | null | undefined): v is Vec3 {
  if (!v) return false;
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

/**
 * Find the segment-14 launchShelf config from the active authored map JSON.
 */
export function getSegment14LaunchShelfConfig() {
  const map = getActiveMap();
  const manager = new JSONMapManager(map.levelData);
  return manager.getChunkConfig(14).launchShelf ?? null;
}

/**
 * Build the world-space trigger box for the launch shelf.
 * Returns null if the spawn point is invalid or no launchShelf config exists.
 */
export function computeShelfTrigger(spawnPoint: Vec3 | null): ShelfTrigger | null {
  const config = getSegment14LaunchShelfConfig();
  if (!config || !isFiniteVec3(spawnPoint)) return null;

  const tangent = WATERFALL_TANGENT;
  const binormal = normalize(cross(tangent, UP));

  const rockT = 0.5 + config.rockRef.localZ / SEGMENT_LENGTH_ESTIMATE;
  const distanceAlongPath = Math.max(0, Math.min(SEGMENT_LENGTH_ESTIMATE, rockT * SEGMENT_LENGTH_ESTIMATE));

  // Shelf center from authored rock placement.
  const shelfCenter = add(
    add(spawnPoint, scale(tangent, distanceAlongPath)),
    scale(binormal, config.rockRef.localX),
  );

  // Trigger plane sits slightly downstream of the shelf center.
  const triggerCenter = add(
    add(shelfCenter, scale(tangent, config.triggerDownstreamOffset)),
    scale(UP, config.triggerYOffset),
  );

  return {
    center: triggerCenter,
    xAxis: binormal,
    yAxis: UP,
    zAxis: tangent,
    halfWidth: config.triggerHalfWidth,
    halfHeight: config.triggerHeight * 0.5,
    halfLength: config.triggerHalfLength,
  };
}

/**
 * Test whether a world-space point lies inside the oriented trigger box.
 */
export function isInsideShelfTrigger(pos: Vec3, trigger: ShelfTrigger | null): boolean {
  if (!trigger || !isFiniteVec3(pos)) return false;

  const local = sub(pos, trigger.center);
  const lx = Math.abs(dot(local, trigger.xAxis));
  const ly = Math.abs(dot(local, trigger.yAxis));
  const lz = Math.abs(dot(local, trigger.zAxis));

  return (
    lx <= trigger.halfWidth &&
    ly <= trigger.halfHeight &&
    lz <= trigger.halfLength
  );
}

/**
 * Horizontal downstream direction (projection of the segment tangent onto the XZ plane).
 */
export function getShelfDownstreamDirection(): Vec3 {
  return normalize({ x: WATERFALL_TANGENT.x, y: 0, z: WATERFALL_TANGENT.z });
}

/**
 * Compute the launch impulse for a vehicle crossing the shelf trigger.
 * `scale` is the per-vehicle multiplier (runnerScale / raftScale).
 */
export function computeShelfLaunchImpulse(vehicleScale: number): ShelfLaunchResult {
  const downstream = getShelfDownstreamDirection();
  const impulse = add(
    scale(downstream, VEHICLE_TUNING.shelfLaunch.forwardMagnitude * vehicleScale),
    scale(UP, VEHICLE_TUNING.shelfLaunch.upMagnitude * vehicleScale),
  );
  return { impulse, downstreamDir: downstream };
}

/**
 * Convenience: downstream speed along the launch direction.
 */
export function getShelfDownstreamSpeed(velocity: Vec3): number {
  if (!isFiniteVec3(velocity)) return 0;
  return Math.max(0, dot(velocity, getShelfDownstreamDirection()));
}

/**
 * Convenience: check if the launch should fire this frame.
 * Mutates the fired flag on success.
 */
export function tryFireShelfLaunch(args: {
  currentSegmentIndex: number;
  position: Vec3;
  velocity: Vec3;
  trigger: ShelfTrigger | null;
  firedRef: { current: boolean };
  speedThreshold: number;
  vehicleScale: number;
}): ShelfLaunchResult | null {
  const { currentSegmentIndex, position, velocity, trigger, firedRef, speedThreshold, vehicleScale } = args;

  if (currentSegmentIndex !== 14) {
    firedRef.current = false;
    return null;
  }

  if (firedRef.current) return null;
  if (!trigger) return null;

  const downstreamSpeed = getShelfDownstreamSpeed(velocity);
  if (downstreamSpeed < speedThreshold) return null;
  if (!isInsideShelfTrigger(position, trigger)) return null;

  firedRef.current = true;
  return computeShelfLaunchImpulse(vehicleScale);
}
