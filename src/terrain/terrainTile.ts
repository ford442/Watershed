/**
 * terrainTile — one canyon source (#487): a segment's floor as a tile of planes.
 *
 * Path length, widths, the channel profile and the tube profile in; SoA planes
 * out, at whatever grid the caller asks for. The visual floor, the Rapier hull
 * and the SWE bed all read this tile (the hull and bed at a coarser grid or
 * without rock noise); none re-derives the formula. The main thread and the
 * sim worker (BUILD_TILE) run this same module, so they build the same floats.
 * (A C++ twin, emscripten/terrain.cpp, ran in the worker from ABI 13 to 15. It
 * saved ~0.4 ms per segment off the main thread and cost three-way parity
 * upkeep, so it was retired at ABI 16 — WASM.md, "Terrain tiles".)
 *
 * Grid convention — three's PlaneGeometry(canyonWidth, pathLength, segmentsX,
 * segmentsZ) after rotateX(−π/2), so the builders keep their index buffers:
 *
 *     vertex i = iz * (segmentsX + 1) + ix
 *     x = ix · canyonWidth / segmentsX − canyonWidth / 2      (local, across)
 *     z = iz · pathLength / segmentsZ − pathLength / 2        (local, along)
 *     t = iz / segmentsZ                                      (path parameter)
 *
 * Planes (TERRAIN_TILE_PLANES floats per vertex, plane-major — TerrainPlane):
 *   X       local x after the tube fold (== grid x on open-sky segments)
 *   H       local floor height above the path point (the builders' `yHeight`)
 *   BANK    1 where the vertex is outside the wetted channel (|x| ≥ bank half-width), else 0
 *   SLOPE_X ∂H/∂x on the unfolded grid (central differences, one-sided at the edges)
 *   SLOPE_Z ∂H/∂z, same stencil
 *   UV_U    across-channel coordinate in [0, 1] (ix / segmentsX)
 *   UV_V    metres downstream from the segment start (t · pathLength)
 *
 * The channel profile crosses as float32 (`packChannelProfile`),
 * TERRAIN_CHANNEL_STRIDE floats per sample in ChannelProfileSample's field
 * order minus t / worldArc (the samples are evenly spaced in t):
 *   [leftHalfWidth, rightHalfWidth, corridorHalfWidth, floorDepth, floorWave,
 *    riffleStrength, gravelBarSide (±1), undercutSide (±1), flowScale]
 *
 * Arithmetic is float64 and rounds once into the Float32 planes.
 */

import type { ChannelProfileSample, ChannelShape } from './types';
import { clamp01, lerp, smoothstep } from '../math/scalar';

/** Floats per packed channel sample. */
export const TERRAIN_CHANNEL_STRIDE = 9;

/** Planes per tile. */
export const TERRAIN_TILE_PLANES = 7;

/** Plane order (see the header). */
export const TerrainPlane = {
  X: 0,
  H: 1,
  BANK: 2,
  SLOPE_X: 3,
  SLOPE_Z: 4,
  UV_U: 5,
  UV_V: 6,
} as const;

/** Cross-section family. */
export const TerrainProfile = {
  OPEN: 0,
  SLOT: 1,
} as const;
export type TerrainProfileId = (typeof TerrainProfile)[keyof typeof TerrainProfile];

/**
 * #487 C: the slot profile is lowered by
 * its in-channel constant so its thalweg sits at the same datum as every other
 * biome, at or below the water sheet. Floor and wall shell move together.
 */
export const TERRAIN_SLOT_FLOOR_LIFT = 22.0 * 0.18;

/** Largest grid a builder accepts: more segments per axis, or more vertices, is rejected (null). */
export const TERRAIN_MAX_SEGMENTS = 4096;
export const TERRAIN_MAX_VERTICES = 1 << 20;
/**
 * Shortest path / narrowest canyon or shell width a builder accepts (m). A
 * denormal width passes `> 0` and then overflows the slope planes (dh / cellX)
 * to inf when they are rounded to float.
 */
export const TERRAIN_MIN_EXTENT = 1e-3;

/**
 * Tube cross-section (`plan.md` §1: "produce inward-curving walls … to form a
 * tube/tunnel").
 *
 * The canyon mesh is a heightfield in `x`, so a tunnel cannot come from `y`
 * alone — the wall vertices have to move inward as they climb. `curl` folds
 * them back over the channel, `ceilingHeight` is where the crown lands. The
 * corridor itself is never touched, so the thalweg, the water mesh and the SWE
 * bed sampler all keep reading the same floor they did before.
 */
export interface TubeProfile {
  /**
   * Inward fold, 0 (open canyon) – 1 (walls meet on the centreline). Above
   * ~2/3 the fold is non-monotone in x, which is the overhang: the crown sits
   * inboard of the springing.
   */
  curl: number;
  /** Local Y of the tube crown, in the same datum as `yHeight`. */
  ceilingHeight: number;
}

export interface TerrainTileParams {
  pathLength: number;
  canyonWidth: number;
  waterWidth: number;
  segmentsX: number;
  segmentsZ: number;
  profile: TerrainProfileId;
  /** Decorative rock noise: the visual floor has it, the hull and the SWE bed do not. */
  rockNoise: boolean;
  tube: TubeProfile | null;
  /** `packChannelProfile` output; empty = the default channel. */
  channel: Float32Array;
}

export interface WallShellParams {
  pathLength: number;
  shellWidth: number;
  segmentsX: number;
  segmentsZ: number;
  profile: TerrainProfileId;
  /** TrackBiomeProfile.wallHeight — only the slot profile reads it. */
  wallHeight: number;
  segmentId: number;
}

/** What a tile is the surface of: the canyon floor (folded, banked) or the outer wall shell (rim). */
export type TerrainSurface = 'floor' | 'shell';

/** A built tile: `planes` is plane-major, the named fields are views into it. */
export interface TerrainTile {
  /** Cross-section family the tile was built for (the band thresholds are per profile). */
  profile: TerrainProfileId;
  surface: TerrainSurface;
  segmentsX: number;
  segmentsZ: number;
  vertexCount: number;
  planes: Float32Array;
  x: Float32Array;
  h: Float32Array;
  bank: Float32Array;
  slopeX: Float32Array;
  slopeZ: Float32Array;
  uvU: Float32Array;
  uvV: Float32Array;
}

/** (segmentsX + 1) · (segmentsZ + 1), or 0 when either is out of range. */
export function terrainVertexCount(segmentsX: number, segmentsZ: number): number {
  if (!Number.isInteger(segmentsX) || !Number.isInteger(segmentsZ)) return 0;
  if (segmentsX < 1 || segmentsZ < 1) return 0;
  if (segmentsX > TERRAIN_MAX_SEGMENTS || segmentsZ > TERRAIN_MAX_SEGMENTS) return 0;
  const count = (segmentsX + 1) * (segmentsZ + 1);
  return count > TERRAIN_MAX_VERTICES ? 0 : count;
}

/** Channel profile → the packed float32 layout the tile reads (see the header). */
export function packChannelProfile(samples: readonly ChannelProfileSample[]): Float32Array {
  const out = new Float32Array(samples.length * TERRAIN_CHANNEL_STRIDE);
  samples.forEach((s, i) => {
    const o = i * TERRAIN_CHANNEL_STRIDE;
    out[o] = s.leftHalfWidth;
    out[o + 1] = s.rightHalfWidth;
    out[o + 2] = s.corridorHalfWidth;
    out[o + 3] = s.floorDepth;
    out[o + 4] = s.floorWave;
    out[o + 5] = s.riffleStrength;
    out[o + 6] = s.gravelBarSide;
    out[o + 7] = s.undercutSide;
    out[o + 8] = s.flowScale;
  });
  return out;
}

// ---------------------------------------------------------------------------
// The profile (shared with the per-point callers: bathymetry, side placement)
// ---------------------------------------------------------------------------

function defaultChannelShape(waterWidth: number): ChannelShape {
  return {
    leftHalfWidth: waterWidth * 0.5,
    rightHalfWidth: waterWidth * 0.5,
    corridorHalfWidth: Math.max(3.2, waterWidth * 0.5 - 1.2),
    floorDepth: 0,
    floorWave: 0,
    riffleStrength: 0,
    gravelBarSide: 1,
    undercutSide: -1,
    flowScale: 1,
  };
}

/** Channel shape at path parameter t, from the authored sample objects. */
export function sampleChannelShape(
  channelProfile: readonly ChannelProfileSample[],
  waterWidth: number,
  t: number,
): ChannelShape {
  if (!channelProfile.length) return defaultChannelShape(waterWidth);
  const scaled = clamp01(t) * (channelProfile.length - 1);
  const lower = Math.floor(scaled);
  const upper = Math.min(channelProfile.length - 1, lower + 1);
  const alpha = scaled - lower;
  const from = channelProfile[lower];
  const to = channelProfile[upper];
  return {
    leftHalfWidth: lerp(from.leftHalfWidth, to.leftHalfWidth, alpha),
    rightHalfWidth: lerp(from.rightHalfWidth, to.rightHalfWidth, alpha),
    corridorHalfWidth: lerp(from.corridorHalfWidth, to.corridorHalfWidth, alpha),
    floorDepth: lerp(from.floorDepth, to.floorDepth, alpha),
    floorWave: lerp(from.floorWave, to.floorWave, alpha),
    riffleStrength: lerp(from.riffleStrength, to.riffleStrength, alpha),
    gravelBarSide: alpha < 0.5 ? from.gravelBarSide : to.gravelBarSide,
    undercutSide: alpha < 0.5 ? from.undercutSide : to.undercutSide,
    flowScale: lerp(from.flowScale, to.flowScale, alpha),
  };
}

/** Channel shape at path parameter t, from a packed profile (the tile path). */
export function samplePackedChannelShape(channel: Float32Array, waterWidth: number, t: number): ChannelShape {
  const count = Math.floor(channel.length / TERRAIN_CHANNEL_STRIDE);
  if (count <= 0) return defaultChannelShape(waterWidth);
  const scaled = clamp01(t) * (count - 1);
  const lower = Math.floor(scaled);
  const upper = Math.min(count - 1, lower + 1);
  const alpha = scaled - lower;
  const a = lower * TERRAIN_CHANNEL_STRIDE;
  const b = upper * TERRAIN_CHANNEL_STRIDE;
  const side = (v: number): 1 | -1 => (v < 0 ? -1 : 1);
  return {
    leftHalfWidth: lerp(channel[a], channel[b], alpha),
    rightHalfWidth: lerp(channel[a + 1], channel[b + 1], alpha),
    corridorHalfWidth: lerp(channel[a + 2], channel[b + 2], alpha),
    floorDepth: lerp(channel[a + 3], channel[b + 3], alpha),
    floorWave: lerp(channel[a + 4], channel[b + 4], alpha),
    riffleStrength: lerp(channel[a + 5], channel[b + 5], alpha),
    gravelBarSide: side(alpha < 0.5 ? channel[a + 6] : channel[b + 6]),
    undercutSide: side(alpha < 0.5 ? channel[a + 7] : channel[b + 7]),
    flowScale: lerp(channel[a + 8], channel[b + 8], alpha),
  };
}

/** Floor height for one point given the channel shape at its row. */
export function canyonFloorFromShape(
  xLocal: number,
  zLocal: number,
  canyonWidth: number,
  channelShape: ChannelShape,
  isSlotCanyon: boolean,
  rockNoise: boolean,
): { yHeight: number; normalizedDist: number; bankHalfWidth: number } {
  const signedBankWidth = xLocal < 0 ? channelShape.leftHalfWidth : channelShape.rightHalfWidth;
  const corridorWidth = Math.max(1.2, channelShape.corridorHalfWidth);
  const distFromCenter = Math.abs(xLocal);
  const normalizedDist = distFromCenter / (canyonWidth * 0.45);
  const bankRatio = distFromCenter / Math.max(0.001, signedBankWidth);
  const gravelBarInfluence = channelShape.gravelBarSide === Math.sign(xLocal || 1) ? 1 : 0;
  const undercutInfluence = channelShape.undercutSide === Math.sign(xLocal || 1) ? 1 : 0;

  let yHeight = isSlotCanyon
    ? 22 + Math.pow(Math.max(0, normalizedDist), 1.8) * 18
    : Math.pow(Math.max(0, normalizedDist), 2.5) * 12;

  if (distFromCenter < signedBankWidth) {
    const inChannel = distFromCenter / Math.max(0.001, signedBankWidth);
    const corridorEase = smoothstep(inChannel, 0, 1);
    yHeight *= isSlotCanyon ? 0.18 : 0.1;
    yHeight -= channelShape.floorDepth * 1.4;
    yHeight += channelShape.floorWave * (distFromCenter < corridorWidth ? 0.2 : 0.55);
    yHeight += Math.max(0, channelShape.riffleStrength) * inChannel * 0.35;
    yHeight += Math.max(0, 1 - corridorEase) * 0.05;
  } else {
    const aboveBank = Math.max(0, bankRatio - 1);
    yHeight += aboveBank * aboveBank * 4.5 * undercutInfluence;
    yHeight -= aboveBank * 1.25 * gravelBarInfluence;
  }
  if (isSlotCanyon) yHeight -= TERRAIN_SLOT_FLOOR_LIFT;

  if (rockNoise) {
    const noise = Math.sin(zLocal * 0.8 + xLocal * 0.5) * 0.3 + Math.sin(zLocal * 2.5 + xLocal * 1.2) * 0.1;
    yHeight += noise * (0.5 + normalizedDist);
  }

  return { yHeight, normalizedDist, bankHalfWidth: signedBankWidth };
}

/**
 * Fold one canyon vertex into the tube cross-section.
 *
 * Inside `corridorHalfWidth` nothing moves. Outside it the vertex climbs an
 * arc toward `ceilingHeight` while `x` is pulled back toward the centreline by
 * `curl * climb²`, so the wall leaves the springing vertical and finishes
 * overhanging.
 */
export function applyTubeProfile(
  xLocal: number,
  yHeight: number,
  corridorHalfWidth: number,
  canyonHalfWidth: number,
  profile: TubeProfile,
): { x: number; y: number } {
  const edge = Math.abs(xLocal);
  const open = Math.max(0.5, Math.min(corridorHalfWidth, canyonHalfWidth * 0.9));
  if (!Number.isFinite(edge) || edge <= open) return { x: xLocal, y: yHeight };

  const span = Math.max(1e-3, canyonHalfWidth - open);
  const climb = Math.min(1, (edge - open) / span);
  const curl = Math.max(0, Math.min(1, profile.curl));
  const folded = open + (edge - open) * (1 - curl * climb * climb);

  // Quarter-sine arc: leaves the springing at the canyon's own wall height and
  // lands exactly on the authored crown, so the roof is a number an author set
  // rather than one that fell out of the biome's wall curve.
  const arc = Math.sin(climb * Math.PI * 0.5);
  const y = yHeight * (1 - arc) + profile.ceilingHeight * arc;

  return { x: Math.sign(xLocal) * folded, y };
}

// ---------------------------------------------------------------------------
// Tiles
// ---------------------------------------------------------------------------

function viewTile(
  segmentsX: number,
  segmentsZ: number,
  planes: Float32Array,
  profile: TerrainProfileId,
  surface: TerrainSurface,
): TerrainTile {
  const n = (segmentsX + 1) * (segmentsZ + 1);
  const plane = (k: number) => planes.subarray(k * n, (k + 1) * n);
  return {
    profile,
    surface,
    segmentsX,
    segmentsZ,
    vertexCount: n,
    planes,
    x: plane(TerrainPlane.X),
    h: plane(TerrainPlane.H),
    bank: plane(TerrainPlane.BANK),
    slopeX: plane(TerrainPlane.SLOPE_X),
    slopeZ: plane(TerrainPlane.SLOPE_Z),
    uvU: plane(TerrainPlane.UV_U),
    uvV: plane(TerrainPlane.UV_V),
  };
}

function validTileParams(p: TerrainTileParams): boolean {
  return Number.isFinite(p.pathLength) && p.pathLength >= TERRAIN_MIN_EXTENT
    && Number.isFinite(p.canyonWidth) && p.canyonWidth >= TERRAIN_MIN_EXTENT
    && Number.isFinite(p.waterWidth)
    && (!p.tube || (Number.isFinite(p.tube.curl) && Number.isFinite(p.tube.ceilingHeight)))
    && terrainVertexCount(p.segmentsX, p.segmentsZ) > 0;
}

/** The segment's floor tile. Null on invalid input. */
export function buildTerrainTile(p: TerrainTileParams): TerrainTile | null {
  if (!validTileParams(p)) return null;
  const { segmentsX, segmentsZ, pathLength, canyonWidth } = p;
  const tile = viewTile(
    segmentsX,
    segmentsZ,
    new Float32Array(TERRAIN_TILE_PLANES * terrainVertexCount(segmentsX, segmentsZ)),
    p.profile,
    'floor',
  );
  const slot = p.profile === TerrainProfile.SLOT;
  const cols = segmentsX + 1;
  const cellX = canyonWidth / segmentsX;
  const cellZ = pathLength / segmentsZ;
  const halfW = canyonWidth / 2;
  const halfL = pathLength / 2;

  for (let iz = 0; iz <= segmentsZ; iz += 1) {
    const z = iz * cellZ - halfL;
    const v = (iz / segmentsZ) * pathLength;
    const shape = samplePackedChannelShape(p.channel, p.waterWidth, clamp01((z + halfL) / pathLength));
    for (let ix = 0; ix < cols; ix += 1) {
      const i = iz * cols + ix;
      const x = ix * cellX - halfW;
      const floor = canyonFloorFromShape(x, z, canyonWidth, shape, slot, p.rockNoise);
      const folded = p.tube
        ? applyTubeProfile(x, floor.yHeight, shape.corridorHalfWidth, halfW, p.tube)
        : { x, y: floor.yHeight };
      tile.x[i] = folded.x;
      tile.h[i] = folded.y;
      tile.bank[i] = Math.abs(x) >= floor.bankHalfWidth ? 1 : 0;
      tile.uvU[i] = ix / segmentsX;
      tile.uvV[i] = v;
    }
  }

  fillSlopes(tile, cellX, cellZ);
  return tile;
}

/** Slopes from the rounded H plane, so every consumer differences the same floats. */
function fillSlopes(tile: TerrainTile, cellX: number, cellZ: number): void {
  const { segmentsX, segmentsZ, h } = tile;
  const cols = segmentsX + 1;
  for (let iz = 0; iz <= segmentsZ; iz += 1) {
    const z0 = Math.max(0, iz - 1);
    const z1 = Math.min(segmentsZ, iz + 1);
    for (let ix = 0; ix < cols; ix += 1) {
      const x0 = Math.max(0, ix - 1);
      const x1 = Math.min(segmentsX, ix + 1);
      const i = iz * cols + ix;
      tile.slopeX[i] = (h[iz * cols + x1] - h[iz * cols + x0]) / ((x1 - x0) * cellX);
      tile.slopeZ[i] = (h[z1 * cols + ix] - h[z0 * cols + ix]) / ((z1 - z0) * cellZ);
    }
  }
}

/** Outer wall-shell heights above the path point, one per grid vertex. */
export function buildWallShellHeights(p: WallShellParams): Float32Array | null {
  if (!Number.isFinite(p.pathLength) || !(p.pathLength >= TERRAIN_MIN_EXTENT)) return null;
  if (!Number.isFinite(p.shellWidth) || !(p.shellWidth >= TERRAIN_MIN_EXTENT) || !Number.isFinite(p.wallHeight)) return null;
  const n = terrainVertexCount(p.segmentsX, p.segmentsZ);
  if (n === 0) return null;

  const slot = p.profile === TerrainProfile.SLOT;
  const out = new Float32Array(n);
  const cols = p.segmentsX + 1;
  const cellX = p.shellWidth / p.segmentsX;
  const cellZ = p.pathLength / p.segmentsZ;
  const seg = p.segmentId;
  const ribPhase = seg * 0.91;
  const shelfSteps = slot ? 5.0 : 3.0;

  for (let iz = 0; iz <= p.segmentsZ; iz += 1) {
    const z = iz * cellZ - p.pathLength / 2;
    for (let ix = 0; ix < cols; ix += 1) {
      const x = ix * cellX - p.shellWidth / 2;
      const dist = Math.abs(x);
      let y = slot ? p.wallHeight + dist * 0.18 : 15 + dist * 0.5;
      y += Math.sin(z * 0.1) * (slot ? 1.8 : 3) + Math.cos(x * 0.2) * (slot ? 1.1 : 2);
      const ribbing = Math.sin(z * (slot ? 0.5 : 0.38) + x * 0.12 + ribPhase) * Math.sin(x * 0.22 - ribPhase * 0.6);
      y += ribbing * (slot ? 1.1 : 0.7);
      const shelfRaw = Math.sin(z * 0.085 + x * 0.04 + seg * 0.21) * 0.5 + 0.5;
      const shelf = Math.floor(shelfRaw * shelfSteps) / shelfSteps;
      y += (shelf - 0.5) * (slot ? 2.2 : 1.2);
      if (slot) y -= TERRAIN_SLOT_FLOOR_LIFT;
      out[iz * cols + ix] = y - 2;
    }
  }
  return out;
}


/**
 * The outer wall shell as a tile (#487 D), so the rim can be sampled like the
 * floor: X is the grid x (the shell never folds), H the shell heights, BANK 1
 * everywhere. Same grid and datum as `buildWallShellHeights`.
 */
export function buildWallShellTile(p: WallShellParams): TerrainTile | null {
  const heights = buildWallShellHeights(p);
  if (!heights) return null;
  const { segmentsX, segmentsZ, shellWidth, pathLength } = p;
  const n = heights.length;
  const tile = viewTile(segmentsX, segmentsZ, new Float32Array(TERRAIN_TILE_PLANES * n), p.profile, 'shell');
  const cols = segmentsX + 1;
  const cellX = shellWidth / segmentsX;
  const cellZ = pathLength / segmentsZ;
  tile.h.set(heights);
  tile.bank.fill(1);
  for (let iz = 0; iz <= segmentsZ; iz += 1) {
    for (let ix = 0; ix < cols; ix += 1) {
      const i = iz * cols + ix;
      tile.x[i] = ix * cellX - shellWidth / 2;
      tile.uvU[i] = ix / segmentsX;
      tile.uvV[i] = (iz / segmentsZ) * pathLength;
    }
  }
  fillSlopes(tile, cellX, cellZ);
  return tile;
}

// ---------------------------------------------------------------------------
// The sampler (#487 D): height, normal and band at (s, lateral)
// ---------------------------------------------------------------------------

/**
 * What a point of the tile is. `floor` is inside the wetted channel, `bank`
 * the dry ground beyond it, `wall` dry ground steeper than the profile's wall
 * slope, `rim` the outermost cell of the floor tile and every point of the
 * wall shell, `crown` the underside of a tube fold.
 */
export const TerrainBand = {
  FLOOR: 0,
  BANK: 1,
  WALL: 2,
  RIM: 3,
  CROWN: 4,
} as const;
export type TerrainBandId = (typeof TerrainBand)[keyof typeof TerrainBand];

/** Bit per band, for a category's allowed-band mask. */
export const bandBit = (band: TerrainBandId): number => 1 << band;

/**
 * |∂H/∂x| above which dry ground reads as wall, per profile. The open canyon
 * rises at ~55° and stays "bank" up to there (trees on the lower slope); the
 * slot is sheer almost from the waterline.
 */
export const TERRAIN_WALL_SLOPE: Readonly<Record<TerrainProfileId, number>> = {
  [TerrainProfile.OPEN]: 1.75,
  [TerrainProfile.SLOT]: 1.2,
};

/** Which surface a lateral picks where a tube fold makes the tile double-valued. */
export const TileBranch = {
  /** The lowest surface at that lateral: the floor, or the wall under a fold. */
  FLOOR: 0,
  /** The highest: the fold's underside (band `crown`) where there is one. */
  CROWN: 1,
} as const;
export type TileBranchId = (typeof TileBranch)[keyof typeof TileBranch];

/** Caller-owned sampler output; the sampler writes every field and allocates nothing. */
export interface TileSample {
  /** False when the lateral is outside the tile at that row (nothing else is meaningful). */
  ok: boolean;
  /** Height above the row's path point, the tile's datum (never world Y). */
  y: number;
  /** Unit normal in the tile frame (x across, y up, z along the path, metres). */
  nx: number;
  ny: number;
  nz: number;
  band: TerrainBandId;
  /** True when a fold of the same tile lies above this point (floor branch under a tube). */
  covered: boolean;
  /** Across-tangent of the sampled cell edge (dx, dh), unnormalised. */
  ax: number;
  ay: number;
  /** Along-tangent per metre of path: (dx/dz, dh/dz) at this lateral. */
  bx: number;
  by: number;
}

export function createTileSample(): TileSample {
  return { ok: false, y: 0, nx: 0, ny: 1, nz: 0, band: TerrainBand.FLOOR, covered: false, ax: 1, ay: 0, bx: 0, by: 0 };
}

/** Metres between rows: the UV_V plane is metres downstream. */
function tileCellZ(tile: TerrainTile): number {
  const cols = tile.segmentsX + 1;
  const d = tile.uvV[cols] - tile.uvV[0];
  return d > 0 ? d : 1;
}

/**
 * Height, normal and band of the tile at path parameter `s01` (the row
 * parameter: row iz sits at s = iz / segmentsZ) and local lateral `lateral`
 * (the tile's folded x, metres from the row's path point).
 *
 * Bilinear over the grid: the two rows bracketing `s01` are blended column by
 * column, and the blended row is searched for every cell edge whose x spans
 * `lateral`. Above `curl ≈ 2/3` a tube fold makes x non-monotone, so a lateral
 * there crosses the surface twice: `TileBranch.FLOOR` (default) returns the
 * lower crossing and flags `covered`; `TileBranch.CROWN` returns the upper
 * one with band `crown`. At grid nodes the result is the vertex.
 */
export function sampleTile(
  tile: TerrainTile,
  s01: number,
  lateral: number,
  out: TileSample,
  branch: TileBranchId = TileBranch.FLOOR,
): TileSample {
  const { segmentsX, segmentsZ, x, h, bank } = tile;
  const cols = segmentsX + 1;
  const r = clamp01(Number.isFinite(s01) ? s01 : 0) * segmentsZ;
  const iz0 = Math.min(segmentsZ - 1, Math.floor(r));
  const fz = r - iz0;
  const o0 = iz0 * cols;
  const o1 = o0 + cols;

  out.ok = false;
  out.covered = false;
  if (!Number.isFinite(lateral)) return out;

  // Every crossing of `lateral` along the blended row; keep the lowest and the highest.
  let crossings = 0;
  let lastIx = -2;
  let lastA = 0;
  let loIx = -1;
  let loA = 0;
  let loH = Infinity;
  let hiIx = -1;
  let hiA = 0;
  let hiH = -Infinity;
  let xa = x[o0] + (x[o1] - x[o0]) * fz;
  let ha = h[o0] + (h[o1] - h[o0]) * fz;
  for (let ix = 0; ix < segmentsX; ix += 1) {
    const xb = x[o0 + ix + 1] + (x[o1 + ix + 1] - x[o0 + ix + 1]) * fz;
    const hb = h[o0 + ix + 1] + (h[o1 + ix + 1] - h[o0 + ix + 1]) * fz;
    const lo = xa < xb ? xa : xb;
    const hi = xa < xb ? xb : xa;
    if (lateral >= lo && lateral <= hi) {
      const span = xb - xa;
      const a = span !== 0 ? (lateral - xa) / span : 0;
      // A node shared by two edges is one crossing, not two.
      if (!(lastIx === ix - 1 && lastA === 1)) {
        const hc = ha + (hb - ha) * a;
        crossings += 1;
        if (hc < loH) {
          loH = hc;
          loIx = ix;
          loA = a;
        }
        if (hc > hiH) {
          hiH = hc;
          hiIx = ix;
          hiA = a;
        }
      }
      lastIx = ix;
      lastA = a;
    }
    xa = xb;
    ha = hb;
  }
  const upper = branch === TileBranch.CROWN && crossings > 1;
  const bestIx = upper ? hiIx : loIx;
  const bestA = upper ? hiA : loA;
  const bestH = upper ? hiH : loH;
  if (bestIx < 0) return out;

  const i0 = bestIx;
  const i1 = bestIx + 1;
  const a = bestA;
  // Across: the blended cell edge. Along: the column pair's row-to-row change, at `a`.
  const x0 = x[o0 + i0] + (x[o1 + i0] - x[o0 + i0]) * fz;
  const x1 = x[o0 + i1] + (x[o1 + i1] - x[o0 + i1]) * fz;
  const h0 = h[o0 + i0] + (h[o1 + i0] - h[o0 + i0]) * fz;
  const h1 = h[o0 + i1] + (h[o1 + i1] - h[o0 + i1]) * fz;
  const cellZ = tileCellZ(tile);
  const ax = x1 - x0;
  const ay = h1 - h0;
  const bx = ((x[o1 + i0] - x[o0 + i0]) * (1 - a) + (x[o1 + i1] - x[o0 + i1]) * a) / cellZ;
  const by = ((h[o1 + i0] - h[o0 + i0]) * (1 - a) + (h[o1 + i1] - h[o0 + i1]) * a) / cellZ;

  // n = along × across, with along = (bx, by, 1), across = (ax, ay, 0).
  let nx = -ay;
  let ny = ax;
  let nz = bx * ay - by * ax;
  const len = Math.hypot(nx, ny, nz) || 1;
  nx /= len;
  ny /= len;
  nz /= len;
  // Floor: up, or toward the channel on a vertical face. Crown: down into the tube.
  const flip = upper ? ny > 0 : ny < -1e-9 || (Math.abs(ny) <= 1e-9 && nx * lateral > 0);
  if (flip) {
    nx = -nx;
    ny = -ny;
    nz = -nz;
  }

  let band: TerrainBandId;
  if (upper) band = TerrainBand.CROWN;
  else if (tile.surface === 'shell' || i0 === 0 || i1 === segmentsX) band = TerrainBand.RIM;
  else {
    const b0 = bank[o0 + i0] + (bank[o1 + i0] - bank[o0 + i0]) * fz;
    const b1 = bank[o0 + i1] + (bank[o1 + i1] - bank[o0 + i1]) * fz;
    const wet = b0 + (b1 - b0) * a < 0.5;
    if (wet) band = TerrainBand.FLOOR;
    else band = Math.abs(ay) > TERRAIN_WALL_SLOPE[tile.profile] * Math.abs(ax) ? TerrainBand.WALL : TerrainBand.BANK;
  }

  out.ok = true;
  out.y = bestH;
  out.nx = nx;
  out.ny = ny;
  out.nz = nz;
  out.band = band;
  out.covered = !upper && crossings > 1 && hiH > loH;
  out.ax = ax;
  out.ay = ay;
  out.bx = bx;
  out.by = by;
  return out;
}

const bandScratch = createTileSample();

/** The band at (s01, lateral) on the floor branch; `rim` when the lateral is off the tile. */
export function sampleBand(tile: TerrainTile, s01: number, lateral: number): TerrainBandId {
  const s = sampleTile(tile, s01, lateral, bandScratch);
  return s.ok ? s.band : TerrainBand.RIM;
}
