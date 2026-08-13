/**
 * waterNoise.ts — TSL ports of the noise helpers inlined in FlowingWater's GLSL.
 *
 * These are NOT the same as `tsl/noise.ts`: the water shader's fbm variants use
 * different octave weights and per-octave offsets than the RiverShader ones
 * (`v += noise(p) * 0.50; p = p * 2.1 + vec2(1.2, 3.4); …`). Porting the water
 * surface with the river's fbm would shift every foam threshold, so the two live
 * side by side and each mirrors exactly one GLSL source.
 */

import { Fn, float, vec2, sin, dot, fract, floor, mix } from 'three/tsl';

/** `fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453)` — FlowingWater `hash`. */
export const waterHash = Fn(([p]: [ReturnType<typeof vec2>]) => {
  return fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));
});

/** Smoothstep-interpolated value noise — FlowingWater `noise`. */
export const waterNoise = Fn(([p]: [ReturnType<typeof vec2>]) => {
  const i = floor(p);
  const f = fract(p);
  const s = f.mul(f).mul(float(3).sub(f.mul(2)));
  const a = mix(waterHash(i), waterHash(i.add(vec2(1, 0))), s.x);
  const b = mix(waterHash(i.add(vec2(0, 1))), waterHash(i.add(vec2(1, 1))), s.x);
  return mix(a, b, s.y);
});

/** 3-octave fbm with per-octave offsets — FlowingWater `fbm3`. */
export const waterFbm3 = Fn(([p]: [ReturnType<typeof vec2>]) => {
  const p1 = p.mul(2.1).add(vec2(1.2, 3.4));
  const p2 = p1.mul(2.1).add(vec2(4.5, 2.1));
  return waterNoise(p)
    .mul(0.5)
    .add(waterNoise(p1).mul(0.25))
    .add(waterNoise(p2).mul(0.125));
});

/** 2-octave fbm with a per-octave offset — FlowingWater `fbm2`. */
export const waterFbm2 = Fn(([p]: [ReturnType<typeof vec2>]) => {
  const p1 = p.mul(2.2).add(vec2(3.1, 1.7));
  return waterNoise(p).mul(0.6).add(waterNoise(p1).mul(0.3));
});
