import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { clamp, clamp01, lerp, smoothstep } from './scalar';
import { sinHash } from './hash';
import { createRng, nextU32, rngInt, rngRange, seedRngState } from './random';

describe('scalar', () => {
  it('clamp matches MathUtils.clamp', () => {
    for (const v of [-3, -0.5, 0, 0.25, 1, 7]) {
      expect(clamp(v, -1, 2)).toBe(THREE.MathUtils.clamp(v, -1, 2));
    }
  });

  it('clamp01 maps NaN to 0 and clamps infinities', () => {
    expect(clamp01(0.4)).toBe(0.4);
    expect(clamp01(-2)).toBe(0);
    expect(clamp01(9)).toBe(1);
    expect(clamp01(Number.NaN)).toBe(0);
    expect(clamp01(Number.POSITIVE_INFINITY)).toBe(1);
    expect(clamp01(Number.NEGATIVE_INFINITY)).toBe(0);
  });

  it('lerp is unclamped', () => {
    expect(lerp(2, 4, 0.5)).toBe(3);
    expect(lerp(2, 4, 2)).toBe(6);
  });

  it('smoothstep is bit-identical to MathUtils.smoothstep (x, min, max)', () => {
    for (let i = -10; i <= 30; i++) {
      const x = i * 0.137;
      expect(smoothstep(x, 0.5, 4)).toBe(THREE.MathUtils.smoothstep(x, 0.5, 4));
    }
  });
});

describe('sinHash', () => {
  it('is the GLSL fract(sin(n) * 43758.5453) hash, in [0, 1)', () => {
    for (let i = 0; i < 200; i++) {
      const n = i * 12.9898;
      const x = Math.sin(n) * 43758.5453;
      const h = sinHash(n);
      expect(h).toBe(x - Math.floor(x));
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
    }
  });
});

describe('random (SplitMix64 → xoshiro128**)', () => {
  it('xoshiro128** matches the reference outputs for state {1, 2, 3, 4}', () => {
    const s = Uint32Array.of(1, 2, 3, 4);
    const out = Array.from({ length: 6 }, () => nextU32(s));
    expect(out).toEqual([11520, 0, 5927040, 70819200, 2031721883, 1637235492]);
  });

  it('seeds from SplitMix64 exactly as the C reference does', () => {
    // Reference: sm = seed; s = {lo(a), hi(a), lo(b), hi(b)} for a, b = splitmix64(), splitmix64().
    const draw3 = (seed: number) => {
      const s = seedRngState(seed);
      return [nextU32(s), nextU32(s), nextU32(s)];
    };
    expect(draw3(42)).toEqual([1776835114, 4165204688, 17111135]);
    expect(draw3(-7)).toEqual([2770651774, 585381616, 711422325]);
    // Non-integer seeds hash their float64 bits.
    expect(draw3(0.5)).toEqual([2623719410, 794803948, 4175416839]);
  });

  it('same seed → same stream; different seeds diverge', () => {
    const a = createRng(1234);
    const b = createRng(1234);
    const c = createRng(1235);
    const sa = Array.from({ length: 16 }, a);
    expect(Array.from({ length: 16 }, b)).toEqual(sa);
    expect(Array.from({ length: 16 }, c)).not.toEqual(sa);
  });

  it('draws are uniform-ish in [0, 1)', () => {
    const rng = createRng(7);
    const bins = new Array(10).fill(0);
    for (let i = 0; i < 20000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      bins[Math.floor(v * 10)] += 1;
    }
    for (const n of bins) expect(Math.abs(n - 2000)).toBeLessThan(200);
  });

  it('rngRange / rngInt stay in range', () => {
    const rng = createRng(99);
    const ints = new Set<number>();
    for (let i = 0; i < 500; i++) {
      const r = rngRange(rng, -2, 3);
      expect(r).toBeGreaterThanOrEqual(-2);
      expect(r).toBeLessThan(3);
      const n = rngInt(rng, 1, 4);
      expect(Number.isInteger(n)).toBe(true);
      ints.add(n);
    }
    expect([...ints].sort()).toEqual([1, 2, 3, 4]);
  });
});
