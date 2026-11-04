/** erosionCodec — the save's erosion plane string (#546 D table tests). */
import { EROSION_K, EROSION_MAX_DEPTH } from './erosion';
import { decodeErosionPlane, encodeErosionPlane } from './erosionCodec';

const LIMIT = EROSION_MAX_DEPTH / EROSION_K;
const STEP = LIMIT / 127;

function plane(values: number[]): Float32Array {
  return Float32Array.from(values);
}

describe('erosionCodec round trip', () => {
  it.each([
    ['all zeros', new Array(286).fill(0)],
    ['one bump', [0, 0, 0, LIMIT * 0.5, 0, 0]],
    ['both clamps', [LIMIT, -LIMIT, LIMIT, -LIMIT]],
    ['a run longer than 255 zeros', [STEP * 3, ...new Array(600).fill(0), -STEP * 5]],
    ['no zeros at all', Array.from({ length: 40 }, (_, i) => ((i % 9) - 4) * STEP * 10)],
  ])('%s: decodes to the input within one quantum', (_label, values) => {
    const decoded = decodeErosionPlane(encodeErosionPlane(plane(values)), values.length);
    expect(decoded).not.toBeNull();
    expect(decoded!.length).toBe(values.length);
    for (let i = 0; i < values.length; i += 1) {
      expect(Math.abs(decoded![i]! - values[i]!)).toBeLessThanOrEqual(STEP / 2 + 1e-7);
    }
  });

  it('clamps out-of-range and non-finite values instead of wrapping', () => {
    const decoded = decodeErosionPlane(encodeErosionPlane(plane([LIMIT * 4, -LIMIT * 4, NaN, Infinity])), 4)!;
    expect(decoded[0]).toBeCloseTo(LIMIT, 6);
    expect(decoded[1]).toBeCloseTo(-LIMIT, 6);
    expect(decoded[2]).toBe(0);
    expect(decoded[3]).toBe(0);
  });

  it('collapses an untouched plane to a few characters', () => {
    expect(encodeErosionPlane(new Float32Array(286)).length).toBeLessThanOrEqual(8);
  });
});

describe('decodeErosionPlane rejects what it did not write', () => {
  const good = encodeErosionPlane(plane([0, 0, STEP * 20, 0]));
  it.each([
    ['the wrong size (short)', good, 3],
    ['the wrong size (long)', good, 5],
    ['size 0', good, 0],
    ['not base64', '%%%', 4],
    ['a run with no count', btoa(String.fromCharCode(0x80)), 4],
    ['a run of zero', btoa(String.fromCharCode(0x80, 0)), 4],
  ])('%s', (_label, text, size) => {
    expect(decodeErosionPlane(text, size)).toBeNull();
  });
});
