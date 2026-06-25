import {
  Fn,
  float,
  vec2,
  sin,
  dot,
  fract,
  floor,
  mix,
  mul,
} from 'three/tsl';

/** fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453) */
export const hash2 = Fn(([p]: [ReturnType<typeof vec2>]) => {
  return fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));
});

/** Value noise on a 2D grid. */
export const valueNoise = Fn(([p]: [ReturnType<typeof vec2>]) => {
  const i = floor(p);
  const f = fract(p);
  const u = f.mul(f).mul(float(3).sub(f.mul(2)));
  const a = mix(hash2(i), hash2(i.add(vec2(1, 0))), u.x);
  const b = mix(hash2(i.add(vec2(0, 1))), hash2(i.add(vec2(1, 1))), u.x);
  return mix(a, b, u.y);
});

/** 2-octave FBM (RiverShader fbm2). */
export const fbm2 = Fn(([p]: [ReturnType<typeof vec2>]) => {
  const n0 = valueNoise(p);
  const n1 = valueNoise(p.mul(2));
  return n0.mul(0.5).add(n1.mul(0.25));
});

/** 4-octave FBM (CanyonMaterial fbm). */
export const fbm4 = Fn(([p]: [ReturnType<typeof vec2>]) => {
  const n0 = valueNoise(p);
  const n1 = valueNoise(p.mul(2));
  const n2 = valueNoise(p.mul(4));
  const n3 = valueNoise(p.mul(8));
  return n0.mul(0.5).add(n1.mul(0.25)).add(n2.mul(0.125)).add(n3.mul(0.0625));
});

/** Organic moss variation (RiverShader riverNoise). */
export const riverNoise = Fn(([p]: [ReturnType<typeof vec2>]) => {
  return sin(p.x.mul(3)).mul(sin(p.y.mul(3))).mul(0.5).add(0.5);
});
