/**
 * sweSurfaceField — packs the SWE state the water surface *reads* (#453).
 *
 * Pure — no React/THREE/WASM. WaterForceSystem uploads the result as the RGBA float
 * `sweFlowMap` on the same `fieldVersion` as the height texture; FlowingWater.tsx (GLSL)
 * and WaterNodeMaterial.ts (TSL) sample it in the fragment stage.
 *
 * Texel layout (same row-major grid as `h`, `idx = gz * width + gx`):
 *   R = u      m/s along +X   (solver velocity, not momentum)
 *   G = w      m/s along +Z
 *   B = depth  metres, `meanDepth + h − b`, floored at 0 (dry cells are 0)
 *   A = div    1/s, horizontal divergence ∂u/∂x + ∂w/∂z, forced to 0 on dry cells
 *
 * `sweStreakAxis` / `sweFoamWeight` are the CPU statement of what the shaders do per
 * fragment: same thresholds (all in `WATER_SHADER`, so GLSL `defines` and TSL read one
 * number), same smoothstep shapes. Keep them in step with both hosts.
 */

import { WATER_SHADER } from '../../constants/game';
import { FALLBACK_FLOW_DIR, SWE_DRY_DEPTH } from './sampleSWEFlow';

export const SWE_FLOW_CHANNELS = 4;

export interface SweSurfaceGrid {
  h: ArrayLike<number>;
  u: ArrayLike<number>;
  w: ArrayLike<number>;
  b: ArrayLike<number>;
  width: number;
  height: number;
  /** Cell size in metres (`SweSim.dx`). */
  dx: number;
}

/** GLSL `smoothstep`: edge0 < edge1 assumed; result clamped to [0, 1]. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Pack `grid` into `out` (length `4 * width * height`) in place. Allocation-free:
 * the caller owns and reuses `out` (the DataTexture's backing array).
 */
export function packSweSurfaceField(
  grid: SweSurfaceGrid,
  out: Float32Array,
  meanDepth: number,
): void {
  const { width, height, dx, h, u, w, b } = grid;
  for (let gz = 0; gz < height; gz += 1) {
    const zLo = gz > 0 ? gz - 1 : gz;
    const zHi = gz < height - 1 ? gz + 1 : gz;
    for (let gx = 0; gx < width; gx += 1) {
      const xLo = gx > 0 ? gx - 1 : gx;
      const xHi = gx < width - 1 ? gx + 1 : gx;
      const idx = gz * width + gx;
      const depth = Math.max(0, meanDepth + h[idx] - b[idx]);
      let div = 0;
      if (depth > SWE_DRY_DEPTH) {
        // Central differences; one-sided (half span) on the grid border.
        const spanX = (xHi - xLo) * dx;
        const spanZ = (zHi - zLo) * dx;
        if (spanX > 0) div += (u[gz * width + xHi] - u[gz * width + xLo]) / spanX;
        if (spanZ > 0) div += (w[zHi * width + gx] - w[zLo * width + gx]) / spanZ;
      }
      const o = idx * SWE_FLOW_CHANNELS;
      out[o] = u[idx];
      out[o + 1] = w[idx];
      out[o + 2] = depth;
      out[o + 3] = div;
    }
  }
}

export interface SweStreakAxis {
  dirX: number;
  dirZ: number;
  /** 0 = authored downstream fallback, 1 = fully simulated direction. */
  blend: number;
}

/**
 * Streak axis for a texel: the simulated horizontal velocity direction once its
 * magnitude clears `SWE_STREAK_MIN_SPEED` in wet water, else the authored downstream
 * vector. Smooth in between so the pattern doesn't snap.
 */
export function sweStreakAxis(u: number, w: number, depth: number): SweStreakAxis {
  const speed = Math.hypot(u, w);
  const blend =
    smoothstep(WATER_SHADER.SWE_STREAK_MIN_SPEED, WATER_SHADER.SWE_STREAK_FULL_SPEED, speed) *
    smoothstep(0, WATER_SHADER.SWE_WET_BAND, depth);
  if (blend <= 0 || speed < 1e-8) {
    return { dirX: FALLBACK_FLOW_DIR.x, dirZ: FALLBACK_FLOW_DIR.z, blend: 0 };
  }
  const x = FALLBACK_FLOW_DIR.x * (1 - blend) + (u / speed) * blend;
  const z = FALLBACK_FLOW_DIR.z * (1 - blend) + (w / speed) * blend;
  const len = Math.hypot(x, z);
  if (len < 1e-6) {
    return { dirX: FALLBACK_FLOW_DIR.x, dirZ: FALLBACK_FLOW_DIR.z, blend: 0 };
  }
  return { dirX: x / len, dirZ: z / len, blend };
}

export interface SweFoamWeight {
  /** Wet/dry contour: 1 on a dry cell, 0 once depth clears `SWE_WET_BAND`. */
  bank: number;
  /** Hydraulic-jump foam: rises where horizontal divergence is positive. */
  jump: number;
  /** `bank + jump·intensity`, clamped to [0, 1]. */
  total: number;
}

/** Foam weight from a texel's `depth` and `div`. */
export function sweFoamWeight(depth: number, div: number): SweFoamWeight {
  const bank = 1 - smoothstep(0, WATER_SHADER.SWE_WET_BAND, depth);
  const wet = depth > SWE_DRY_DEPTH ? 1 : 0;
  const jump = smoothstep(WATER_SHADER.SWE_JUMP_DIV_LO, WATER_SHADER.SWE_JUMP_DIV_HI, div) * wet;
  const total = Math.min(1, Math.max(0, bank + jump * WATER_SHADER.SWE_JUMP_FOAM_INTENSITY));
  return { bank, jump, total };
}
