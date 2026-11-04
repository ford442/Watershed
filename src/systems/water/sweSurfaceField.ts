/**
 * sweSurfaceField — the SWE state the water surface *reads* (#453).
 *
 * The RGBA float `sweFlowMap` is uploaded on the same `fieldVersion` as the height
 * texture; FlowingWater.tsx (GLSL) and WaterNodeMaterial.ts (TSL) sample it in the
 * fragment stage. Since #533 the bytes are packed natively — `packSurfaceField`
 * (emscripten/chores.cpp), in the sim worker on wasm-worker, on the main thread's
 * heap on wasm-main, by `pack_surface` (swe.wgsl) on the GPU — and the main thread
 * only points the texture at them (`SweSim.packSurface`, sweHost.ts). The TS loop
 * that packed them here every step is gone; sweSurfaceField.drift.test.ts keeps a
 * float32-exact statement of the stencil and pins the native bytes to it.
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
import { smoothstep } from '../../math/scalar';

export const SWE_FLOW_CHANNELS = 4;

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
    smoothstep(speed, WATER_SHADER.SWE_STREAK_MIN_SPEED, WATER_SHADER.SWE_STREAK_FULL_SPEED) *
    smoothstep(depth, 0, WATER_SHADER.SWE_WET_BAND);
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
  const bank = 1 - smoothstep(depth, 0, WATER_SHADER.SWE_WET_BAND);
  const wet = depth > SWE_DRY_DEPTH ? 1 : 0;
  const jump = smoothstep(div, WATER_SHADER.SWE_JUMP_DIV_LO, WATER_SHADER.SWE_JUMP_DIV_HI) * wet;
  const total = Math.min(1, Math.max(0, bank + jump * WATER_SHADER.SWE_JUMP_FOAM_INTENSITY));
  return { bank, jump, total };
}
