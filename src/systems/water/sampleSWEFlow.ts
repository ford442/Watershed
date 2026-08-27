/**
 * sampleSWEFlow — bilinear SWE velocity at a world XZ for the water-force ABI.
 *
 * Force *integration* stays in calculateWaterForce / calculateWaterForceFallback.
 * This module only produces { dirX, dirZ, speed } so WaterForceSystem can feed
 * the existing worker tick params and main-thread ABI. Do not apply impulses.
 *
 * Dry cells zero speed (C++ treats a zero flowDir as downstream (0, −1)).
 * When SWE is off, callers get authored (0, −1) * flowSpeed.
 *
 * Phase C: wet speed is clamp(||(u,w)|| * SWE_FLOW_SPEED_SCALE, 0, authored
 * flowSpeed). Maps cap intensity; a lake-at-rest does not push.
 */

import { SWE_MEAN_DEPTH } from './SWEHeightField';

/** Match emscripten/swe.cpp SWE_DRY_DEPTH. */
export const SWE_DRY_DEPTH = 1e-4;

/** Maps authored flowSpeed to a cap, not a second current. */
export const SWE_FLOW_SPEED_SCALE = 1;

export const FALLBACK_FLOW_DIR = { x: 0, z: -1 } as const;

export type SWEFlowSource = 'swe' | 'fallback';

export interface SWEFlowSample {
  dirX: number;
  dirZ: number;
  speed: number;
  wet: boolean;
  source: SWEFlowSource;
}

export interface SWEFlowGrid {
  h: ArrayLike<number>;
  u: ArrayLike<number>;
  w: ArrayLike<number>;
  b: ArrayLike<number>;
  width: number;
  height: number;
  cellSize: number;
  originX: number;
  originZ: number;
}

export interface SampleSWEFlowOptions {
  worldX: number;
  worldZ: number;
  /** Authored segment flowSpeed — used as a cap when SWE is on. */
  flowSpeed: number;
  grid: SWEFlowGrid | null;
  enabled?: boolean;
  meanDepth?: number;
  dryDepth?: number;
  speedScale?: number;
}

function clampIndex(i: number, n: number): number {
  if (n <= 0) return 0;
  return Math.max(0, Math.min(n - 1, i));
}

function sampleCell(arr: ArrayLike<number>, width: number, i: number, j: number): number {
  return arr[j * width + i] ?? 0;
}

function bilinear(
  arr: ArrayLike<number>,
  width: number,
  height: number,
  gx: number,
  gz: number,
): number {
  const i0 = Math.floor(gx);
  const j0 = Math.floor(gz);
  const fx = gx - i0;
  const fz = gz - j0;
  const x0 = clampIndex(i0, width);
  const x1 = clampIndex(i0 + 1, width);
  const z0 = clampIndex(j0, height);
  const z1 = clampIndex(j0 + 1, height);
  const v00 = sampleCell(arr, width, x0, z0);
  const v10 = sampleCell(arr, width, x1, z0);
  const v01 = sampleCell(arr, width, x0, z1);
  const v11 = sampleCell(arr, width, x1, z1);
  return v00 * (1 - fx) * (1 - fz) + v10 * fx * (1 - fz) + v01 * (1 - fx) * fz + v11 * fx * fz;
}

function fallbackSample(flowSpeed: number): SWEFlowSample {
  return {
    dirX: FALLBACK_FLOW_DIR.x,
    dirZ: FALLBACK_FLOW_DIR.z,
    speed: flowSpeed,
    wet: true,
    source: 'fallback',
  };
}

/**
 * Sample live SWE velocity at a world-space XZ.
 *
 * Cell centres sit at `origin + (i, j) * cellSize` (same as bathymetry raster).
 * Edges are transmissive: indices clamp, they do not wrap.
 */
export function sampleSWEFlow(opts: SampleSWEFlowOptions): SWEFlowSample {
  const {
    worldX,
    worldZ,
    flowSpeed,
    grid,
    enabled = true,
    meanDepth = SWE_MEAN_DEPTH,
    dryDepth = SWE_DRY_DEPTH,
    speedScale = SWE_FLOW_SPEED_SCALE,
  } = opts;

  if (!enabled || !grid || grid.width <= 0 || grid.height <= 0 || grid.cellSize <= 0) {
    return fallbackSample(flowSpeed);
  }

  const { h, u, w, b, width, height, cellSize, originX, originZ } = grid;
  const count = width * height;
  if (h.length < count || u.length < count || w.length < count || b.length < count) {
    return fallbackSample(flowSpeed);
  }

  const gx = (worldX - originX) / cellSize;
  const gz = (worldZ - originZ) / cellSize;
  const eta = bilinear(h, width, height, gx, gz);
  const bed = bilinear(b, width, height, gx, gz);
  const depth = meanDepth + eta - bed;
  const velU = bilinear(u, width, height, gx, gz);
  const velW = bilinear(w, width, height, gx, gz);
  const hypot = Math.hypot(velU, velW);

  if (depth <= dryDepth) {
    return {
      dirX: FALLBACK_FLOW_DIR.x,
      dirZ: FALLBACK_FLOW_DIR.z,
      speed: 0,
      wet: false,
      source: 'swe',
    };
  }

  const cap = Math.max(0, flowSpeed);
  const speed = Math.min(cap, Math.max(0, hypot * speedScale));
  if (hypot < 1e-8) {
    return {
      dirX: FALLBACK_FLOW_DIR.x,
      dirZ: FALLBACK_FLOW_DIR.z,
      speed,
      wet: true,
      source: 'swe',
    };
  }

  return {
    dirX: velU / hypot,
    dirZ: velW / hypot,
    speed,
    wet: true,
    source: 'swe',
  };
}
