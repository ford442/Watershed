import * as THREE from 'three';
import type { BiomeId } from '../../../configs/biomes';
import { WATER_LEVEL } from '../../../constants/game';
import { hasFiniteCoordinates } from '../utils';
import type { PlungeImpactPlacement, SegmentKind } from '../types';
import type { TubeProfile } from '../../../terrain/terrainTile';
import {
  buildCanyonBuffers,
  buildCollisionBuffers,
  buildWallShellBuffers,
  buildWaterBuffers,
  type GeometryBuffers,
  type GeometryBuildContext,
} from '../../../terrain/segmentMeshBuild';

// The profile lives in src/terrain/terrainTile.ts (the TS mirror of
// emscripten/terrain.cpp, #487) and the mesh builders in
// src/terrain/segmentMeshBuild.ts (three-free, shared with the sim worker);
// these names stay importable from here.
export { applyTubeProfile, type TubeProfile } from '../../../terrain/terrainTile';
export {
  buildCanyonTile,
  canyonSubdivisionCounts,
  CANYON_COLLISION_SUBDIVISION_DIVISOR,
  CANYON_VISUAL_SEGMENTS_X,
  MIRROR_TERRAIN,
  type GeometryBuildContext,
  type TerrainBuilders,
} from '../../../terrain/segmentMeshBuild';

/** Glacial melt: a near-closed ice tube with a slot of sky at the crown. */
export const ICE_TUBE_PROFILE: TubeProfile = { curl: 0.88, ceilingHeight: 9.5 };

/** Hydro-Dam overflow pipe: a wider concrete corridor you can still see out of. */
export const OVERFLOW_PIPE_PROFILE: TubeProfile = { curl: 0.72, ceilingHeight: 8 };

/**
 * Cavern (#464): a closed rock vault, lower than the ice tube and with no slot
 * of sky — the ice cave the glacial source runs out of before the tube opens.
 */
export const CAVERN_PROFILE: TubeProfile = { curl: 0.97, ceilingHeight: 8.5 };

/**
 * Widest canyon that still reads as an enclosed tube.
 *
 * The glacial map is not a tube end to end — it runs ice cave → tube apex →
 * melt widening → alpine fringe, and the authored `width` is what says which is
 * which (21–26 through the tube, 32–35 once it opens out). Roofing the melt-out
 * would throw away the one moment the source biome breathes.
 */
export const TUBE_MAX_CANYON_WIDTH = 29;

/**
 * Which segments get a tube. Kept next to the profiles so authoring one place
 * cannot drift from the geometry that reads it.
 */
export function resolveTubeProfile(opts: {
  isGlacier: boolean;
  biome: BiomeId | string;
  type?: string;
  canyonWidth: number;
}): TubeProfile | null {
  if (!Number.isFinite(opts.canyonWidth) || opts.canyonWidth > TUBE_MAX_CANYON_WIDTH) {
    return null;
  }
  if (opts.biome === 'cavern') return CAVERN_PROFILE;
  if (opts.isGlacier) return ICE_TUBE_PROFILE;
  // The overflow pipe is authored as a `waterfall` on the hydro map; the type
  // alone is not enough, or every plunge in the game would grow a roof.
  if (opts.biome === 'hydroDam' && opts.type === 'waterfall') return OVERFLOW_PIPE_PROFILE;
  return null;
}

/** Wrap mesh buffers (segmentMeshBuild.ts, here or from the sim worker) in a BufferGeometry, without copying. */
export function geometryFromBuffers(buffers: GeometryBuffers | null): THREE.BufferGeometry | null {
  if (!buffers) return null;
  const geometry = new THREE.BufferGeometry();
  if (buffers.index) geometry.setIndex(new THREE.BufferAttribute(buffers.index, 1));
  for (const [name, { array, itemSize }] of Object.entries(buffers.attributes)) {
    geometry.setAttribute(name, new THREE.BufferAttribute(array, itemSize));
  }
  return geometry;
}

/** Canyon floor BufferGeometry for a segment path; null when the path or tile is invalid. */
export function buildCanyonGeometry(ctx: GeometryBuildContext): THREE.BufferGeometry | null {
  return geometryFromBuffers(buildCanyonBuffers(ctx));
}

/**
 * Low-poly collision-only canyon mesh (same U-profile, ~1/4 XZ density, no
 * vertex colors / decorative rock noise). Mounted invisible under a fixed
 * trimesh RigidBody so the visual mesh no longer owns Rapier colliders.
 */
export function buildCollisionGeometry(ctx: GeometryBuildContext): THREE.BufferGeometry | null {
  return geometryFromBuffers(buildCollisionBuffers(ctx));
}

/** Wall-shell BufferGeometry (outer canyon walls) for a segment path. */
export function buildWallShellGeometry(ctx: GeometryBuildContext): THREE.BufferGeometry | null {
  return geometryFromBuffers(buildWallShellBuffers(ctx));
}

/** Water-surface BufferGeometry shaped by the channel profile. */
export function buildWaterGeometry(ctx: GeometryBuildContext): THREE.BufferGeometry | null {
  return geometryFromBuffers(buildWaterBuffers(ctx));
}

export function computeWaterfallPos(
  segmentPath: THREE.CatmullRomCurve3,
  type: SegmentKind | string,
  segmentId: number
): THREE.Vector3 | null {
  if (type !== 'waterfall') return null;
  try {
    const point = segmentPath.getPoint(0.5);
    return hasFiniteCoordinates(point) ? point : null;
  } catch (error) {
    console.warn(`[TrackSegment ${segmentId}] Failed to compute waterfall position`, error);
    return null;
  }
}

export function computePlungeImpactPlacement(
  segmentPath: THREE.CatmullRomCurve3,
  type: SegmentKind | string,
  waterfallPos: THREE.Vector3 | null,
  waterWidth: number,
  segmentId: number
): PlungeImpactPlacement | null {
  const waterLevel = WATER_LEVEL;
  try {
    if (type === 'waterfall' && waterfallPos) {
      return {
        position: waterfallPos.clone().add(new THREE.Vector3(0, -10.0, 0)),
        intensity: 1.0,
        width: Math.max(6, waterWidth * 0.95),
      };
    }

    if (type === 'splash') {
      const point = segmentPath.getPoint(0.16);
      if (!hasFiniteCoordinates(point)) return null;
      point.y = waterLevel + 0.05;
      return {
        position: point,
        intensity: 0.72,
        width: Math.max(7, waterWidth * 1.1),
      };
    }
  } catch (error) {
    console.warn(`[TrackSegment ${segmentId}] Failed to compute plunge impact placement`, error);
  }
  return null;
}

/** Assert buffer attribute values contain no NaN/Infinity. */
export function geometryHasFinitePositions(geometry: THREE.BufferGeometry): boolean {
  const positions = geometry.attributes.position;
  if (!positions || positions.count <= 0) return false;
  const arr = positions.array;
  for (let i = 0; i < arr.length; i++) {
    if (!Number.isFinite(arr[i])) return false;
  }
  return true;
}
