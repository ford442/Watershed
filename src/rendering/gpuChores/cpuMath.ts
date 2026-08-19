/**
 * Pure TypeScript gpu-chores kernels. Goldens pin these. The WASM TU
 * (`emscripten/chores.cpp`) must match the formulas exactly.
 */

import { HISTOGRAM_BINS, type Downsample2dOutput, type GridReduceOutput, type LumaHistogramOutput, type SeparableBlurOutput } from './types';

const BT709_R = 0.2126;
const BT709_G = 0.7152;
const BT709_B = 0.0722;
const BLUR_TAP = 0.25;
const BLUR_CENTER = 0.5;

export function reduceF32(values: ArrayLike<number>, count = values.length): GridReduceOutput {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let sum = 0;
  let n = 0;
  const end = Math.min(count, values.length);
  for (let i = 0; i < end; i += 1) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    n += 1;
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  if (n === 0) {
    return { kind: 'grid-reduce', min: 0, max: 0, mean: 0, count: 0 };
  }
  return { kind: 'grid-reduce', min, max, mean: sum / n, count: n };
}

function binScalar(value: number, rangeMin: number, rangeMax: number): number {
  const span = rangeMax - rangeMin;
  if (!(span > 0)) return 0;
  const t = ((value - rangeMin) / span) * HISTOGRAM_BINS;
  const bin = Math.floor(t);
  if (bin < 0) return 0;
  if (bin > HISTOGRAM_BINS - 1) return HISTOGRAM_BINS - 1;
  return bin;
}

export function histogramF32(
  values: ArrayLike<number>,
  count = values.length,
  rangeMin?: number,
  rangeMax?: number,
): LumaHistogramOutput {
  let lo = rangeMin;
  let hi = rangeMax;
  if (lo === undefined || hi === undefined) {
    const reduced = reduceF32(values, count);
    lo = lo ?? reduced.min;
    hi = hi ?? reduced.max;
  }

  const bins = new Uint32Array(HISTOGRAM_BINS);
  let n = 0;
  const end = Math.min(count, values.length);
  for (let i = 0; i < end; i += 1) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    bins[binScalar(v, lo, hi)] += 1;
    n += 1;
  }
  return { kind: 'luma-histogram', bins, count: n };
}

export function lumaHistogramU8(
  rgba: ArrayLike<number>,
  pixelCount: number,
): LumaHistogramOutput {
  const bins = new Uint32Array(HISTOGRAM_BINS);
  let n = 0;
  for (let p = 0; p < pixelCount; p += 1) {
    const i = p * 4;
    const r = rgba[i] ?? 0;
    const g = rgba[i + 1] ?? 0;
    const b = rgba[i + 2] ?? 0;
    const y = (BT709_R * r + BT709_G * g + BT709_B * b) / 255;
    if (!Number.isFinite(y)) continue;
    const bin = Math.min(HISTOGRAM_BINS - 1, Math.max(0, Math.floor(y * HISTOGRAM_BINS)));
    bins[bin] += 1;
    n += 1;
  }
  return { kind: 'luma-histogram', bins, count: n };
}

export function downsampleF32(
  src: ArrayLike<number>,
  srcW: number,
  srcH: number,
  destW: number,
  destH: number,
): Downsample2dOutput {
  const width = Math.max(1, destW | 0);
  const height = Math.max(1, destH | 0);
  const values = new Float32Array(width * height);
  for (let dy = 0; dy < height; dy += 1) {
    let y0 = Math.floor((dy * srcH) / height);
    let y1 = Math.floor(((dy + 1) * srcH) / height);
    if (y1 <= y0) y1 = Math.min(srcH, y0 + 1);
    for (let dx = 0; dx < width; dx += 1) {
      let x0 = Math.floor((dx * srcW) / width);
      let x1 = Math.floor(((dx + 1) * srcW) / width);
      if (x1 <= x0) x1 = Math.min(srcW, x0 + 1);
      let sum = 0;
      let n = 0;
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const v = src[y * srcW + x];
          if (!Number.isFinite(v)) continue;
          sum += v;
          n += 1;
        }
      }
      values[dy * width + dx] = n > 0 ? sum / n : 0;
    }
  }
  return { kind: 'downsample-2d', values, width, height };
}

function sampleClamped(src: ArrayLike<number>, width: number, height: number, x: number, y: number): number {
  const cx = x < 0 ? 0 : x >= width ? width - 1 : x;
  const cy = y < 0 ? 0 : y >= height ? height - 1 : y;
  const v = src[cy * width + cx];
  return Number.isFinite(v) ? v : 0;
}

export function blurSeparableF32(
  src: ArrayLike<number>,
  width: number,
  height: number,
): SeparableBlurOutput {
  const tmp = new Float32Array(width * height);
  const values = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      tmp[y * width + x] =
        sampleClamped(src, width, height, x - 1, y) * BLUR_TAP +
        sampleClamped(src, width, height, x, y) * BLUR_CENTER +
        sampleClamped(src, width, height, x + 1, y) * BLUR_TAP;
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      values[y * width + x] =
        sampleClamped(tmp, width, height, x, y - 1) * BLUR_TAP +
        sampleClamped(tmp, width, height, x, y) * BLUR_CENTER +
        sampleClamped(tmp, width, height, x, y + 1) * BLUR_TAP;
    }
  }
  return { kind: 'separable-blur', values, width, height };
}
