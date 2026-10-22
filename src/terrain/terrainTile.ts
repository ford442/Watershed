/**
 * terrainTile — one canyon source (#487 Phase A), TypeScript mirror.
 *
 * `emscripten/terrain.cpp` is the canonical builder: path length, widths, the
 * channel profile and the tube profile in; SoA planes (folded x, floor height,
 * bank mask, slopes, flow-aligned uv) out, at the grid the caller asks for.
 * This module is the same function in TypeScript — the formulas the canyon
 * builders used to evaluate inline — so a session without the WASM module
 * builds the same tile, and `terrainParity.test.ts` pins the two together.
 *
 * Grid and plane conventions are documented once, in `emscripten/terrain.h`.
 * Both backends compute in float64 and round once into the Float32 planes;
 * the channel profile crosses as float32 (`packChannelProfile`) on both.
 */

import type { WatershedNativeModule } from '../systems/water/wasmAbi';
import { heapF32 } from '../systems/water/wasmAbi';
import type { ChannelProfileSample, ChannelShape } from './types';
import { clamp01, lerp, smoothstep } from '../math/scalar';

/** Floats per packed channel sample — TERRAIN_CHANNEL_STRIDE in terrain.h. */
export const TERRAIN_CHANNEL_STRIDE = 9;

/** Planes per tile — TERRAIN_TILE_PLANES in terrain.h. */
export const TERRAIN_TILE_PLANES = 7;

/** Plane order — TerrainPlane in terrain.h. */
export const TerrainPlane = {
  X: 0,
  H: 1,
  BANK: 2,
  SLOPE_X: 3,
  SLOPE_Z: 4,
  UV_U: 5,
  UV_V: 6,
} as const;

/** Cross-section family — TerrainProfile in terrain.h. */
export const TerrainProfile = {
  OPEN: 0,
  SLOT: 1,
} as const;
export type TerrainProfileId = (typeof TerrainProfile)[keyof typeof TerrainProfile];

/**
 * TERRAIN_SLOT_FLOOR_LIFT in terrain.h (#487 C): the slot profile is lowered by
 * its in-channel constant so its thalweg sits at the same datum as every other
 * biome, at or below the water sheet. Floor and wall shell move together.
 */
export const TERRAIN_SLOT_FLOOR_LIFT = 22.0 * 0.18;

/** TERRAIN_MAX_SEGMENTS / TERRAIN_MAX_VERTICES in terrain.h. */
export const TERRAIN_MAX_SEGMENTS = 4096;
export const TERRAIN_MAX_VERTICES = 1 << 20;

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

/** A built tile: `planes` is plane-major, the named fields are views into it. */
export interface TerrainTile {
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

/** Channel profile → the packed float32 layout both backends read (terrain.h). */
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

function viewTile(segmentsX: number, segmentsZ: number, planes: Float32Array): TerrainTile {
  const n = (segmentsX + 1) * (segmentsZ + 1);
  const plane = (k: number) => planes.subarray(k * n, (k + 1) * n);
  return {
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
  return Number.isFinite(p.pathLength) && p.pathLength > 0
    && Number.isFinite(p.canyonWidth) && p.canyonWidth > 0
    && Number.isFinite(p.waterWidth)
    && (!p.tube || (Number.isFinite(p.tube.curl) && Number.isFinite(p.tube.ceilingHeight)))
    && terrainVertexCount(p.segmentsX, p.segmentsZ) > 0;
}

/** The TS mirror of `buildTerrainTile` (terrain.cpp). Null on invalid input. */
export function buildTerrainTile(p: TerrainTileParams): TerrainTile | null {
  if (!validTileParams(p)) return null;
  const { segmentsX, segmentsZ, pathLength, canyonWidth } = p;
  const tile = viewTile(segmentsX, segmentsZ, new Float32Array(TERRAIN_TILE_PLANES * terrainVertexCount(segmentsX, segmentsZ)));
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

  // Slopes from the rounded H plane, as terrain.cpp does.
  const h = tile.h;
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
  return tile;
}

/** The TS mirror of `buildWallShell` (terrain.cpp): wall height above the path point. */
export function buildWallShellHeights(p: WallShellParams): Float32Array | null {
  if (!Number.isFinite(p.pathLength) || p.pathLength <= 0) return null;
  if (!Number.isFinite(p.shellWidth) || p.shellWidth <= 0 || !Number.isFinite(p.wallHeight)) return null;
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

// ---------------------------------------------------------------------------
// Native backend (ws_buildTerrainTile / ws_buildWallShell, ABI 13)
// ---------------------------------------------------------------------------

type TerrainNative = Pick<WatershedNativeModule, 'HEAPF32' | 'allocateGrid' | 'freeGrid' | 'buildTerrainTile' | 'buildWallShell'>;

/**
 * Build a tile in the WASM heap and copy it out. Same result shape as the
 * mirror; null when the native builder rejects the parameters.
 */
export function buildTerrainTileNative(wasm: TerrainNative, p: TerrainTileParams): TerrainTile | null {
  const n = terrainVertexCount(p.segmentsX, p.segmentsZ);
  if (n === 0) return null;
  const channelCount = Math.floor(p.channel.length / TERRAIN_CHANNEL_STRIDE);
  const channelFloats = channelCount * TERRAIN_CHANNEL_STRIDE;
  const channelPtr = channelFloats > 0 ? wasm.allocateGrid(channelFloats) : 0;
  const outPtr = wasm.allocateGrid(n * TERRAIN_TILE_PLANES);
  try {
    if (channelPtr) heapF32(wasm, channelPtr, channelFloats).set(p.channel.subarray(0, channelFloats));
    const written = wasm.buildTerrainTile(
      p.pathLength, p.canyonWidth, p.waterWidth,
      p.segmentsX, p.segmentsZ, p.profile,
      p.rockNoise ? 1 : 0,
      p.tube ? 1 : 0, p.tube?.curl ?? 0, p.tube?.ceilingHeight ?? 0,
      channelPtr, channelCount, outPtr,
    );
    if (written !== n) return null;
    return viewTile(p.segmentsX, p.segmentsZ, heapF32(wasm, outPtr, n * TERRAIN_TILE_PLANES).slice());
  } finally {
    wasm.freeGrid(outPtr);
    if (channelPtr) wasm.freeGrid(channelPtr);
  }
}

/** Native wall shell heights; null when the native builder rejects the parameters. */
export function buildWallShellHeightsNative(wasm: TerrainNative, p: WallShellParams): Float32Array | null {
  const n = terrainVertexCount(p.segmentsX, p.segmentsZ);
  if (n === 0) return null;
  const outPtr = wasm.allocateGrid(n);
  try {
    const written = wasm.buildWallShell(
      p.pathLength, p.shellWidth, p.segmentsX, p.segmentsZ, p.profile, p.wallHeight, p.segmentId, outPtr,
    );
    return written === n ? heapF32(wasm, outPtr, n).slice() : null;
  } finally {
    wasm.freeGrid(outPtr);
  }
}
