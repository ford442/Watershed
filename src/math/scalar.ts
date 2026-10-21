/**
 * scalar.ts — the scalar helpers every system needs, defined once (#503 A).
 *
 * Pure, three-free and worker-safe (the terrain mirror and the sim worker
 * import these). Argument order follows `THREE.MathUtils` and the C++ twin in
 * `emscripten/terrain.cpp`, so a call reads the same in all three places:
 * `smoothstep(x, min, max)` — NOT GLSL's `smoothstep(edge0, edge1, x)`.
 */

/** `value` limited to `[min, max]` (MathUtils.clamp; NaN passes through). */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * `value` limited to `[0, 1]`; NaN reads as 0 (±Infinity clamp like any number).
 * Callers feed this ratios from live data, where a NaN must never propagate
 * into a gain, a blend or a friction.
 */
export function clamp01(value: number): number {
  return value > 0 ? (value < 1 ? value : 1) : 0;
}

/** Unclamped linear interpolation `a → b` at `t`. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Hermite ease of `x` across `[min, max]` (MathUtils.smoothstep). Bit-identical
 * to three's: the terrain mirror's parity tests pin it against three itself.
 */
export function smoothstep(x: number, min: number, max: number): number {
  if (x <= min) return 0;
  if (x >= max) return 1;
  const s = (x - min) / (max - min);
  return s * s * (3 - 2 * s);
}
