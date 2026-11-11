/**
 * halfFloatPack.ts — Float32Array → IEEE 754 half floats, in bulk (#554 B.1).
 *
 * The SWE height and surface textures upload as `HalfFloatType` (RGBA16F /
 * R16F): unlike `RGBA32F`, which WebGL2 only filters linearly behind
 * `OES_texture_float_linear` (absent on most mobile GPUs), half floats filter
 * everywhere WebGL2 exists, and the upload is half the bytes.
 *
 * `THREE.DataUtils.toHalfFloat` converts one number per call through a shared
 * one-element scratch view, ~0.6 ms per frame for the 5 × 128 × 80 values the
 * two textures hold. This is the same table conversion (Mike Acton / Jeroen van
 * der Zijp's base + shift tables, which three's DataUtils uses) run over the
 * source's bits directly: one Uint32Array view per source array, cached, so a
 * frame allocates nothing.
 *
 * Bit-identical to `DataUtils.toHalfFloat` for every finite input and NaN,
 * including its saturation of out-of-range finite values to ±65504 (a blown-up
 * cell stays finite on the GPU). The one difference: ±Infinity packs to ±Inf,
 * where DataUtils clamps it to ±65504 first.
 */

const BASE = new Uint16Array(512);
const SHIFT = new Uint8Array(512);

for (let i = 0; i < 256; i += 1) {
  const e = i - 127;
  let base: number;
  let shift: number;
  if (e < -27) {
    // Too small for a half denormal: ±0.
    base = 0x0000;
    shift = 24;
  } else if (e < -14) {
    // Half denormal.
    base = 0x0400 >> (-e - 14);
    shift = -e - 1;
  } else if (e <= 15) {
    // Normal.
    base = (e + 15) << 10;
    shift = 13;
  } else if (e < 128) {
    // Finite but past 65504: saturate to the largest finite half, as DataUtils does.
    base = 0x7bff;
    shift = 24;
  } else {
    // Infinity / NaN: keep the class, and the top of NaN's payload.
    base = 0x7c00;
    shift = 13;
  }
  BASE[i] = base;
  BASE[i | 0x100] = base | 0x8000;
  SHIFT[i] = shift;
  SHIFT[i | 0x100] = shift;
}

/** The bit view of each source array (stable for a sim's life; a WeakMap lookup allocates nothing). */
const bitViews = new WeakMap<Float32Array, Uint32Array>();

function bitsOf(src: Float32Array): Uint32Array {
  let bits = bitViews.get(src);
  if (!bits) {
    bits = new Uint32Array(src.buffer, src.byteOffset, src.length);
    bitViews.set(src, bits);
  }
  return bits;
}

/**
 * Write `src` into `dst` as half floats. Converts `min(src.length, dst.length)`
 * values; the caller sizes `dst` to the texture.
 */
export function packHalfFloats(src: Float32Array, dst: Uint16Array): void {
  const bits = bitsOf(src);
  const n = Math.min(bits.length, dst.length);
  for (let i = 0; i < n; i += 1) {
    const f = bits[i]!;
    const e = (f >>> 23) & 0x1ff;
    dst[i] = BASE[e]! + ((f & 0x007fffff) >>> SHIFT[e]!);
  }
}
