/**
 * segmentMeshBuild — a treadmill segment's meshes as plain buffers (#487 Phase B).
 *
 * The canyon floor, its collision hull, the outer wall shell and the water
 * sheet, built from the segment's terrain tile into typed arrays. No three.js:
 * the sim worker runs this on its WASM tile (BUILD_TILE) and posts the arrays
 * back as transferables, and the main thread runs the same code on the TS
 * mirror (boot / restart pools, no sim worker) and wraps the result in
 * BufferGeometry (`geometryBuilders.ts`). The few three.js pieces the builders
 * need are exact ports in `meshMath.ts`, so the output is bit-identical to the
 * three-built geometry this replaced.
 *
 * A `SegmentMeshSpec` is everything the builders read, as structured-clone
 * data: the path as its control points, not a curve object.
 */
import { isAutumnLike, type BiomeId } from '../configs/biomes';
import type { TrackBiomeProfile } from '../configs/TrackBiomes';
import { SHADERS, WALL_WATERLINE_Y, WATER_LEVEL } from '../constants/game';
import type { ChannelProfileSample } from './types';
import {
  buildTerrainTile,
  buildWallShellHeights,
  packChannelProfile,
  sampleChannelShape,
  TerrainProfile,
  type TerrainTile,
  type TerrainTileParams,
  type TubeProfile,
  type WallShellParams,
} from './terrainTile';
import {
  CatmullRomPath,
  computeVertexNormals,
  copyRgb,
  lerpRgb,
  planeGrid,
  rgb,
  scaleRgb,
  type CurveType,
  type Rgb,
  type Vec3,
} from './meshMath';
import { clamp, smoothstep } from '../math/scalar';

/** What the builders need of a path — THREE.CatmullRomCurve3 and meshMath's CatmullRomPath both are one. */
export interface SegmentPath {
  getPoint(t: number): Vec3;
  getLength(): number;
  readonly points: readonly Vec3[];
  readonly closed: boolean;
  readonly curveType: string;
  readonly tension: number;
}

export interface GeometryBuildContext {
  segmentPath: SegmentPath;
  segmentId: number;
  canyonWidth: number;
  waterWidth: number;
  biome: BiomeId | string;
  channelProfile: readonly ChannelProfileSample[];
  isSlotCanyon: boolean;
  isGlacier: boolean;
  /** The two fields the builders read. */
  biomeProfile: Pick<TrackBiomeProfile, 'id' | 'wallHeight'>;
  /**
   * Inward-curving wall profile (ice tube / overflow pipe). Null for open-sky
   * segments, which is every biome that is not glacial melt or a hydro pipe.
   */
  tubeProfile?: TubeProfile | null;
  /** Who builds the tile planes: the TS mirror by default, the WASM module in the sim worker. */
  terrain?: TerrainBuilders;
}

/** The tile builders, TS mirror or native (`buildTerrainTileNative` / `buildWallShellHeightsNative`). */
export interface TerrainBuilders {
  tile(params: TerrainTileParams): TerrainTile | null;
  wallShell(params: WallShellParams): Float32Array | null;
}

/** The TS mirror (terrainTile.ts). */
export const MIRROR_TERRAIN: TerrainBuilders = {
  tile: buildTerrainTile,
  wallShell: buildWallShellHeights,
};

/** One mesh's arrays: what a BufferGeometry holds. */
export interface GeometryBuffers {
  attributes: Record<string, { array: Float32Array; itemSize: number }>;
  index: Uint16Array | Uint32Array | null;
}

/** A segment's four meshes and its SWE bed grid; null where the builder rejected its input. */
export interface SegmentMeshBuffers {
  canyon: GeometryBuffers | null;
  collision: GeometryBuffers | null;
  wallShell: GeometryBuffers | null;
  water: GeometryBuffers | null;
  /** The hull's grid: the SWE bed reads the same triangles Rapier collides with (#487 C). */
  bed: SegmentBedGrid | null;
}

// ---------------------------------------------------------------------------
// Grid densities
// ---------------------------------------------------------------------------

/** Visual canyon floor width subdivisions (PlaneGeometry segmentsX). */
export const CANYON_VISUAL_SEGMENTS_X = 40;

/**
 * Collision mesh uses ~1/4 the visual XZ density so Rapier solves a much
 * smaller trimesh while preserving the same U-profile for grounding / wall-ride.
 */
export const CANYON_COLLISION_SUBDIVISION_DIVISOR = 4;

export function canyonSubdivisionCounts(
  pathLen: number,
  kind: 'visual' | 'collision'
): { segmentsX: number; segmentsZ: number } {
  if (kind === 'visual') {
    return {
      segmentsX: CANYON_VISUAL_SEGMENTS_X,
      segmentsZ: Math.max(2, Math.floor(pathLen)),
    };
  }
  return {
    segmentsX: Math.max(4, Math.floor(CANYON_VISUAL_SEGMENTS_X / CANYON_COLLISION_SUBDIVISION_DIVISOR)),
    segmentsZ: Math.max(2, Math.floor(pathLen / CANYON_COLLISION_SUBDIVISION_DIVISOR)),
  };
}

/**
 * The segment's floor tile at one grid density (#487). The visual mesh and the
 * hull ask for the same profile; only the grid and the rock noise differ.
 */
export function buildCanyonTile(
  ctx: GeometryBuildContext,
  pathLength: number,
  kind: 'visual' | 'collision'
): TerrainTile | null {
  const { segmentsX, segmentsZ } = canyonSubdivisionCounts(pathLength, kind);
  return (ctx.terrain ?? MIRROR_TERRAIN).tile({
    pathLength,
    canyonWidth: ctx.canyonWidth,
    waterWidth: ctx.waterWidth,
    segmentsX,
    segmentsZ,
    profile: ctx.isSlotCanyon ? TerrainProfile.SLOT : TerrainProfile.OPEN,
    rockNoise: kind === 'visual',
    tube: ctx.tubeProfile ?? null,
    channel: packChannelProfile(ctx.channelProfile),
  });
}

// ---------------------------------------------------------------------------
// Shared vertex plumbing
// ---------------------------------------------------------------------------

const ORIGIN: Vec3 = { x: 0, y: 0, z: 0 };

function safePathPoint(segmentPath: SegmentPath, t: number, segmentId: number): Vec3 {
  try {
    const point = segmentPath.getPoint(t);
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)) {
      console.warn(`[TrackSegment ${segmentId}] NaN in path point at t=${t}`);
      return { ...ORIGIN };
    }
    return point;
  } catch (e) {
    console.warn(`[TrackSegment ${segmentId}] Error getting path point:`, e);
    return { ...ORIGIN };
  }
}

/**
 * Path point per grid row (row iz sits at t = iz / segmentsZ): every vertex of
 * a row shares it, so the curve is evaluated once per row, not once per vertex.
 */
function rowPathPoints(segmentPath: SegmentPath, segmentsZ: number, segmentId: number): Vec3[] {
  return Array.from({ length: segmentsZ + 1 }, (_, iz) => safePathPoint(segmentPath, iz / segmentsZ, segmentId));
}

/** Write path point + local tile offset into a vertex, or the fallback when non-finite. */
function setTileVertex(positions: Float32Array, i: number, point: Vec3, x: number, y: number, fallbackY = 0): void {
  const finalX = point.x + x;
  const finalY = point.y + y;
  const finalZ = point.z;
  const o = i * 3;
  if (Number.isFinite(finalX) && Number.isFinite(finalY) && Number.isFinite(finalZ)) {
    positions[o] = finalX;
    positions[o + 1] = finalY;
    positions[o + 2] = finalZ;
  } else {
    positions[o] = 0;
    positions[o + 1] = fallbackY;
    positions[o + 2] = 0;
  }
}

/** Zero any non-finite position; true when there was one (normals are then left as built). */
function sanitizePositions(positions: Float32Array): boolean {
  let hasNaN = false;
  for (let i = 0; i < positions.length; i++) {
    if (!Number.isFinite(positions[i])) {
      hasNaN = true;
      positions[i] = 0;
    }
  }
  return hasNaN;
}

function validLength(ctx: GeometryBuildContext, what: string): number | null {
  const len = ctx.segmentPath.getLength();
  if (!len || len <= 0 || !Number.isFinite(len)) {
    console.warn(`[TrackSegment ${ctx.segmentId}] Invalid pathLength${what}: ${len}`);
    return null;
  }
  return len;
}

// ---------------------------------------------------------------------------
// Canyon floor
// ---------------------------------------------------------------------------

interface FloorPalette {
  dry: Rgb;
  wet: Rgb;
  shore: Rgb;
  moss: Rgb;
  bank: Rgb;
}

function floorPalette(biome: BiomeId | string, isSlotCanyon: boolean, isGlacier: boolean): FloorPalette {
  const isHydro = biome === 'hydroDam';
  // Wet basalt with cave algae at the waterline — not ice, not canyon sandstone.
  const isCavern = biome === 'cavern';
  const autumn = isAutumnLike(biome);
  const pick = (cavern: string, slot: string, glacier: string, hydro: string, autumnHex: string, summer: string) =>
    rgb(isCavern ? cavern : isSlotCanyon ? slot : isGlacier ? glacier : isHydro ? hydro : autumn ? autumnHex : summer);
  return {
    dry: pick('#5a6068', SHADERS.SLOT_ROCK_RIM, '#c8dce8', '#9aa0a6', '#b89868', '#9a8e78'),
    wet: pick('#1c2226', SHADERS.SLOT_ROCK_SHADOW, '#2a4858', '#2e3236', '#4a3828', '#3e5038'),
    shore: pick('#3a4248', SHADERS.SLOT_ROCK_BASE, '#6a9ab0', '#6a6e72', '#685840', '#4a5c44'),
    moss: pick('#3e5a52', '#7c4a2d', '#4a7888', '#4a5054', '#7a6640', '#587248'),
    bank: pick('#4c545a', '#bf7444', '#a0b8c8', '#7a8088', '#907850', '#788860'),
  };
}

/** The visible canyon floor: the visual tile, vertex-coloured by height above the water. */
export function buildCanyonBuffers(ctx: GeometryBuildContext): GeometryBuffers | null {
  const { segmentPath, segmentId, canyonWidth, waterWidth, biome, channelProfile, isSlotCanyon, isGlacier } = ctx;
  const len = validLength(ctx, '');
  if (len === null) return null;

  const tile = buildCanyonTile(ctx, len, 'visual');
  if (!tile) {
    console.warn(`[TrackSegment ${segmentId}] Invalid canyon tile (width ${canyonWidth})`);
    return null;
  }
  const { segmentsX, segmentsZ } = tile;
  const rowPoints = rowPathPoints(segmentPath, segmentsZ, segmentId);
  const rowFloorDepth = rowPoints.map((_, iz) => sampleChannelShape(channelProfile, waterWidth, iz / segmentsZ).floorDepth);

  const grid = planeGrid(canyonWidth, len, segmentsX, segmentsZ);
  const { positions, count } = grid;
  const colors = new Float32Array(count * 3);
  const color: Rgb = { r: 1, g: 1, b: 1 };
  const palette = floorPalette(biome, isSlotCanyon, isGlacier);

  for (let i = 0; i < count; i++) {
    const xLocal = positions[i * 3];
    const zLocal = positions[i * 3 + 2];
    const row = Math.floor(i / (segmentsX + 1));
    // The tile is already folded, so the crown is tinted by the height it ends
    // up at rather than the open-canyon wall height it would have had.
    const yHeight = tile.h[i];

    const depthTint = clamp(-rowFloorDepth[row] * 0.25, 0, 0.2);
    const dryness = Math.min(1.0, Math.max(0.0, (yHeight - 0.2 + depthTint) / 2.5));
    if (dryness < 0.2) {
      lerpRgb(copyRgb(color, palette.wet), palette.shore, dryness / 0.2);
    } else if (dryness < 0.42) {
      lerpRgb(copyRgb(color, palette.shore), palette.moss, (dryness - 0.2) / 0.22);
    } else if (dryness < 0.65) {
      lerpRgb(copyRgb(color, palette.moss), palette.bank, (dryness - 0.42) / 0.23);
    } else {
      lerpRgb(copyRgb(color, palette.bank), palette.dry, (dryness - 0.65) / 0.35);
    }
    const noiseVar =
      (Math.sin(zLocal * 1.3 + xLocal * 0.9) * 0.5 + 0.5) * 0.1 +
      (Math.sin(zLocal * 3.1 + xLocal * 2.3) * 0.5 + 0.5) * 0.04;
    const intensity = 0.72 + 0.2 * dryness + noiseVar;
    scaleRgb(color, intensity);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;

    setTileVertex(positions, i, rowPoints[row], tile.x[i], yHeight);
  }

  if (!sanitizePositions(positions)) computeVertexNormals(positions, grid.index, grid.normals);
  return {
    attributes: {
      position: { array: positions, itemSize: 3 },
      normal: { array: grid.normals, itemSize: 3 },
      uv: { array: grid.uvs, itemSize: 2 },
      color: { array: colors, itemSize: 3 },
    },
    index: grid.index,
  };
}

// ---------------------------------------------------------------------------
// Collision hull
// ---------------------------------------------------------------------------

/**
 * The hull's grid as data: what the Rapier trimesh is built from and what the
 * SWE bed reads (#487 C, `bathymetrySampler.ts`), so the two cannot disagree.
 */
export interface SegmentBedGrid {
  segmentsX: number;
  segmentsZ: number;
  /** Grid extent across (the canyon width); column ix sits at ix · width / segmentsX − width / 2. */
  width: number;
  /** Floor height above the row's path point per vertex: the hull tile's H plane (no rock noise, folded). */
  h: Float32Array;
  /** Path point per row, x | y | z: the points the hull's vertices hang from. */
  rows: Float32Array;
}

interface HullTile {
  tile: TerrainTile;
  rowPoints: Vec3[];
  len: number;
}

function hullTile(ctx: GeometryBuildContext): HullTile | null {
  const { segmentPath, segmentId, canyonWidth } = ctx;
  const len = validLength(ctx, ' for collision');
  if (len === null) return null;
  // Same tile as the visual mesh at the hull's grid, folded the same way —
  // the hull must ride the tube it can see.
  const tile = buildCanyonTile(ctx, len, 'collision');
  if (!tile) {
    console.warn(`[TrackSegment ${segmentId}] Invalid collision tile (width ${canyonWidth})`);
    return null;
  }
  return { tile, rowPoints: rowPathPoints(segmentPath, tile.segmentsZ, segmentId), len };
}

function collisionFromHull(ctx: GeometryBuildContext, hull: HullTile): GeometryBuffers {
  const { tile, rowPoints, len } = hull;
  const { segmentsX, segmentsZ } = tile;
  const grid = planeGrid(ctx.canyonWidth, len, segmentsX, segmentsZ);
  const { positions, count } = grid;

  for (let i = 0; i < count; i++) {
    setTileVertex(positions, i, rowPoints[Math.floor(i / (segmentsX + 1))], tile.x[i], tile.h[i]);
  }

  // No uv: the mesh is invisible and Rapier only needs positions + indices.
  const attributes: GeometryBuffers['attributes'] = { position: { array: positions, itemSize: 3 } };
  if (!sanitizePositions(positions)) {
    const normals = new Float32Array(count * 3);
    computeVertexNormals(positions, grid.index, normals);
    attributes.normal = { array: normals, itemSize: 3 };
  }
  return { attributes, index: grid.index };
}

function bedFromHull(ctx: GeometryBuildContext, hull: HullTile): SegmentBedGrid {
  const { tile, rowPoints } = hull;
  const rows = new Float32Array(rowPoints.length * 3);
  rowPoints.forEach((p, i) => {
    rows[i * 3] = p.x;
    rows[i * 3 + 1] = p.y;
    rows[i * 3 + 2] = p.z;
  });
  return { segmentsX: tile.segmentsX, segmentsZ: tile.segmentsZ, width: ctx.canyonWidth, h: tile.h.slice(), rows };
}

/**
 * Low-poly collision-only canyon mesh (same U-profile, ~1/4 XZ density, no
 * vertex colours / decorative rock noise). Mounted invisible under a fixed
 * trimesh RigidBody so the visual mesh owns no Rapier collider.
 */
export function buildCollisionBuffers(ctx: GeometryBuildContext): GeometryBuffers | null {
  const hull = hullTile(ctx);
  return hull ? collisionFromHull(ctx, hull) : null;
}

/** The SWE bed grid alone (tests; the treadmill gets it from `buildSegmentMeshBuffers`). */
export function buildBedGrid(ctx: GeometryBuildContext): SegmentBedGrid | null {
  const hull = hullTile(ctx);
  return hull ? bedFromHull(ctx, hull) : null;
}

// ---------------------------------------------------------------------------
// Outer wall shell
// ---------------------------------------------------------------------------

/** The outer canyon walls, strata-coloured, with moss / high-water masks and a triplanar-ish uv2. */
export function buildWallShellBuffers(ctx: GeometryBuildContext): GeometryBuffers | null {
  const { segmentPath, segmentId, canyonWidth, biomeProfile, isSlotCanyon, isGlacier } = ctx;
  const len = validLength(ctx, ' for wall');
  if (len === null) return null;

  const shellWidth = isSlotCanyon ? canyonWidth * 0.92 : canyonWidth * 1.5;
  const segmentsX = 24;
  const segmentsZ = Math.max(2, Math.floor(len / 2));
  const shellHeights = (ctx.terrain ?? MIRROR_TERRAIN).wallShell({
    pathLength: len,
    shellWidth,
    segmentsX,
    segmentsZ,
    profile: isSlotCanyon ? TerrainProfile.SLOT : TerrainProfile.OPEN,
    wallHeight: biomeProfile.wallHeight,
    segmentId,
  });
  if (!shellHeights) {
    console.warn(`[TrackSegment ${segmentId}] Invalid wall shell (width ${shellWidth})`);
    return null;
  }
  const rowPoints = rowPathPoints(segmentPath, segmentsZ, segmentId);

  const grid = planeGrid(shellWidth, len, segmentsX, segmentsZ);
  const { positions, count } = grid;
  const colors = new Float32Array(count * 3);
  const mossMask = new Float32Array(count);
  const highWaterMask = new Float32Array(count);

  const bandPalette = biomeProfile.id === 'cavern'
    ? { waterline: rgb('#101519'), lower: rgb('#262e34'), mid: rgb('#3a444c'), upper: rgb('#4e5860'), rim: rgb('#6a747c') }
    : isSlotCanyon
    ? { waterline: rgb('#2f1a12'), lower: rgb('#7e4123'), mid: rgb('#a95a32'), upper: rgb('#cc8353'), rim: rgb('#d2b08d') }
    : isGlacier
      ? { waterline: rgb('#1a2830'), lower: rgb('#3a5868'), mid: rgb('#607888'), upper: rgb('#8aaabb'), rim: rgb('#d0e8f0') }
      : { waterline: rgb('#24170f'), lower: rgb('#5c3721'), mid: rgb('#87614b'), upper: rgb('#ae9173'), rim: rgb('#c8baa0') };
  const rimGrey = rgb('#9a948b');
  const c: Rgb = { r: 1, g: 1, b: 1 };

  for (let i = 0; i < count; i++) {
    const xLocal = positions[i * 3];
    const zLocal = positions[i * 3 + 2];

    // Wall height above the path point: emscripten/terrain.cpp buildWallShell (#487).
    const localY = shellHeights[i];
    const strataWarp =
      Math.sin(zLocal * 0.14 + xLocal * 0.06 + segmentId * 0.17) * (isSlotCanyon ? 1.6 : 1.1) +
      Math.cos(zLocal * 0.22 - xLocal * 0.09) * (isSlotCanyon ? 0.8 : 0.55);

    const relY = localY - WALL_WATERLINE_Y;
    const warpedRelY = relY + strataWarp;

    if (warpedRelY < 0.5) {
      const blend = smoothstep(warpedRelY, -0.5, 0.5);
      lerpRgb(copyRgb(c, bandPalette.waterline), bandPalette.lower, blend);
    } else if (warpedRelY < 4.0) {
      const blend = smoothstep(warpedRelY, 0.5, 4.0);
      lerpRgb(copyRgb(c, bandPalette.lower), bandPalette.mid, blend);
    } else if (warpedRelY < 12.0) {
      const blend = smoothstep(warpedRelY, 4.0, 12.0);
      lerpRgb(copyRgb(c, bandPalette.mid), bandPalette.upper, blend * 0.25);
    } else if (warpedRelY < 18.0) {
      const blend = smoothstep(warpedRelY, 12.0, 18.0);
      lerpRgb(copyRgb(c, bandPalette.mid), bandPalette.upper, blend);
    } else if (warpedRelY < 26.0) {
      const blend = smoothstep(warpedRelY, 18.0, 26.0);
      const rimTint = lerpRgb({ ...bandPalette.rim }, rimGrey, 0.3 + blend * 0.25);
      lerpRgb(copyRgb(c, bandPalette.upper), rimTint, blend);
    } else {
      lerpRgb(copyRgb(c, bandPalette.rim), rimGrey, 0.55);
    }

    const noise1 = Math.sin(zLocal * 0.5 + xLocal * 0.3) * 0.5 + 0.5;
    const noise2 = Math.sin(zLocal * 1.2 + xLocal * 0.8) * 0.5 + 0.5;
    const seedNoise = Math.sin(zLocal * 0.77 + segmentId * 0.31) * 0.5 + 0.5;
    const detailNoise = noise1 * 0.08 + noise2 * 0.04 + seedNoise * 0.05;
    const verticalFade = clamp((warpedRelY + 2.0) / 24.0, 0, 1);
    scaleRgb(c, 0.78 + detailNoise + verticalFade * 0.18);

    const bandNoise = Math.sin(zLocal * 0.3 + xLocal * 0.5) * 0.5 + 0.5;
    const bandNoise2 = Math.cos(zLocal * 0.7 - xLocal * 0.4) * 0.5 + 0.5;
    const normalizedWallHeight = isSlotCanyon ? 22 : 15;
    const heightAboveWater = Math.max(0, Math.min(1, relY / normalizedWallHeight));
    const mossBand = Math.max(0, 1.0 - Math.abs(heightAboveWater - 0.08) / 0.13) * bandNoise;
    const lichenBand = Math.max(0, 1.0 - Math.abs(heightAboveWater - 0.24) / 0.11) * bandNoise2;
    const floodMarkBand =
      Math.max(0, 1.0 - Math.abs(heightAboveWater - 0.38) / 0.06) * (0.7 + bandNoise * 0.3);

    mossMask[i] = Math.max(mossBand, lichenBand * 0.7);
    highWaterMask[i] = floodMarkBand;

    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;

    setTileVertex(positions, i, rowPoints[Math.floor(i / (segmentsX + 1))], xLocal, localY, 10);
  }

  const uv2 = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const wx = positions[i * 3];
    const wy = positions[i * 3 + 1];
    const wz = positions[i * 3 + 2];
    const scale = 0.07;
    const triplanarBlend = Math.abs(wy - WALL_WATERLINE_Y) / 12;
    const u1 = wx * scale;
    const v1 = wz * scale * 0.42;
    const u2 = (wx + wz) * scale * 0.65 + Math.sin(wy * 0.06) * 0.12;
    const v2 = wy * scale * 0.28 + Math.cos((wx - wz) * 0.04) * 0.08;
    const blend = Math.min(1, Math.max(0, triplanarBlend));
    uv2[i * 2] = u1 * (1 - blend) + u2 * blend;
    uv2[i * 2 + 1] = v1 * (1 - blend) + v2 * blend;
  }

  if (!sanitizePositions(positions)) computeVertexNormals(positions, grid.index, grid.normals);
  return {
    attributes: {
      position: { array: positions, itemSize: 3 },
      normal: { array: grid.normals, itemSize: 3 },
      uv: { array: grid.uvs, itemSize: 2 },
      color: { array: colors, itemSize: 3 },
      mossMask: { array: mossMask, itemSize: 1 },
      highWaterMask: { array: highWaterMask, itemSize: 1 },
      uv2: { array: uv2, itemSize: 2 },
    },
    index: grid.index,
  };
}

// ---------------------------------------------------------------------------
// Water sheet
// ---------------------------------------------------------------------------

/** The water surface, shaped across by the channel profile. */
export function buildWaterBuffers(ctx: GeometryBuildContext): GeometryBuffers | null {
  const { segmentPath, segmentId, waterWidth, channelProfile } = ctx;
  const waterLevel = WATER_LEVEL;
  const len = validLength(ctx, ' for water');
  if (len === null) return null;

  const segmentsZ = Math.max(2, Math.floor(len / 2));
  const basePlaneWidth = waterWidth * 1.45;
  const grid = planeGrid(basePlaneWidth, len, 8, segmentsZ);
  const { positions, count } = grid;

  for (let i = 0; i < count; i++) {
    const x = positions[i * 3];
    const z = positions[i * 3 + 2];
    const t = (z + len / 2) / len;
    const safeT = Math.max(0, Math.min(1, t));
    const channelShape = sampleChannelShape(channelProfile, waterWidth, safeT);
    const xNormalized = clamp(x / (basePlaneWidth * 0.5), -1, 1);
    const shapedX =
      xNormalized < 0 ? xNormalized * channelShape.leftHalfWidth : xNormalized * channelShape.rightHalfWidth;

    const point = safePathPoint(segmentPath, safeT, segmentId);
    const finalX = point.x + shapedX;
    const finalY = point.y + waterLevel;
    const finalZ = point.z;

    const o = i * 3;
    if (Number.isFinite(finalX) && Number.isFinite(finalY) && Number.isFinite(finalZ)) {
      positions[o] = finalX;
      positions[o + 1] = finalY;
      positions[o + 2] = finalZ;
    } else {
      positions[o] = 0;
      positions[o + 1] = waterLevel;
      positions[o + 2] = 0;
    }
  }

  if (!sanitizePositions(positions)) computeVertexNormals(positions, grid.index, grid.normals);
  return {
    attributes: {
      position: { array: positions, itemSize: 3 },
      normal: { array: grid.normals, itemSize: 3 },
      uv: { array: grid.uvs, itemSize: 2 },
    },
    index: grid.index,
  };
}

/** Build all four meshes of a segment and its bed grid; the hull tile is built once for both. */
export function buildSegmentMeshBuffers(ctx: GeometryBuildContext): SegmentMeshBuffers {
  const hull = hullTile(ctx);
  return {
    canyon: buildCanyonBuffers(ctx),
    collision: hull ? collisionFromHull(ctx, hull) : null,
    wallShell: buildWallShellBuffers(ctx),
    water: buildWaterBuffers(ctx),
    bed: hull ? bedFromHull(ctx, hull) : null,
  };
}

/** Every array buffer in `meshes` (bed included), once, for postMessage's transfer list. */
export function segmentMeshTransferables(meshes: SegmentMeshBuffers): ArrayBuffer[] {
  const out = new Set<ArrayBuffer>();
  for (const mesh of [meshes.canyon, meshes.collision, meshes.wallShell, meshes.water]) {
    if (!mesh) continue;
    for (const { array } of Object.values(mesh.attributes)) out.add(array.buffer as ArrayBuffer);
    if (mesh.index) out.add(mesh.index.buffer as ArrayBuffer);
  }
  if (meshes.bed) {
    out.add(meshes.bed.h.buffer as ArrayBuffer);
    out.add(meshes.bed.rows.buffer as ArrayBuffer);
  }
  return [...out];
}

// ---------------------------------------------------------------------------
// The spec that crosses to the sim worker
// ---------------------------------------------------------------------------

/** A CatmullRom curve as data. */
export interface SegmentPathSpec {
  /** x, y, z per control point. */
  points: number[];
  closed: boolean;
  curveType: CurveType;
  tension: number;
}

/** Everything the segment builders read (GeometryBuildContext minus the curve object and the tile builders). */
export interface SegmentMeshSpec {
  segmentId: number;
  path: SegmentPathSpec;
  canyonWidth: number;
  waterWidth: number;
  biome: string;
  channelProfile: ChannelProfileSample[];
  isSlotCanyon: boolean;
  isGlacier: boolean;
  biomeProfile: Pick<TrackBiomeProfile, 'id' | 'wallHeight'>;
  tubeProfile: TubeProfile | null;
}

export function segmentPathSpec(curve: SegmentPath): SegmentPathSpec {
  return {
    points: curve.points.flatMap((p) => [p.x, p.y, p.z]),
    closed: curve.closed,
    curveType: curve.curveType as CurveType,
    tension: curve.tension,
  };
}

export function curveFromSpec(spec: SegmentPathSpec): CatmullRomPath {
  const points: Vec3[] = [];
  for (let i = 0; i + 2 < spec.points.length; i += 3) {
    points.push({ x: spec.points[i], y: spec.points[i + 1], z: spec.points[i + 2] });
  }
  return new CatmullRomPath(points, spec.closed, spec.curveType, spec.tension);
}

export function segmentMeshSpec(ctx: GeometryBuildContext): SegmentMeshSpec {
  return {
    segmentId: ctx.segmentId,
    path: segmentPathSpec(ctx.segmentPath),
    canyonWidth: ctx.canyonWidth,
    waterWidth: ctx.waterWidth,
    biome: String(ctx.biome),
    // Plain objects: the samples are already data, this just drops readonly.
    channelProfile: ctx.channelProfile.map((sample) => ({ ...sample })),
    isSlotCanyon: ctx.isSlotCanyon,
    isGlacier: ctx.isGlacier,
    biomeProfile: { id: ctx.biomeProfile.id, wallHeight: ctx.biomeProfile.wallHeight },
    tubeProfile: ctx.tubeProfile ? { ...ctx.tubeProfile } : null,
  };
}

export function contextFromSpec(spec: SegmentMeshSpec, terrain?: TerrainBuilders): GeometryBuildContext {
  return {
    segmentPath: curveFromSpec(spec.path),
    segmentId: spec.segmentId,
    canyonWidth: spec.canyonWidth,
    waterWidth: spec.waterWidth,
    biome: spec.biome,
    channelProfile: spec.channelProfile,
    isSlotCanyon: spec.isSlotCanyon,
    isGlacier: spec.isGlacier,
    biomeProfile: spec.biomeProfile,
    tubeProfile: spec.tubeProfile,
    terrain,
  };
}
