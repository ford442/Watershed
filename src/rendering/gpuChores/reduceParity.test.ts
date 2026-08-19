/**
 * gpu-chores goldens — TS kernels pinned to committed 4dp / bin counts.
 *
 * Optional native lane: if watershed_native exposes reduceF32Grid (ABI 5),
 * assert native ≈ TS. Missing exports skip rather than fail, so ABI 4
 * binaries still load for water forces.
 */

import { describe, expect, it } from 'vitest';
import {
  blurSeparableF32,
  downsampleF32,
  histogramF32,
  lumaHistogramU8,
  reduceF32,
} from './cpuMath';
import { HISTOGRAM_BINS } from './types';
import { createWatershedChoresRuntime } from './createRuntime';
import { createTsCpuHost } from './cpuBackend';
import { getWasm } from '../../systems/water/WatershedWasm';
import { bindChoreWasm, hasChoreExports, resetChoreWasmBinding } from './watershedHost';

/** 8×8 ramp: h[y,x] = 0.1*x + 0.01*y */
function ramp8(): Float32Array {
  const values = new Float32Array(64);
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      values[y * 8 + x] = x * 0.1 + y * 0.01;
    }
  }
  return values;
}

const EXPECTED_REDUCE = {
  min: 0,
  max: 0.77,
  mean: 0.385,
  count: 64,
};

/** Non-zero bins for the 8×8 ramp over [0, 0.77]. Regenerated deliberately. */
const EXPECTED_HIST_NZ: Record<number, number> = {
  0: 1,
  3: 1,
  6: 1,
  9: 1,
  13: 1,
  16: 1,
  19: 1,
  23: 1,
  33: 1,
  36: 1,
  39: 1,
  43: 1,
  46: 1,
  49: 1,
  53: 1,
  56: 1,
  66: 1,
  69: 1,
  73: 1,
  76: 1,
  79: 1,
  83: 1,
  86: 1,
  89: 1,
  99: 1,
  103: 1,
  106: 1,
  109: 1,
  113: 1,
  116: 1,
  119: 1,
  123: 1,
  132: 1,
  136: 1,
  139: 1,
  142: 1,
  146: 1,
  149: 1,
  152: 1,
  156: 1,
  166: 1,
  169: 1,
  172: 1,
  176: 1,
  179: 1,
  182: 1,
  186: 1,
  189: 1,
  199: 1,
  202: 1,
  206: 1,
  209: 1,
  212: 1,
  216: 1,
  219: 1,
  222: 1,
  232: 1,
  236: 1,
  239: 1,
  242: 1,
  246: 1,
  249: 1,
  252: 1,
  255: 1,
};

describe('gpu-chores reduce/hist goldens', () => {
  it('pins 8×8 ramp reduce to 4dp', () => {
    const result = reduceF32(ramp8());
    expect(result.min).toBeCloseTo(EXPECTED_REDUCE.min, 4);
    expect(result.max).toBeCloseTo(EXPECTED_REDUCE.max, 4);
    expect(result.mean).toBeCloseTo(EXPECTED_REDUCE.mean, 4);
    expect(result.count).toBe(EXPECTED_REDUCE.count);
  });

  it('pins 8×8 ramp histogram bins', () => {
    const result = histogramF32(ramp8(), 64, 0, 0.77);
    expect(result.bins.length).toBe(HISTOGRAM_BINS);
    expect(result.count).toBe(64);
    const nz: Record<number, number> = {};
    for (let i = 0; i < result.bins.length; i += 1) {
      if (result.bins[i] !== 0) nz[i] = result.bins[i];
    }
    expect(nz).toEqual(EXPECTED_HIST_NZ);
  });

  it('empty reduce is zeros, not NaN', () => {
    const result = reduceF32(new Float32Array(0));
    expect(result).toEqual({ kind: 'grid-reduce', min: 0, max: 0, mean: 0, count: 0 });
  });

  it('BT.709 luma hist of a white pixel lands in the last bin', () => {
    const rgba = new Uint8Array([255, 255, 255, 255]);
    const result = lumaHistogramU8(rgba, 1);
    expect(result.bins[255]).toBe(1);
    expect(result.count).toBe(1);
  });

  it('downsample 8×8 → 2×2 averages each quadrant', () => {
    const src = new Float32Array(16);
    src.fill(1, 0, 4);
    src.fill(2, 4, 8);
    src.fill(3, 8, 12);
    src.fill(4, 12, 16);
    // 4×4 block of constants per quadrant is clearer with 4×4:
    const grid = new Float32Array(16);
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 4; x += 1) {
        grid[y * 4 + x] = y < 2 ? (x < 2 ? 1 : 2) : (x < 2 ? 3 : 4);
      }
    }
    const down = downsampleF32(grid, 4, 4, 2, 2);
    expect(Array.from(down.values)).toEqual([1, 2, 3, 4]);
  });

  it('separable blur of a spike stays finite and conserves a peak', () => {
    const src = new Float32Array(9);
    src[4] = 1;
    const blurred = blurSeparableF32(src, 3, 3);
    expect(blurred.values[4]).toBeGreaterThan(0.2);
    expect(blurred.values.every(Number.isFinite)).toBe(true);
  });
});

describe('gpu-chores runtime lanes on CPU jobs', () => {
  it('registers no webgpu lane without a device and serves ts', async () => {
    const runtime = createWatershedChoresRuntime({
      device: null,
      cpuHost: createTsCpuHost(),
    });
    expect(runtime.availableBackends()).toEqual(['wasm', 'ts']);
    const result = await runtime.runJob({
      op: 'grid-reduce',
      values: ramp8(),
      width: 8,
      height: 8,
      prefer: 'auto',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.backend).toBe('ts');
      expect(result.value.kind).toBe('grid-reduce');
    }
    runtime.destroy();
  });

  it('pinned webgpu declines when the lane is not registered', async () => {
    const runtime = createWatershedChoresRuntime({
      device: null,
      cpuHost: createTsCpuHost(),
    });
    const result = await runtime.runJob({
      op: 'grid-reduce',
      values: ramp8(),
      width: 8,
      height: 8,
      prefer: 'webgpu',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.attempts[0].reason).toMatch(/not registered/i);
    }
    runtime.destroy();
  });
});

describe('gpu-chores optional WASM parity', () => {
  it('native reduce/hist match TS when ABI 5 exports load in this environment', async () => {
    resetChoreWasmBinding();
    let wasm;
    try {
      wasm = await getWasm();
    } catch {
      // jsdom cannot import the Emscripten glue over http:; Node smoke_test.mjs covers the binary.
      return;
    }
    if (!hasChoreExports(wasm)) return;
    bindChoreWasm(wasm);
    const runtime = createWatershedChoresRuntime({ device: null });
    const ts = reduceF32(ramp8());
    const result = await runtime.runJob({
      op: 'grid-reduce',
      values: ramp8(),
      width: 8,
      height: 8,
      prefer: 'wasm',
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.value.kind === 'grid-reduce') {
      expect(result.backend).toBe('wasm');
      expect(result.value.min).toBeCloseTo(ts.min, 4);
      expect(result.value.max).toBeCloseTo(ts.max, 4);
      expect(result.value.mean).toBeCloseTo(ts.mean, 4);
    }
    const hist = await runtime.runJob({
      op: 'luma-histogram',
      values: ramp8(),
      width: 8,
      height: 8,
      channels: 1,
      rangeMin: 0,
      rangeMax: 0.77,
      prefer: 'wasm',
    });
    expect(hist.ok).toBe(true);
    if (hist.ok && hist.value.kind === 'luma-histogram') {
      const expected = histogramF32(ramp8(), 64, 0, 0.77);
      expect(Array.from(hist.value.bins)).toEqual(Array.from(expected.bins));
    }
    runtime.destroy();
    resetChoreWasmBinding();
  });
});
