/**
 * journeyContinuity.ts — Pure helpers for seamless map/reach handoffs.
 *
 * Joins the end of reach/map N to the start of N+1 (waypoints, water level,
 * width blend) without allocating scene graph objects. Unit-tested; safe to
 * call from handoff planning outside React.
 */

import * as THREE from 'three';
import { ensureTangentContinuity } from './MapSystem.generation';
import type { MapRegistryId } from '../maps/registry';
import { getMapDefinition } from '../maps/registry';
import { getContinuationTarget } from '../maps/campaign';
import type { BiomeId } from '../configs/biomes';

/** Default number of segments over which width/water blend at a seam. */
export const HANDOFF_BLEND_SEGMENTS = 2;

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface JoinWaypointsResult {
  /** Next-reach waypoints translated so index 0 meets the previous end. */
  joinedWaypoints: THREE.Vector3[];
  /** World-space offset applied to every next waypoint. */
  offset: THREE.Vector3;
  /** Tangent of the previous path end (unit length, or zero if unavailable). */
  prevTangent: THREE.Vector3;
}

export interface WidthBlendStep {
  segmentOffset: number;
  width: number;
  waterWidth: number;
}

export interface HandoffPlan {
  fromMapId: MapRegistryId;
  toMapId: MapRegistryId;
  /** Global treadmill index where the next map's segment 0 begins. */
  nextMapStartIndex: number;
  /** Authored start index inside the next map's level data. */
  toMapLocalStartIndex: number;
  initialBiome: BiomeId;
  widthBlend: WidthBlendStep[];
  waterLevelFrom: number;
  waterLevelTo: number;
  /** Recommended biome crossfade duration (seconds). */
  biomeTransitionSeconds: number;
  preserveSurvival: true;
  preserveScore: true;
  preserveVehicleMotion: true;
}

/**
 * Translate `nextWaypoints` so their first point coincides with `prevEnd`,
 * then nudge the joint for Catmull-Rom tangent continuity.
 */
export function joinWaypoints(
  prevPoints: ReadonlyArray<Vec3Like>,
  nextWaypoints: ReadonlyArray<Vec3Like>,
): JoinWaypointsResult {
  if (nextWaypoints.length === 0) {
    return {
      joinedWaypoints: [],
      offset: new THREE.Vector3(0, 0, 0),
      prevTangent: new THREE.Vector3(0, 0, -1),
    };
  }

  const prevEnd =
    prevPoints.length > 0
      ? toVector3(prevPoints[prevPoints.length - 1])
      : toVector3(nextWaypoints[0]);

  const nextStart = toVector3(nextWaypoints[0]);
  const offset = new THREE.Vector3().subVectors(prevEnd, nextStart);

  const joined = nextWaypoints.map((p) => toVector3(p).add(offset));

  const prevTangent = computeEndTangent(prevPoints);
  if (prevPoints.length >= 2 && joined.length >= 2) {
    ensureTangentContinuity(
      prevPoints.map(toVector3),
      joined,
    );
  }

  return { joinedWaypoints: joined, offset, prevTangent };
}

/**
 * Linear blend schedule from outgoing widths to incoming over `blendCount`
 * segments (inclusive of segmentOffset 0 = first next-map segment).
 */
export function blendWidthsOverSegments(
  fromWidth: number,
  fromWaterWidth: number,
  toWidth: number,
  toWaterWidth: number,
  blendCount: number = HANDOFF_BLEND_SEGMENTS,
): WidthBlendStep[] {
  const steps = Math.max(1, Math.floor(blendCount));
  const result: WidthBlendStep[] = [];
  for (let i = 0; i < steps; i += 1) {
    const t = steps === 1 ? 1 : i / (steps - 1);
    result.push({
      segmentOffset: i,
      width: lerp(fromWidth, toWidth, t),
      waterWidth: lerp(fromWaterWidth, toWaterWidth, t),
    });
  }
  return result;
}

/** Interpolate water surface Y across a handoff seam. */
export function blendWaterLevel(fromY: number, toY: number, t: number): number {
  return lerp(fromY, toY, clamp01(t));
}

/**
 * Build a handoff plan for an authored campaign pair (e.g. hydro → delta).
 * Pure: does not mutate scene state.
 */
export function planMapHandoff(options: {
  fromMapId: MapRegistryId;
  toMapId?: MapRegistryId | null;
  /** Last treadmill segment index that belongs to the outgoing map. */
  lastSegmentIndex: number;
  lastWidth?: number;
  lastWaterWidth?: number;
  lastWaterLevelY?: number;
  blendSegments?: number;
}): HandoffPlan | null {
  const toMapId = options.toMapId ?? getContinuationTarget(options.fromMapId);
  if (!toMapId) return null;

  const fromDef = getMapDefinition(options.fromMapId);
  const toDef = getMapDefinition(toMapId);

  const toLocalStart =
    fromDef.continuation?.mapId === toMapId
      ? (fromDef.continuation.startIndex ?? toDef.startIndex)
      : toDef.startIndex;

  const fromTotal = fromDef.levelData.world.track.totalSegments;
  // Next map starts immediately after the last authored outgoing segment when
  // the outgoing map already wired continuation levelData; otherwise after
  // lastSegmentIndex (journeyComplete fire point).
  const nextMapStartIndex =
    fromDef.continuation?.levelData && fromDef.continuation?.mapId === toMapId
      ? fromTotal
      : options.lastSegmentIndex + 1;

  const lastWidth = options.lastWidth ?? 35;
  const lastWaterWidth = options.lastWaterWidth ?? 10;
  const toCfg = toDef.levelData.segments?.[0];
  const toWidth = typeof toCfg?.width === 'number' ? toCfg.width : lastWidth;
  const toWaterWidth =
    typeof toCfg?.waterWidth === 'number' ? toCfg.waterWidth : lastWaterWidth;

  const waterFrom = options.lastWaterLevelY ?? 0.5;
  // Level JSON has no absolute water Y; preserve outgoing level across the seam
  // unless the caller supplied an explicit target.
  const waterTo = waterFrom;

  return {
    fromMapId: options.fromMapId,
    toMapId,
    nextMapStartIndex,
    toMapLocalStartIndex: toLocalStart,
    initialBiome: toDef.initialBiome,
    widthBlend: blendWidthsOverSegments(
      lastWidth,
      lastWaterWidth,
      toWidth,
      toWaterWidth,
      options.blendSegments ?? HANDOFF_BLEND_SEGMENTS,
    ),
    waterLevelFrom: waterFrom,
    waterLevelTo: waterTo,
    biomeTransitionSeconds: 2,
    preserveSurvival: true,
    preserveScore: true,
    preserveVehicleMotion: true,
  };
}

/**
 * Kickoff payload for biome crossfade at a handoff seam — used by tests and
 * ReachManager / TrackManager to start `BiomeProvider.setBiome` without a snap.
 */
export function planBiomeTransitionKickoff(
  toBiome: BiomeId,
  durationSeconds: number = 2,
): { biomeId: BiomeId; durationSeconds: number; mode: 'crossfade' } {
  return {
    biomeId: toBiome,
    durationSeconds,
    mode: 'crossfade',
  };
}

function toVector3(p: Vec3Like): THREE.Vector3 {
  return p instanceof THREE.Vector3 ? p.clone() : new THREE.Vector3(p.x, p.y, p.z);
}

function computeEndTangent(points: ReadonlyArray<Vec3Like>): THREE.Vector3 {
  if (points.length < 2) return new THREE.Vector3(0, 0, -1);
  const a = toVector3(points[points.length - 2]);
  const b = toVector3(points[points.length - 1]);
  const t = new THREE.Vector3().subVectors(b, a);
  if (!t.lengthSq() || !Number.isFinite(t.x)) return new THREE.Vector3(0, 0, -1);
  return t.normalize();
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp01(t);
}

function clamp01(t: number): number {
  if (!Number.isFinite(t)) return 0;
  return Math.min(1, Math.max(0, t));
}
