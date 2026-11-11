import { describe, expect, it } from 'vitest';
import { DataUtils } from 'three';
import { packHalfFloats } from './halfFloatPack';

function packOne(value: number): number {
  const dst = new Uint16Array(1);
  packHalfFloats(new Float32Array([value]), dst);
  return dst[0]!;
}

describe('packHalfFloats', () => {
  it('matches DataUtils.toHalfFloat bit for bit across every float32 exponent', () => {
    const src = new Float32Array(256 * 2 * 64);
    const bits = new Uint32Array(src.buffer);
    let k = 0;
    for (let e = 0; e < 255; e += 1) {
      for (const sign of [0, 1]) {
        for (let m = 0; m < 64; m += 1) {
          // Spread the mantissas over the field, including the all-zero and all-one ends.
          const mantissa = m === 0 ? 0 : m === 63 ? 0x7fffff : (m * 0x1f3a5b) & 0x7fffff;
          bits[k++] = (sign << 31) | (e << 23) | mantissa;
        }
      }
    }
    const dst = new Uint16Array(src.length);
    packHalfFloats(src, dst);
    for (let i = 0; i < src.length; i += 1) {
      expect(dst[i], `value ${src[i]}`).toBe(DataUtils.toHalfFloat(src[i]!));
    }
  });

  it('round-trips the SWE field’s range closely and keeps signs, zero and NaN', () => {
    for (const v of [0, 0.5, -0.25, 1.75, 3.2, -7.9, 12.5]) {
      expect(DataUtils.fromHalfFloat(packOne(v))).toBeCloseTo(v, 2);
    }
    expect(packOne(-0)).toBe(0x8000);
    expect(Number.isNaN(DataUtils.fromHalfFloat(packOne(Number.NaN)))).toBe(true);
  });

  it('saturates out-of-range finite values to ±65504 like DataUtils, and keeps ±Infinity', () => {
    expect(DataUtils.fromHalfFloat(packOne(1e6))).toBe(65504);
    expect(DataUtils.fromHalfFloat(packOne(-1e6))).toBe(-65504);
    expect(DataUtils.fromHalfFloat(packOne(Number.POSITIVE_INFINITY))).toBe(Number.POSITIVE_INFINITY);
  });

  it('converts only as many values as the destination holds', () => {
    const dst = new Uint16Array(2);
    packHalfFloats(new Float32Array([1, 2, 3]), dst);
    expect(Array.from(dst, (h) => DataUtils.fromHalfFloat(h))).toEqual([1, 2]);
  });

  it('reads a view into a larger buffer (a heap slice) at its own offset', () => {
    const heap = new Float32Array([9, 9, 1.5, -2.5, 9]);
    const view = heap.subarray(2, 4);
    const dst = new Uint16Array(2);
    packHalfFloats(view, dst);
    expect(Array.from(dst, (h) => DataUtils.fromHalfFloat(h))).toEqual([1.5, -2.5]);
  });
});
