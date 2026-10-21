/**
 * random.ts — the one seeded PRNG (#503 A; the #468 / #487 D spec).
 *
 * xoshiro128** (Blackman & Vigna) on four 32-bit words, its state filled by
 * two SplitMix64 outputs of the seed — the seeding the xoshiro authors
 * recommend, and what a C++ twin can reproduce bit for bit for a Daily River.
 * A safe-integer seed is taken as that integer (two's complement for
 * negatives); any other number seeds from its float64 bits, so `i * 123.45`
 * is a valid, distinct seed too.
 *
 * Seed once, draw many: seeding uses BigInt (four values), drawing is pure
 * 32-bit `Math.imul` and allocates nothing.
 */

import { fnv1a32 } from './hash';

/** A stream of uniform draws in `[0, 1)`. */
export type Rng = () => number;

const MASK64 = 0xffff_ffff_ffff_ffffn;
const f64 = new Float64Array(1);
const u64 = new BigUint64Array(f64.buffer);

function seedBits(seed: number): bigint {
  if (Number.isSafeInteger(seed)) return BigInt.asUintN(64, BigInt(seed));
  f64[0] = seed;
  return u64[0];
}

/** SplitMix64 output for state `x + k·φ` (k = 1, 2, …), as the reference `next()`. */
function splitmix64(x: bigint): bigint {
  let z = x & MASK64;
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK64;
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK64;
  return z ^ (z >> 31n);
}

/** Fill `out` with the xoshiro128** state for `seed`. */
export function seedRngState(seed: number, out: Uint32Array = new Uint32Array(4)): Uint32Array {
  const golden = 0x9e3779b97f4a7c15n;
  const base = seedBits(seed);
  const a = splitmix64(base + golden);
  const b = splitmix64(base + 2n * golden);
  out[0] = Number(a & 0xffff_ffffn);
  out[1] = Number(a >> 32n);
  out[2] = Number(b & 0xffff_ffffn);
  out[3] = Number(b >> 32n);
  // The all-zero state is xoshiro's one fixed point; SplitMix64 never emits it
  // twice in a row in practice, but a stuck stream must be impossible.
  if ((out[0] | out[1] | out[2] | out[3]) === 0) out[0] = 1;
  return out;
}

/** Advance `s` one step; the next 32-bit output (xoshiro128**). */
export function nextU32(s: Uint32Array): number {
  const s1 = s[1];
  const product = Math.imul(s1, 5);
  const result = Math.imul((product << 7) | (product >>> 25), 9) >>> 0;
  const t = s1 << 9;
  s[2] ^= s[0];
  s[3] ^= s[1];
  s[1] ^= s[2];
  s[0] ^= s[3];
  s[2] ^= t;
  s[3] = (s[3] << 11) | (s[3] >>> 21);
  return result;
}

/** A seeded stream of uniform draws in `[0, 1)`. */
export function createRng(seed: number): Rng {
  const state = seedRngState(seed);
  return () => nextU32(state) / 0x1_0000_0000;
}

/** Uniform draw in `[min, max)`. */
export function rngRange(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min);
}

/** Uniform integer in `[min, max]` (both inclusive). */
export function rngInt(rng: Rng, min: number, max: number): number {
  return Math.floor(rngRange(rng, min, max + 1));
}

/**
 * A named sub-stream seed: `seed` forked by `label` (`forkSeed(runSeed,
 * 'weather')`). Each system draws from its own stream, so adding a draw to
 * one never shifts another's sequence.
 */
export function forkSeed(seed: number, label: string): number {
  return (Math.imul((seed >>> 0) ^ fnv1a32(label), 0x9e3779b1) ^ fnv1a32(`${label}#${seed >>> 0}`)) >>> 0;
}
